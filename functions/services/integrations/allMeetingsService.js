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
const { isTranscriptAlreadyProcessed, markTranscriptAsProcessed } = require("../storage/mongoService");

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
    if (!line || line === "WEBVTT" || line.includes("NOTE")) {
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

    let startDateTime, endDateTime;
    
    // Support custom time windows for GitHub Actions cron
    if (typeof targetDate === "object" && targetDate.startDateTime && targetDate.endDateTime) {
      startDateTime = targetDate.startDateTime;
      endDateTime = targetDate.endDateTime;
      
      // Log the window type for debugging
      if (targetDate.processingStartDateTime) {
        logger.info("Using extended calendar window with separate processing window", {
          calendarWindow: `${startDateTime} to ${endDateTime}`,
          processingWindow: `${targetDate.processingStartDateTime} to ${targetDate.processingEndDateTime}`
        });
      }
    } else {
      // Original behavior for daily processing
      startDateTime = `${targetDate}T00:00:00Z`;
      endDateTime = `${targetDate}T23:59:59Z`;
    }

    logger.info("Searching for calendar events", {
      targetDate,
      userId: userId.substring(0, 20) + "...",
      timeRange: `${startDateTime} to ${endDateTime}`,
    });

    const eventsEndpoint = `/users/${userId}/calendarView?startDateTime=${startDateTime}&endDateTime=${endDateTime}&$select=onlineMeeting,isOnlineMeeting,subject,start,end,organizer`;

    const eventsResponse = await graphApi.get(eventsEndpoint);

    const allEvents = eventsResponse.data.value || [];
    const onlineMeetings = allEvents.filter(event => event.isOnlineMeeting);
    
  logger.info("📅 Calendar events fetched successfully", {
    totalEvents: allEvents.length,
    onlineMeetings: onlineMeetings.length,
    targetDate,
    userId: userId.substring(0, 20) + "...",
    timeRange: `${startDateTime} to ${endDateTime}`,
  });

  if (onlineMeetings.length === 0) {
    logger.warn("⚠️ No online meetings found for the specified date", { 
      targetDate,
      totalEventsFound: allEvents.length,
      possibleReasons: [
        "No meetings scheduled for this date",
        "Meetings exist but are not online meetings",
        "User calendar access issues",
        "Meeting organizer permissions",
      ],
    });
    return [];
  }
  
  // Log meeting details for debugging
  logger.info(`📋 Found ${onlineMeetings.length} online meeting(s) for processing`, {
    targetDate,
    meetingCount: onlineMeetings.length,
  });
  
  onlineMeetings.forEach((meeting, index) => {
    logger.info(`📅 Meeting ${index + 1}/${onlineMeetings.length} details`, {
      subject: meeting.subject,
      startTime: meeting.start?.dateTime,
      endTime: meeting.end?.dateTime,
      organizer: meeting.organizer?.emailAddress?.name || 'Unknown',
      organizerEmail: meeting.organizer?.emailAddress?.address || 'Unknown',
      hasOnlineMeeting: !!meeting.onlineMeeting,
      hasJoinUrl: !!(meeting.onlineMeeting?.joinUrl),
      joinUrlPrefix: meeting.onlineMeeting?.joinUrl?.substring(0, 50) + "..." || 'N/A',
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
  const processingResults = [];

  logger.info("🔍 Starting to process meetings for transcripts", {
    totalEvents: events.length,
    targetDate,
    userId: userId.substring(0, 20) + "...",
  });

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const processingResult = {
      eventIndex: i + 1,
      subject: event.subject,
      status: "processing",
      reason: null,
      error: null,
      meetingId: null,
      transcriptCount: 0,
      joinUrl: null
    };

    logger.info(`📋 Processing meeting ${i + 1}/${events.length}`, {
      eventIndex: i + 1,
      subject: event.subject,
      startTime: event.start?.dateTime,
      organizer: event.organizer?.emailAddress?.name || "Unknown",
    });

    const onlineMeeting = event.onlineMeeting;
    if (!onlineMeeting || !onlineMeeting.joinUrl) {
      processingResult.status = "skipped";
      processingResult.reason = "No join URL found in calendar event";
      processingResults.push(processingResult);
      
      logger.warn(`❌ Skipping event ${i + 1} - no join URL found`, {
        eventIndex: i + 1,
        subject: event.subject,
        hasOnlineMeeting: !!onlineMeeting,
        hasJoinUrl: !!(onlineMeeting?.joinUrl),
      });
      continue;
    }
    
    let meetingObject = null;
    let transcripts = [];
    const joinWebUrl = onlineMeeting.joinUrl;
    processingResult.joinUrl = joinWebUrl.substring(0, 100) + "...";
    
    try {
      logger.info(`🔎 Searching for online meeting by join URL for event ${i + 1}`, {
        userId: userId.substring(0, 20) + "...",
        joinUrlPrefix: joinWebUrl.substring(0, 80) + "...",
        fullJoinUrl: joinWebUrl, // Log full URL for debugging
      });
      
      const meetingEndpoint = `/users/${userId}/onlineMeetings?$filter=JoinWebUrl eq '${encodeURIComponent(joinWebUrl)}'`;
      logger.info(`📡 Making Graph API call for event ${i + 1}`, {
        endpoint: meetingEndpoint,
        method: 'GET',
      });
      
      const response = await graphApi.get(meetingEndpoint);
      const allOnlineMeetings = response.data.value || [];
      meetingObject = allOnlineMeetings[0];
      
      logger.info(`📊 Graph API response for event ${i + 1}`, {
        totalMeetingsReturned: allOnlineMeetings.length,
        foundMatch: !!meetingObject,
        meetingId: meetingObject?.id || 'none',
      });
      
      if (meetingObject) {
        processingResult.meetingId = meetingObject.id;
        
        logger.info(`✅ Matched online meeting for event ${i + 1}, fetching transcripts`, {
          meetingId: meetingObject.id,
          meetingSubject: meetingObject.subject,
        });
        
        const transcriptsEndpoint = `/users/${userId}/onlineMeetings/${meetingObject.id}/transcripts`;
        logger.info(`📡 Fetching transcripts for event ${i + 1}`, {
          transcriptsEndpoint,
        });
        
        const transcriptsResponse = await graphApi.get(transcriptsEndpoint);
        transcripts = transcriptsResponse.data.value || [];
        processingResult.transcriptCount = transcripts.length;
        
        logger.info(`📋 Transcripts found for event ${i + 1}`, {
          meetingId: meetingObject.id,
          transcriptCount: transcripts.length,
          transcriptIds: transcripts.map(t => t.id),
          transcriptCreatedDates: transcripts.map(t => t.createdDateTime),
        });

        if (transcripts.length === 0) {
          processingResult.status = "no_transcripts";
          processingResult.reason = "Meeting found but no transcripts available";
          logger.warn(`⚠️ Meeting found for event ${i + 1} but no transcripts available`, {
            meetingId: meetingObject.id,
            meetingSubject: meetingObject.subject,
          });
        } else {
          processingResult.status = "success";
          processingResult.reason = `Found ${transcripts.length} transcript(s)`;
        }
        
      } else {
        processingResult.status = "no_meeting_match";
        processingResult.reason = "Calendar event join URL did not match any online meeting";
        
        logger.warn(`❌ No matching online meeting found for event ${i + 1}`, {
          joinUrlPrefix: joinWebUrl.substring(0, 80) + "...",
          calendarEventId: event.id,
          totalOnlineMeetingsReturned: allOnlineMeetings.length,
          suggestion: "The join URL from calendar might not match the online meeting URL format",
        });
      }

    } catch (error) {
      processingResult.status = "error";
      processingResult.error = error.message;
      processingResult.reason = `API error: ${error.message}`;
      
      logger.error(`💥 Error fetching online meeting or transcripts for event ${i + 1}`, {
        eventIndex: i + 1,
        subject: event.subject,
        error: error.message,
        stack: error.stack,
        joinUrlPrefix: joinWebUrl.substring(0, 80) + "...",
      });
      
      if (error.response) {
        logger.error(`📡 Graph API error details for event ${i + 1}`, {
          status: error.response.status,
          statusText: error.response.statusText,
          data: JSON.stringify(error.response.data, null, 2),
          headers: error.response.headers,
        });
      }
      
      // REMOVED: continue; - We no longer silently skip errors
      // Instead, we log the error and continue to next meeting
    }
    
    processingResults.push(processingResult);
    
    // Only add to results if we have both meeting object and transcripts
    if (meetingObject && transcripts.length > 0) {
      meetingsWithTranscripts.push({
        event,
        onlineMeeting: meetingObject,
        transcripts,
        organizerEmail: event.organizer?.emailAddress?.address,
      });
      
      logger.info(`✅ Successfully added meeting ${i + 1} to results`, {
        meetingId: meetingObject.id,
        transcriptCount: transcripts.length,
      });
    } else {
      logger.warn(`❌ Meeting ${i + 1} not added to results`, {
        hasMeetingObject: !!meetingObject,
        transcriptCount: transcripts.length,
        reason: !meetingObject ? "No meeting object found" : "No transcripts available",
      });
    }
  }

  // Comprehensive summary logging
  logger.info("📊 All meetings processing completed - DETAILED SUMMARY", {
    totalEvents: events.length,
    successfulMeetings: meetingsWithTranscripts.length,
    targetDate,
  });

  // Log detailed breakdown
  const summary = {
    success: processingResults.filter(r => r.status === "success").length,
    skipped_no_joinurl: processingResults.filter(r => r.status === "skipped").length,
    no_meeting_match: processingResults.filter(r => r.status === "no_meeting_match").length,
    no_transcripts: processingResults.filter(r => r.status === "no_transcripts").length,
    errors: processingResults.filter(r => r.status === "error").length,
  };

  logger.info("📈 Processing breakdown", summary);

  // Log each meeting's result for debugging
  processingResults.forEach((result, index) => {
    const logLevel = result.status === "success" ? "info" : "warn";
    logger[logLevel](`Meeting ${result.eventIndex}: ${result.subject}`, {
      status: result.status,
      reason: result.reason,
      meetingId: result.meetingId,
      transcriptCount: result.transcriptCount,
      error: result.error,
    });
  });

  if (meetingsWithTranscripts.length === 0) {
    logger.error("🚨 CRITICAL: No meetings with transcripts found!", {
      totalEventsProcessed: events.length,
      summary,
      possibleIssues: [
        "Join URL format mismatch between calendar and online meetings",
        "Insufficient permissions to access online meetings",
        "Transcripts not yet generated for meetings",
        "TARGET_USER_ID not the organizer of meetings",
        "Meeting transcription not enabled",
      ],
    });
  }

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
  const { event, onlineMeeting, transcripts } = meetingData;

  logger.info("📥 Starting transcript download and processing", {
    meetingSubject: onlineMeeting.subject,
    meetingId: onlineMeeting.id,
    transcriptCount: transcripts?.length || 0,
    meetingStartTime: event?.start?.dateTime,
    meetingEndTime: event?.end?.dateTime,
    targetDate,
  });

  if (!transcripts || transcripts.length === 0) {
    logger.warn("⚠️ No transcripts to download for meeting", {
      meetingSubject: onlineMeeting.subject,
      meetingId: onlineMeeting.id,
      reason: "Meeting has no transcripts available",
    });
    return processedTranscripts;
  }
  
  // Handle both date strings and custom time window objects
  let targetDateStart, targetDateEnd;
  
  if (typeof targetDate === "object" && targetDate.customTimeWindow) {
    // For GitHub Actions cron with extended calendar window
    if (targetDate.processingStartDateTime && targetDate.processingEndDateTime) {
      // Use the processing window for transcript filtering (not the calendar window)
      targetDateStart = new Date(targetDate.processingStartDateTime);
      targetDateEnd = new Date(targetDate.processingEndDateTime);
    } else {
      // Fallback to original logic
      targetDateStart = new Date(targetDate.startDateTime);
      targetDateEnd = new Date(targetDate.endDateTime);
    }
  } else {
    // Regular date string
    targetDateStart = new Date(targetDate);
    targetDateEnd = new Date(targetDate);
    targetDateEnd.setDate(targetDateEnd.getDate() + 1);
  }

  // Get meeting end time for filtering
  // Microsoft Graph returns datetime in format "2025-10-06T16:30:00.0000000"
  // We need to parse this correctly as UTC
  let meetingEndTime = null;
  if (event?.end?.dateTime) {
    // Remove the extra precision and ensure it's treated as UTC
    const cleanDateTimeString = event.end.dateTime.replace(/\.0+$/, '') + 'Z';
    meetingEndTime = new Date(cleanDateTimeString);
  }

  logger.info("📅 Date filtering setup", {
    targetDate,
    targetDateStart: targetDateStart.toISOString(),
    targetDateEnd: targetDateEnd.toISOString(),
    meetingSubject: onlineMeeting.subject,
    meetingEndTime: meetingEndTime?.toISOString(),
    isCustomTimeWindow: typeof targetDate === "object" && targetDate.customTimeWindow,
    hasProcessingWindow: !!(targetDate.processingStartDateTime && targetDate.processingEndDateTime),
    filteringLogic: "Will filter based on TRANSCRIPT CREATION time with duplicate prevention"
  });

  const transcriptProcessingResults = [];

  for (let i = 0; i < transcripts.length; i++) {
    const transcript = transcripts[i];
    const processingResult = {
      transcriptIndex: i + 1,
      transcriptId: transcript.id,
      createdDateTime: transcript.createdDateTime,
      status: "processing",
      reason: null,
      error: null,
    };
    
    // Convert the transcript's created date to a Date object
    const transcriptDate = new Date(transcript.createdDateTime);

    // FIXED: Always filter by transcript creation time (not meeting end time)
    let shouldProcess = false;
    let filterReason = "";
    
    // Check if transcript was created within the processing window
    const transcriptInWindow = transcriptDate >= targetDateStart && transcriptDate <= targetDateEnd;
    
    if (transcriptInWindow) {
      shouldProcess = true;
      filterReason = `Transcript created within processing window (${transcriptDate.toISOString()})`;
    } else {
      shouldProcess = false;
      filterReason = `Transcript created outside processing window (${transcriptDate.toISOString()})`;
    }

    // Duplicate prevention check
    if (shouldProcess) {
      try {
        const alreadyProcessed = await isTranscriptAlreadyProcessed(transcript.id);
        if (alreadyProcessed) {
          shouldProcess = false;
          filterReason = "Transcript already processed in previous run";
          
          logger.info("🔄 Skipping duplicate transcript", {
            transcriptId: transcript.id,
            meetingSubject: onlineMeeting.subject,
            transcriptDate: transcriptDate.toISOString(),
            reason: "Already processed - duplicate prevention"
          });
        }
      } catch (duplicateCheckError) {
        // Log error but continue processing (fail-safe)
        logger.warn("⚠️ Error checking duplicate status, proceeding with processing", {
          transcriptId: transcript.id,
          error: duplicateCheckError.message
        });
      }
    }

    // Extended age check for transcript safety (increased from 24 to 72 hours)
    if (shouldProcess) {
      const now = new Date();
      const transcriptAge = (now - transcriptDate) / (1000 * 60 * 60); // Age in hours
      const maxTranscriptAgeHours = 72; // Increased to 72 hours

      if (transcriptAge > maxTranscriptAgeHours) {
        shouldProcess = false;
        filterReason = `Transcript too old (${transcriptAge.toFixed(1)} hours, max: ${maxTranscriptAgeHours} hours)`;
        
        logger.warn("⏰ Skipping old transcript`", {
          transcriptId: transcript.id,
          transcriptAge: transcriptAge.toFixed(1) + " hours",
          maxAge: maxTranscriptAgeHours + " hours",
          transcriptDate: transcriptDate.toISOString(),
          meetingSubject: onlineMeeting.subject,
          reason: "Transcript exceeds 72-hour age limit"
        });
      }
    }

    logger.info(`📄 Processing transcript ${i + 1}/${transcripts.length}`, {
      transcriptIndex: i + 1,
      transcriptId: transcript.id,
      createdDateTime: transcript.createdDateTime,
      transcriptDate: transcriptDate.toISOString(),
      meetingEndTime: meetingEndTime?.toISOString(),
      meetingSubject: onlineMeeting.subject,
      shouldProcess,
      filterReason,
      filteringBy: "transcript_creation_time_with_duplicate_prevention",
      processingWindow: `${targetDateStart.toISOString()} to ${targetDateEnd.toISOString()}`
    });

    // Filter by date with detailed logging
    if (shouldProcess) {
      processingResult.status = "downloading";
      
      logger.info(`⬇️ Downloading transcript ${i + 1} (passes date filter)`, {
        transcriptIndex: i + 1,
        totalTranscripts: transcripts.length,
        transcriptId: transcript.id,
        createdDate: transcript.createdDateTime,
        meetingSubject: onlineMeeting.subject,
        targetDateRange: `${targetDateStart.toISOString()} to ${targetDateEnd.toISOString()}`,
      });

      try {
        const transcriptContentEndpoint = `/users/${userId}/onlineMeetings/${onlineMeeting.id}/transcripts/${transcript.id}/content`;
        
        logger.info(`📡 Making API call to download transcript content ${i + 1}`, {
          endpoint: transcriptContentEndpoint,
          transcriptId: transcript.id,
        });
        
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

        logger.info(`📝 Transcript content parsed for transcript ${i + 1}`, {
          transcriptId: transcript.id,
          rawTextLength: transcriptText.length,
          parsedEntries: transcriptJson.length,
          meetingSubject: onlineMeeting.subject,
        });

        // Create filename consistent with existing system
        const meetingSubject = onlineMeeting.subject.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const timestamp = new Date(onlineMeeting.startDateTime).toISOString().slice(0, 19).replace(/:/g, '-');
        const filename = `${targetDate}_${timestamp}_${meetingSubject}_transcript_${i + 1}.json`;
        const filePath = path.join(outputPath, filename);

        // Ensure output directory exists
        if (!fs.existsSync(outputPath)) {
          fs.mkdirSync(outputPath, { recursive: true });
          logger.info("📁 Created output directory", { outputPath });
        }

        // Save transcript to file (for debugging and backup)
        fs.writeFileSync(filePath, JSON.stringify(transcriptJson, null, 2));
        
        processingResult.status = "success";
        processingResult.reason = `Successfully downloaded and processed ${transcriptJson.length} entries`;
        
        // Mark transcript as processed to prevent future duplicates
        try {
          await markTranscriptAsProcessed(
            transcript.id, 
            onlineMeeting.id, 
            onlineMeeting.subject, 
            new Date()
          );
          logger.info(`✅ Transcript ${i + 1} processed and marked as processed`, {
            transcriptId: transcript.id,
            meetingId: onlineMeeting.id,
            meetingSubject: onlineMeeting.subject
          });
        } catch (markError) {
          // Log error but don't fail processing
          logger.warn("⚠️ Failed to mark transcript as processed (processing succeeded)", {
            transcriptId: transcript.id,
            error: markError.message
          });
        }
        
        logger.info(`✅ Transcript ${i + 1} processed successfully`, {
          filename,
          entries: transcriptJson.length,
          meetingSubject: onlineMeeting.subject,
          filePath,
          transcriptId: transcript.id,
        });
        
        // Return transcript data with metadata for processing
        processedTranscripts.push({
          transcript: transcriptJson,
          metadata: {
            meetingId: onlineMeeting.id,
            transcriptId: transcript.id,
            fetchedAt: new Date().toISOString(),
            targetDate: targetDate, // Add target date for Teams message
            entryCount: transcriptJson.length,
            savedToFile: filePath,
            filename,
            meetingSubject: onlineMeeting.subject,
            meetingStartTime: onlineMeeting.startDateTime,
            organizerEmail: meetingData.organizerEmail,
          }
        });
        
      } catch (downloadError) {
        processingResult.status = "error";
        processingResult.error = downloadError.message;
        processingResult.reason = `Download failed: ${downloadError.message}`;
        
        logger.error(`💥 Error downloading transcript ${i + 1}`, {
          transcriptId: transcript.id,
          meetingSubject: onlineMeeting.subject,
          error: downloadError.message,
          stack: downloadError.stack,
          endpoint: `/users/${userId}/onlineMeetings/${onlineMeeting.id}/transcripts/${transcript.id}/content`,
        });
        
        if (downloadError.response) {
          logger.error(`📡 API error details for transcript ${i + 1}`, {
            status: downloadError.response.status,
            statusText: downloadError.response.statusText,
            data: JSON.stringify(downloadError.response.data, null, 2),
          });
        }
      }
    } else {
      processingResult.status = "filtered_out";
      processingResult.reason = filterReason;
      
      logger.warn(`⏭️ Skipping transcript ${i + 1} - ${filterReason}`, {
        transcriptId: transcript.id,
        createdDate: transcript.createdDateTime,
        createdDateParsed: transcriptDate.toISOString(),
        meetingEndTime: meetingEndTime?.toISOString(),
        targetDate,
        targetDateStart: targetDateStart.toISOString(),
        targetDateEnd: targetDateEnd.toISOString(),
        filteringBy: typeof targetDate === 'object' && targetDate.customTimeWindow ? 'meeting_end_time' : 'transcript_creation_time',
        reasonForSkip: filterReason,
      });
    }
    
    transcriptProcessingResults.push(processingResult);
  }

  // Summary logging for transcript processing
  const summary = {
    total: transcripts.length,
    success: transcriptProcessingResults.filter(r => r.status === "success").length,
    filtered_out: transcriptProcessingResults.filter(r => r.status === "filtered_out").length,
    errors: transcriptProcessingResults.filter(r => r.status === "error").length,
  };

  logger.info("📊 Transcript processing completed", {
    meetingSubject: onlineMeeting.subject,
    meetingId: onlineMeeting.id,
    summary,
    processedTranscriptsCount: processedTranscripts.length,
    targetDate,
  });

  // Log each transcript result
  transcriptProcessingResults.forEach((result) => {
    const logLevel = result.status === "success" ? "info" : "warn";
    logger[logLevel](`Transcript ${result.transcriptIndex} result`, {
      transcriptId: result.transcriptId,
      status: result.status,
      reason: result.reason,
      createdDateTime: result.createdDateTime,
      error: result.error,
    });
  });

  if (processedTranscripts.length === 0 && transcripts.length > 0) {
    logger.error("🚨 CRITICAL: No transcripts were successfully processed!", {
      meetingSubject: onlineMeeting.subject,
      totalTranscriptsAvailable: transcripts.length,
      summary,
      possibleIssues: [
        "All transcripts created outside target date range",
        "Transcript download API errors",
        "Insufficient permissions to download transcript content",
        "Transcript content format issues",
      ],
    });
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
    
    // Support custom time windows for GitHub Actions cron
    let calendarQuery = targetDate;
    if (typeof targetDate === "object" && targetDate.customTimeWindow) {
      calendarQuery = {
        startDateTime: targetDate.startDateTime,
        endDateTime: targetDate.endDateTime
      };
    }
    
    const events = await fetchCalendarEvents(accessToken, userId, calendarQuery);

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
