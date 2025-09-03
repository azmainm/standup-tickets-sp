/**
 * All Meetings Service - Fetches all meetings and transcripts for a user on a specific date
 * 
 * This service extends the current transcript fetching capability to:
 * 1. Fetch all calendar events for a user on a target date
 * 2. Find all online meetings with transcripts
 * 3. Download and process all transcripts
 * 
 * Based on testFetchAllMeetings.js but integrated into the main system architecture
 */

const { ConfidentialClientApplication } = require("@azure/msal-node");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { logger } = require("firebase-functions");

// Load environment variables
require("dotenv").config();

// Azure App Configuration
const createMsalConfig = () => ({
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: process.env.AZURE_AUTHORITY,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  },
});

const scopes = ["https://graph.microsoft.com/.default"];

/**
 * Helper function to parse VTT content into a JSON object
 * Maintains compatibility with existing transcript format
 * @param {string} vttContent - The VTT content as a string
 * @returns {Array} Array of transcript entries
 */
function parseVttToJson(vttContent) {
  const jsonOutput = [];
  const lines = vttContent.split("\n");
  let currentTimestamp = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines and metadata
    if (!line || line === 'WEBVTT' || line.includes('NOTE')) {
      continue;
    }

    // Check if line contains timestamp
    if (line.includes("-->")) {
      currentTimestamp = line.split(" ")[0]; // Get the start timestamp
    } else if (currentTimestamp && line.startsWith("<v ")) {
      // This is a text line with speaker info, create entry with the format that matches existing system
      jsonOutput.push({
        speaker: currentTimestamp,
        startTime: "-->", 
        text: line
      });
      currentTimestamp = null; // Reset for next entry
    }
  }

  return jsonOutput;
}

/**
 * Get access token for Microsoft Graph API
 * @returns {Promise<string>} Access token
 */
