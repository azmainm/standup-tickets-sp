/**
 * Test script to fetch all meeting URLs for a user on a specific date
 * and retrieve all transcripts
 * * Target Date: September 2, 2025
 * User ID: 50a66395-f31b-4dee-a45e-ef41f3920c9b
 * * Usage: node tests/testFetchAllMeetings.js
 */

const { ConfidentialClientApplication } = require("@azure/msal-node");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Load environment variables
require("dotenv").config();

// Target configuration
const TARGET_USER_ID = "50a66395-f31b-4dee-a45e-ef41f3920c9b";
const TARGET_DATE = "2025-09-02"; // September 2, 2025
const OUTPUT_FOLDER = "output/testFetchAll";

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
      // This is a text line with speaker info, create entry with the "broken" format
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
 * Initialize the output directory
 */
function initializeOutputDirectory() {
  const outputPath = path.join(__dirname, "..", OUTPUT_FOLDER);
  
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
    console.log(`✓ Created output directory: ${outputPath}`);
  } else {
    console.log(`✓ Output directory exists: ${outputPath}`);
  }
  
  return outputPath;
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
    
    console.log("✓ Successfully obtained access token");
    return tokenResponse.accessToken;
  } catch (error) {
    console.error("❌ Error acquiring access token:", error.message);
    throw error;
  }
}

/**
 * Fetch calendar events for the user on the target date.
 * @param {string} accessToken - Microsoft Graph access token
 * @returns {Promise<Array>} Array of calendar event objects
 */
