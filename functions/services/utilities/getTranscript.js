const { ConfidentialClientApplication } = require("@azure/msal-node");
const axios = require("axios");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");

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
 * @param {string} vttContent - The VTT content as a string
 * @returns {Array} Array of transcript entries
 */
function parseVttToJson(vttContent) {
  const jsonOutput = [];
  const lines = vttContent.split("\n");
  let currentEntry = null;

  for (const line of lines) {
    if (line.includes("-->")) {
      // New timestamp line, starts a new entry
      if (currentEntry) {
        jsonOutput.push(currentEntry);
      }
      const parts = line.split(" ");
      currentEntry = {
        speaker: parts[0].replace("<v", "").replace(">", ""),
        startTime: parts[1],
        endTime: parts[3],
        text: "",
      };
    } else if (currentEntry) {
      // Append text to the current entry
      currentEntry.text += line.trim();
    }
  }

  if (currentEntry) {
    jsonOutput.push(currentEntry);
  }

  // The VTT format might have the speaker on a separate line; this loop handles that.
  const finalJson = [];
  let tempEntry = null;
  for (const entry of jsonOutput) {
    if (entry.speaker === "") {
      if (tempEntry) {
        tempEntry.text += " " + entry.text;
      }
    } else {
      if (tempEntry) {
        finalJson.push(tempEntry);
      }
      tempEntry = entry;
    }
  }
  if (tempEntry) {
    finalJson.push(tempEntry);
  }
  return finalJson;
}

/**
 * Main function to get the meeting transcript
 * @param {string} meetingUrl - The Microsoft Teams meeting URL
 * @returns {Promise<Object|null>} Transcript data or null if no transcript found
 */
async function getMeetingTranscript(meetingUrl, targetDate = null) {
  try {
    // Acquire a token using the client credentials flow
    const config = createMsalConfig();
    const msalClient = new ConfidentialClientApplication(config);
    
    const tokenResponse = await msalClient.acquireTokenByClientCredential({
      scopes,
    });
    if (!tokenResponse || !tokenResponse.accessToken) {
      throw new Error("Failed to acquire access token.");
    }
    const accessToken = tokenResponse.accessToken;

    const graphApi = axios.create({
      baseURL: "https://graph.microsoft.com/v1.0",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    // The user ID for the organizer of the meeting.
    const urlObj = new URL(meetingUrl);
    const context = JSON.parse(
      decodeURIComponent(urlObj.searchParams.get("context")),
    );
    const organizerOid = context.Oid;

    if (!organizerOid) {
      throw new Error("Invalid meeting context: organizer OID is missing.");
    }

    // Use the joinWebUrl to find the online meeting object.
    const meetingEndpoint = `/users/${organizerOid}/onlineMeetings?$filter=JoinWebUrl eq '${encodeURIComponent(meetingUrl)}'`;

    console.log(`Searching for meeting with endpoint: ${meetingEndpoint}`);
    const meetingResponse = await graphApi.get(meetingEndpoint);

    const onlineMeeting = meetingResponse.data.value[0];
    if (!onlineMeeting) {
      throw new Error("Online meeting not found.");
    }

    console.log(`Found meeting ID: ${onlineMeeting.id}`);

    // Step 2a: Get the list of transcripts for the meeting
    const transcriptsEndpoint = `/users/${organizerOid}/onlineMeetings/${onlineMeeting.id}/transcripts`;
    console.log(`Fetching transcripts from endpoint: ${transcriptsEndpoint}`);
    const transcriptsResponse = await graphApi.get(transcriptsEndpoint);
    const transcripts = transcriptsResponse.data.value;

    if (!transcripts || transcripts.length === 0) {
      console.log("No transcripts found for this meeting.");
      return null;
    }

    // We'll take the first transcript found
    const latestTranscript = transcripts[0];

    // Step 2b: Get the content of the transcript
    const transcriptContentEndpoint = `/users/${organizerOid}/onlineMeetings/${onlineMeeting.id}/transcripts/${latestTranscript.id}/content`;

    console.log(`Downloading transcript from: ${transcriptContentEndpoint}`);
    const transcriptResponse = await axios.get(
      `https://graph.microsoft.com/v1.0${transcriptContentEndpoint}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "text/vtt",
        },
      },
    );

    const transcriptText = transcriptResponse.data;
    const transcriptJson = parseVttToJson(transcriptText);

    // Step 4: Save the JSON file (optional - for local testing)
    // Use targetDate if provided, otherwise use current date
    const dateForFilename = targetDate ? targetDate : new Date().toISOString().slice(0, 10);
    const filename = `${dateForFilename}_dailystandup.json`;
    const filePath = path.join(__dirname, "../output", filename);

    // Ensure output directory exists
    const outputDir = path.dirname(filePath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(transcriptJson, null, 2));

    console.log("------------------------------------------");
    console.log("Success!");
    console.log(`Transcript saved to: ${filePath}`);
    console.log(`Entries processed: ${transcriptJson.length}`);
    console.log("------------------------------------------");

    return {
      transcript: transcriptJson,
      metadata: {
        meetingId: onlineMeeting.id,
        transcriptId: latestTranscript.id,
        fetchedAt: new Date().toISOString(),
        meetingStartTime: onlineMeeting.startDateTime,
        entryCount: transcriptJson.length,
        savedToFile: filePath,
      },
    };
  } catch (error) {
    console.error("Error fetching transcript:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    }
    throw error;
  }
}

module.exports = {
  getMeetingTranscript,
  parseVttToJson,
};
