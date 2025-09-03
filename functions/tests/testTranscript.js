/**
 * Test file for transcript fetching functionality
 * Run this file to test the Microsoft Graph API integration
 * 
 * Usage: node tests/testTranscript.js
 */

const { getMeetingTranscript } = require("../services/getTranscript");
require("dotenv").config();

async function testTranscriptFetch() {
  console.log("=".repeat(60));
  console.log("TESTING TRANSCRIPT FETCH");
  console.log("=".repeat(60));
  
  // Check environment variables
  console.log("\n1. Checking environment variables...");
  const requiredEnvVars = [
    "AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET", 
    "AZURE_AUTHORITY",
    "DAILY_STANDUP_URL"
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
  
  console.log("\n✓ All environment variables found");
  
  // Test transcript fetching
  console.log("\n2. Testing transcript fetch...");
  console.log(`Meeting URL: ${process.env.DAILY_STANDUP_URL.substring(0, 80)}...`);
  
  try {
    console.log("\nStarting transcript fetch...");
    const startTime = Date.now();
    
    const result = await getMeetingTranscript(process.env.DAILY_STANDUP_URL);
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    if (result) {
      console.log("\n✅ SUCCESS! Transcript fetched successfully");
      console.log(`⏱️  Duration: ${duration} seconds`);
      console.log("\nTranscript Details:");
      console.log(`   - Meeting ID: ${result.metadata.meetingId}`);
      console.log(`   - Transcript ID: ${result.metadata.transcriptId}`);
      console.log(`   - Entry Count: ${result.metadata.entryCount}`);
      console.log(`   - Fetched At: ${result.metadata.fetchedAt}`);
      console.log(`   - Saved To: ${result.metadata.savedToFile}`);
      
      // Show first few entries as sample
      if (result.transcript.length > 0) {
        console.log("\nSample Entries (first 3):");
        result.transcript.slice(0, 3).forEach((entry, index) => {
          console.log(`   ${index + 1}. [${entry.startTime} - ${entry.endTime}] ${entry.speaker}: ${entry.text.substring(0, 100)}${entry.text.length > 100 ? "..." : ""}`);
        });
      }
      
    } else {
      console.log("\n⚠️  No transcript found for this meeting");
      console.log("This could mean:");
      console.log("   - The meeting hasn't occurred yet");
      console.log("   - No transcript was generated");
      console.log("   - Transcription is still processing");
    }
    
  } catch (error) {
    console.log("\n❌ ERROR occurred during transcript fetch:");
    console.error(`   Message: ${error.message}`);
    
    if (error.response) {
      console.error(`   HTTP Status: ${error.response.status}`);
      console.error(`   Response Data: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    
    console.log("\nTroubleshooting tips:");
    console.log("   1. Check if the meeting URL is correct and recent");
    console.log("   2. Verify Azure app permissions for Microsoft Graph");
    console.log("   3. Ensure the meeting had transcription enabled");
    console.log("   4. Check if you have access to the meeting as the configured user");
    
    process.exit(1);
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("TEST COMPLETED");
  console.log("=".repeat(60));
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
  console.log("Starting transcript fetch test...\n");
  testTranscriptFetch().catch(error => {
    console.error("Test failed:", error);
    process.exit(1);
  });
}

module.exports = {
  testTranscriptFetch
};