async function fetchCalendarEvents(accessToken) {
  try {
    const graphApi = axios.create({
      baseURL: "https://graph.microsoft.com/v1.0",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const startDateTime = `${TARGET_DATE}T00:00:00Z`;
    const endDateTime = `${TARGET_DATE}T23:59:59Z`;

    console.log(`\n🔍 Searching for calendar events on ${TARGET_DATE} for user ${TARGET_USER_ID}`);
    console.log(`📅 Time range: ${startDateTime} to ${endDateTime}`);

    const eventsEndpoint = `/users/${TARGET_USER_ID}/calendarView?startDateTime=${startDateTime}&endDateTime=${endDateTime}&$select=onlineMeeting,isOnlineMeeting,subject,start,end,organizer`;

    const eventsResponse = await graphApi.get(eventsEndpoint);

    const allEvents = eventsResponse.data.value || [];
    const onlineMeetings = allEvents.filter(event => event.isOnlineMeeting);
    
    console.log(`✓ Found ${onlineMeetings.length} online meetings on ${TARGET_DATE}`);

    if (onlineMeetings.length === 0) {
      console.log("ℹ️ No online meetings found for the specified date");
      return [];
    }
    
    // Display meeting details
    onlineMeetings.forEach((meeting, index) => {
      console.log(`\n📋 Meeting ${index + 1}:`);
      console.log(`   Subject: ${meeting.subject}`);
      console.log(`   Start: ${meeting.start.dateTime}`);
      console.log(`   End: ${meeting.end.dateTime}`);
      console.log(`   Organizer: ${meeting.organizer?.emailAddress?.name || 'Unknown'}`);
    });

    return onlineMeetings;
  } catch (error) {
    console.error("❌ Error fetching calendar events:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

/**
 * Fetch online meetings and their transcripts.
 * @param {string} accessToken - Microsoft Graph access token.
 * @param {Array} events - Calendar events with online meeting info.
 * @returns {Promise<Array>} Array of online meeting objects with transcripts.
 */
async function fetchOnlineMeetingsWithTranscripts(accessToken, events) {
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
      console.log(`\n⚠️ Skipping event ${i + 1}/${events.length}: "${event.subject}" - No join URL found.`);
      continue;
    }
    
    console.log(`\n🔄 Processing meeting ${i + 1}/${events.length}: ${event.subject}`);
    
    let meetingObject = null;
    let transcripts = [];
    const joinWebUrl = onlineMeeting.joinUrl;
    
    try {
      console.log(`   🎯 Searching for online meeting by join URL for user: ${TARGET_USER_ID}`);
      const meetingEndpoint = `/users/${TARGET_USER_ID}/onlineMeetings?$filter=JoinWebUrl eq '${encodeURIComponent(joinWebUrl)}'`;
      const response = await graphApi.get(meetingEndpoint);
      meetingObject = response.data.value[0];
      
      if (meetingObject) {
        console.log(`   ✓ Matched online meeting: ${meetingObject.id}`);
        
        console.log(`   🎯 Fetching transcripts for meeting ${meetingObject.id}`);
        const transcriptsEndpoint = `/users/${TARGET_USER_ID}/onlineMeetings/${meetingObject.id}/transcripts`;
        const transcriptsResponse = await graphApi.get(transcriptsEndpoint);
        transcripts = transcriptsResponse.data.value || [];
        console.log(`   ✓ Found ${transcripts.length} transcripts`);
      } else {
        console.log(`   ⚠️ No matching online meeting found for join URL.`);
      }

    } catch (error) {
      console.log(`   ❌ Error fetching online meeting or transcripts: ${error.message}`);
      if (error.response) {
        console.log(`   HTTP Status: ${error.response.status}`);
        console.log(`   Response Data: ${JSON.stringify(error.response.data, null, 2)}`);
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

  return meetingsWithTranscripts;
}

/**
 * Download and save transcript content
 * @param {string} accessToken - Microsoft Graph access token
 * @param {Object} meetingData - Meeting data with transcript info
 * @param {string} outputPath - Output directory path
 * @returns {Promise<Array>} Array of saved transcript files
 */
async function downloadAndSaveTranscripts(accessToken, meetingData, outputPath) {
    const savedFiles = [];
    const { onlineMeeting, transcripts } = meetingData;
  
    if (!transcripts || transcripts.length === 0) {
      console.log(`   ℹ️ No transcripts to download for meeting: ${onlineMeeting.subject}`);
      return savedFiles;
    }
    
    // Create a date object for the target date's start and end
    const targetDateStart = new Date(TARGET_DATE);
    const targetDateEnd = new Date(TARGET_DATE);
    targetDateEnd.setDate(targetDateEnd.getDate() + 1);
  
    for (let i = 0; i < transcripts.length; i++) {
      const transcript = transcripts[i];
      
      // Convert the transcript's created date to a Date object
      const transcriptDate = new Date(transcript.createdDateTime);
  
      // Filter by date
      if (transcriptDate >= targetDateStart && transcriptDate < targetDateEnd) {
        console.log(`   📥 Downloading transcript ${i + 1}/${transcripts.length}: ${transcript.id}`);
  
        try {
          const transcriptContentEndpoint = `/users/${TARGET_USER_ID}/onlineMeetings/${onlineMeeting.id}/transcripts/${transcript.id}/content`;
          
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
  
          const meetingSubject = onlineMeeting.subject.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
          const timestamp = new Date(onlineMeeting.startDateTime).toISOString().slice(0, 19).replace(/:/g, '-');
          const filename = `${TARGET_DATE}_${timestamp}_${meetingSubject}_transcript_${i + 1}.json`;
          const filePath = path.join(outputPath, filename);
  
                     // Save transcript as direct array without metadata wrapper
           fs.writeFileSync(filePath, JSON.stringify(transcriptJson, null, 2));
          
          console.log(`   ✅ Saved transcript: ${filename}`);
          console.log(`   📊 Entries: ${transcriptJson.length}`);
          
          savedFiles.push({
            filename,
            filePath,
            entryCount: transcriptJson.length,
            meetingSubject: onlineMeeting.subject
          });
          
        } catch (downloadError) {
          console.log(`   ❌ Error downloading transcript ${transcript.id}: ${downloadError.message}`);
        }
      } else {
        console.log(`   ⚠️ Skipping transcript ${transcript.id} - Created on a different date: ${transcript.createdDateTime}`);
      }
    }
  
    return savedFiles;
  }

/**
 * Generate summary report
 * @param {Array} allSavedFiles - All saved transcript files
 * @param {string} outputPath - Output directory path
 */
function generateSummaryReport(allSavedFiles, outputPath) {
  const summary = {
    targetDate: TARGET_DATE,
    targetUserId: TARGET_USER_ID,
    generatedAt: new Date().toISOString(),
    totalTranscripts: allSavedFiles.length,
    totalEntries: allSavedFiles.reduce((sum, file) => sum + file.entryCount, 0),
    transcriptFiles: allSavedFiles.map(file => ({
      filename: file.filename,
      meetingSubject: file.meetingSubject,
      entryCount: file.entryCount
    }))
  };

  const summaryPath = path.join(outputPath, `${TARGET_DATE}_fetch_summary.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  
  console.log(`\n📋 Summary Report:`);
  console.log(`   Total meetings processed: ${allSavedFiles.length}`);
  console.log(`   Total transcript entries: ${summary.totalEntries}`);
  console.log(`   Summary saved to: ${summaryPath}`);
}

/**
 * Main test function
 */
async function testFetchAllMeetings() {
  console.log("=".repeat(80));
  console.log("FETCHING ALL MEETINGS AND TRANSCRIPTS");
  console.log("=".repeat(80));
  console.log(`Target Date: ${TARGET_DATE}`);
  console.log(`Target User: ${TARGET_USER_ID}`);
  console.log(`Output Folder: ${OUTPUT_FOLDER}`);
  console.log("=".repeat(80));

  try {
    // Step 1: Check environment variables
    console.log("\n1. Checking environment variables...");
    const requiredEnvVars = [
      "AZURE_CLIENT_ID",
      "AZURE_CLIENT_SECRET", 
      "AZURE_AUTHORITY"
    ];
    
    const missingVars = [];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        missingVars.push(envVar);
      } else {
        console.log(`✓ ${envVar}: ${envVar.includes("SECRET") ? "[HIDDEN]" : process.env[envVar].substring(0, 50)}...`);
      }
    }
    
    if (missingVars.length > 0) {
      console.error("\n❌ Missing environment variables:");
      missingVars.forEach(envVar => console.error(`   - ${envVar}`));
      console.error("\nPlease check your .env file in the functions directory.");
      process.exit(1);
    }

    // Step 2: Initialize output directory
    console.log("\n2. Initializing output directory...");
    const outputPath = initializeOutputDirectory();

    // Step 3: Get access token
    console.log("\n3. Obtaining access token...");
    const accessToken = await getAccessToken();

    // Step 4: Fetch calendar events to find meeting IDs
    console.log("\n4. Fetching calendar events for target date...");
    const events = await fetchCalendarEvents(accessToken);

    if (events.length === 0) {
      console.log("\n✅ Process completed - No online meetings found for the specified date");
      return;
    }

    // Step 5: Fetch online meeting details and transcripts
    console.log("\n5. Fetching online meeting details and transcripts...");
    const meetingsWithTranscripts = await fetchOnlineMeetingsWithTranscripts(accessToken, events);

    if (meetingsWithTranscripts.length === 0) {
      console.log("\n✅ Process completed - No transcripts found for the specified date");
      return;
    }

    // Step 6: Download and save all transcripts
    console.log("\n6. Downloading and saving transcripts...");
    const allSavedFiles = [];
    
    for (const meetingData of meetingsWithTranscripts) {
      const savedFiles = await downloadAndSaveTranscripts(accessToken, meetingData, outputPath);
      allSavedFiles.push(...savedFiles);
    }

    // Step 7: Generate summary report
    console.log("\n7. Generating summary report...");
    generateSummaryReport(allSavedFiles, outputPath);

    console.log("\n" + "=".repeat(80));
    console.log("✅ PROCESS COMPLETED SUCCESSFULLY!");
    console.log("=".repeat(80));
    console.log(`📁 Output folder: ${outputPath}`);
    console.log(`📊 Total transcripts saved: ${allSavedFiles.length}`);
    
  } catch (error) {
    console.log("\n❌ ERROR occurred during process:");
    console.error(`   Message: ${error.message}`);
    
    if (error.response) {
      console.error(`   HTTP Status: ${error.response.status}`);
      console.error(`   Response Data: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    
    console.log("\nTroubleshooting tips:");
    console.log("   1. Verify Azure app permissions include:");
    console.log("      - OnlineMeetings.Read.All");
    console.log("      - OnlineMeetingTranscript.Read.All");
    console.log("      - Calendars.Read");
    console.log("      - User.Read.All");
    console.log("   2. Ensure admin consent is granted for all permissions");
    console.log("   3. Check if the target user ID exists and is accessible");
    console.log("   4. Verify the target date has meetings with transcripts");
    
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

// Run the test
if (require.main === module) {
  console.log("Starting comprehensive meeting and transcript fetch test...\n");
  testFetchAllMeetings().catch(error => {
    console.error("Test failed:", error);
    process.exit(1);
  });
}

module.exports = {
  testFetchAllMeetings,
  fetchCalendarEvents,
  downloadAndSaveTranscripts,
  TARGET_USER_ID,
  TARGET_DATE,
  OUTPUT_FOLDER
};