async function getAccessToken() {
  try {
    const config = createMsalConfig();
    const msalClient = new ConfidentialClientApplication(config);
    
    const tokenResponse = await msalClient.acquireTokenByClientCredential({
      scopes,
    });
    
    if (!tokenResponse || !tokenResponse.accessToken) {
      throw new Error("Failed to acquire access token.");
    }
    
    logger.info("Successfully obtained access token for all meetings service");
    return tokenResponse.accessToken;
  } catch (error) {
    logger.error("Error acquiring access token for all meetings service", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Fetch calendar events for the user on the target date.
 * @param {string} accessToken - Microsoft Graph access token
 * @param {string} userId - Target user ID
 * @param {string} targetDate - Target date in YYYY-MM-DD format
 * @returns {Promise<Array>} Array of calendar event objects
 */
async function fetchCalendarEvents(accessToken, userId, targetDate) {
  try {
    const graphApi = axios.create({
      baseURL: "https://graph.microsoft.com/v1.0",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const startDateTime = `${targetDate}T00:00:00Z`;
    const endDateTime = `${targetDate}T23:59:59Z`;

    logger.info("Searching for calendar events", {
      targetDate,
      userId: userId.substring(0, 20) + "...",
      timeRange: `${startDateTime} to ${endDateTime}`,
    });

    const eventsEndpoint = `/users/${userId}/calendarView?startDateTime=${startDateTime}&endDateTime=${endDateTime}&$select=onlineMeeting,isOnlineMeeting,subject,start,end,organizer`;

    const eventsResponse = await graphApi.get(eventsEndpoint);

    const allEvents = eventsResponse.data.value || [];
    const onlineMeetings = allEvents.filter(event => event.isOnlineMeeting);
    
    logger.info("Calendar events fetched", {
      totalEvents: allEvents.length,
      onlineMeetings: onlineMeetings.length,
      targetDate,
    });

    if (onlineMeetings.length === 0) {
      logger.info("No online meetings found for the specified date", { targetDate });
      return [];
    }
    
    // Log meeting details for debugging
    onlineMeetings.forEach((meeting, index) => {
      logger.info(`Meeting ${index + 1} found`, {
        subject: meeting.subject,
        startTime: meeting.start.dateTime,
        endTime: meeting.end.dateTime,
        organizer: meeting.organizer?.emailAddress?.name || 'Unknown',
      });
    });

    return onlineMeetings;
  } catch (error) {
    logger.error("Error fetching calendar events", {
      error: error.message,
      targetDate,
      userId: userId.substring(0, 20) + "...",
      stack: error.stack,
    });
    if (error.response) {
      logger.error("Graph API error details", {
        status: error.response.status,
        data: JSON.stringify(error.response.data, null, 2),
      });
    }
    throw error;
  }
}

/**
 * Fetch online meetings and their transcripts.
 * @param {string} accessToken - Microsoft Graph access token.
 * @param {string} userId - Target user ID
 * @param {Array} events - Calendar events with online meeting info.
 * @param {string} targetDate - Target date for filtering transcripts
 * @returns {Promise<Array>} Array of online meeting objects with transcripts.
 */
async function fetchOnlineMeetingsWithTranscripts(accessToken, userId, events, targetDate) {
  const graphApi = axios.create({
    baseURL: "https://graph.microsoft.com/v1.0",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const meetingsWithTranscripts = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const onlineMeeting = event.onlineMeeting;
    if (!onlineMeeting || !onlineMeeting.joinUrl) {
      logger.warn("Skipping event - no join URL found", {
        eventIndex: i + 1,
        subject: event.subject,
      });
      continue;
    }
    
    logger.info("Processing meeting for transcripts", {
      eventIndex: i + 1,
      totalEvents: events.length,
      subject: event.subject,
    });
    
    let meetingObject = null;
    let transcripts = [];
    const joinWebUrl = onlineMeeting.joinUrl;
    
    try {
      logger.info("Searching for online meeting by join URL", {
        userId: userId.substring(0, 20) + "...",
        joinUrlPrefix: joinWebUrl.substring(0, 50) + "...",
      });
      
      const meetingEndpoint = `/users/${userId}/onlineMeetings?$filter=JoinWebUrl eq '${encodeURIComponent(joinWebUrl)}'`;
      const response = await graphApi.get(meetingEndpoint);
      meetingObject = response.data.value[0];
      
      if (meetingObject) {
        logger.info("Matched online meeting, fetching transcripts", {
          meetingId: meetingObject.id,
        });
        
        const transcriptsEndpoint = `/users/${userId}/onlineMeetings/${meetingObject.id}/transcripts`;
        const transcriptsResponse = await graphApi.get(transcriptsEndpoint);
        transcripts = transcriptsResponse.data.value || [];
        
        logger.info("Transcripts found for meeting", {
          meetingId: meetingObject.id,
          transcriptCount: transcripts.length,
        });
      } else {
        logger.warn("No matching online meeting found for join URL", {
          joinUrlPrefix: joinWebUrl.substring(0, 50) + "...",
        });
      }

    } catch (error) {
      logger.error("Error fetching online meeting or transcripts", {
        eventIndex: i + 1,
        subject: event.subject,
        error: error.message,
      });
      if (error.response) {
        logger.error("Graph API error details", {
          status: error.response.status,
          data: JSON.stringify(error.response.data, null, 2),
        });
      }
      continue;
    }
    
    if (meetingObject && transcripts.length > 0) {
      meetingsWithTranscripts.push({
        event,
        onlineMeeting: meetingObject,
        transcripts,
        organizerEmail: event.organizer?.emailAddress?.address,
      });
    }
  }

  logger.info("All meetings processed", {
    totalEvents: events.length,
    meetingsWithTranscripts: meetingsWithTranscripts.length,
  });

  return meetingsWithTranscripts;
}

/**
 * Download and process transcript content
 * @param {string} accessToken - Microsoft Graph access token
 * @param {string} userId - Target user ID
 * @param {Object} meetingData - Meeting data with transcript info
 * @param {string} targetDate - Target date for filtering and naming
 * @param {string} outputPath - Output directory path
 * @returns {Promise<Array>} Array of transcript data with metadata
 */
async function downloadAndProcessTranscripts(accessToken, userId, meetingData, targetDate, outputPath) {
  const processedTranscripts = [];
  const { onlineMeeting, transcripts } = meetingData;

  if (!transcripts || transcripts.length === 0) {
    logger.info("No transcripts to download for meeting", {
      meetingSubject: onlineMeeting.subject,
    });
    return processedTranscripts;
  }
  
  // Create a date object for the target date's start and end
  const targetDateStart = new Date(targetDate);
  const targetDateEnd = new Date(targetDate);
  targetDateEnd.setDate(targetDateEnd.getDate() + 1);

  for (let i = 0; i < transcripts.length; i++) {
    const transcript = transcripts[i];
    
    // Convert the transcript's created date to a Date object
    const transcriptDate = new Date(transcript.createdDateTime);

    // Filter by date
    if (transcriptDate >= targetDateStart && transcriptDate < targetDateEnd) {
      logger.info("Downloading transcript", {
        transcriptIndex: i + 1,
        totalTranscripts: transcripts.length,
        transcriptId: transcript.id,
        meetingSubject: onlineMeeting.subject,
      });

      try {
        const transcriptContentEndpoint = `/users/${userId}/onlineMeetings/${onlineMeeting.id}/transcripts/${transcript.id}/content`;
        
        const transcriptResponse = await axios.get(
          `https://graph.microsoft.com/v1.0${transcriptContentEndpoint}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "text/vtt",
            },
          }
        );

        const transcriptText = transcriptResponse.data;
        const transcriptJson = parseVttToJson(transcriptText);

        // Create filename consistent with existing system
        const meetingSubject = onlineMeeting.subject.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const timestamp = new Date(onlineMeeting.startDateTime).toISOString().slice(0, 19).replace(/:/g, '-');
        const filename = `${targetDate}_${timestamp}_${meetingSubject}_transcript_${i + 1}.json`;
        const filePath = path.join(outputPath, filename);

        // Ensure output directory exists
        if (!fs.existsSync(outputPath)) {
          fs.mkdirSync(outputPath, { recursive: true });
        }

        // Save transcript to file (for debugging and backup)
        fs.writeFileSync(filePath, JSON.stringify(transcriptJson, null, 2));
        
        logger.info("Transcript processed successfully", {
          filename,
          entries: transcriptJson.length,
          meetingSubject: onlineMeeting.subject,
        });
        
        // Return transcript data with metadata for processing
        processedTranscripts.push({
          transcript: transcriptJson,
          metadata: {
            meetingId: onlineMeeting.id,
            transcriptId: transcript.id,
            fetchedAt: new Date().toISOString(),
            entryCount: transcriptJson.length,
            savedToFile: filePath,
            filename,
            meetingSubject: onlineMeeting.subject,
            meetingStartTime: onlineMeeting.startDateTime,
            organizerEmail: meetingData.organizerEmail,
          }
        });
        
      } catch (downloadError) {
        logger.error("Error downloading transcript", {
          transcriptId: transcript.id,
          meetingSubject: onlineMeeting.subject,
          error: downloadError.message,
          stack: downloadError.stack,
        });
      }
    } else {
      logger.info("Skipping transcript - created on different date", {
        transcriptId: transcript.id,
        createdDate: transcript.createdDateTime,
        targetDate,
      });
    }
  }

  return processedTranscripts;
}

/**
 * Fetch all meetings and transcripts for a user on a specific date
 * This is the main function that orchestrates the entire process
 * @param {string} userId - Target user ID
 * @param {string} targetDate - Target date in YYYY-MM-DD format
 * @returns {Promise<Array>} Array of transcript data with metadata
 */
async function fetchAllMeetingsForUser(userId, targetDate) {
  const startTime = Date.now();
  
  logger.info("Starting all meetings fetch process", {
    userId: userId.substring(0, 20) + "...",
    targetDate,
    timestamp: new Date().toISOString(),
  });

  try {
    // Validate required environment variables
    const requiredEnvVars = ["AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_AUTHORITY"];
    const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing environment variables: ${missingVars.join(", ")}`);
    }

    // Step 1: Get access token
    logger.info("Step 1: Obtaining access token");
    const accessToken = await getAccessToken();

    // Step 2: Fetch calendar events to find meeting IDs
    logger.info("Step 2: Fetching calendar events");
    const events = await fetchCalendarEvents(accessToken, userId, targetDate);

    if (events.length === 0) {
      logger.info("No online meetings found for the specified date", {
        targetDate,
        userId: userId.substring(0, 20) + "...",
      });
      return [];
    }

    // Step 3: Fetch online meeting details and transcripts
    logger.info("Step 3: Fetching online meeting details and transcripts");
    const meetingsWithTranscripts = await fetchOnlineMeetingsWithTranscripts(accessToken, userId, events, targetDate);

    if (meetingsWithTranscripts.length === 0) {
      logger.info("No transcripts found for the specified date", {
        targetDate,
        userId: userId.substring(0, 20) + "...",
      });
      return [];
    }

    // Step 4: Download and process all transcripts
    logger.info("Step 4: Downloading and processing transcripts");
    const outputPath = path.join(__dirname, "../output");
    const allTranscripts = [];
    
    for (const meetingData of meetingsWithTranscripts) {
      const processedTranscripts = await downloadAndProcessTranscripts(
        accessToken, 
        userId, 
        meetingData, 
        targetDate, 
        outputPath
      );
      allTranscripts.push(...processedTranscripts);
    }

    const duration = (Date.now() - startTime) / 1000;
    
    logger.info("All meetings fetch process completed successfully", {
      userId: userId.substring(0, 20) + "...",
      targetDate,
      totalMeetings: meetingsWithTranscripts.length,
      totalTranscripts: allTranscripts.length,
      duration: `${duration.toFixed(2)}s`,
    });

    return allTranscripts;

  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    
    logger.error("All meetings fetch process failed", {
      userId: userId.substring(0, 20) + "...",
      targetDate,
      error: error.message,
      stack: error.stack,
      duration: `${duration.toFixed(2)}s`,
    });
    
    throw new Error(`All meetings fetch failed: ${error.message}`);
  }
}

/**
 * Validate that required environment variables are set for all meetings service
 * @returns {Object} Validation result
 */
function validateAllMeetingsEnvironment() {
  const requiredVars = [
    "AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET", 
    "AZURE_AUTHORITY",
    "TARGET_USER_ID"
  ];
  
  const missingVars = requiredVars.filter(envVar => !process.env[envVar]);
  const isValid = missingVars.length === 0;
  
  if (!isValid) {
    logger.error("Missing environment variables for all meetings service", {
      missingVars,
      requiredVars,
    });
  } else {
    logger.info("All meetings environment variables validated");
  }
  
  return {
    success: isValid,
    missingVars,
    requiredVars,
  };
}

module.exports = {
  fetchAllMeetingsForUser,
  validateAllMeetingsEnvironment,
  parseVttToJson,
  fetchCalendarEvents,
  downloadAndProcessTranscripts,
};
