/**
 * Fetch Yesterday's Teams Meeting Transcripts Script
 * 
 * This script fetches yesterday's Teams meeting transcripts and saves them 
 * to the MongoDB transcripts collection exactly as done in testrealflow/testfakeflow.
 * 
 * Features:
 * - Fetches all meetings for TARGET_USER_ID from yesterday
 * - Saves transcripts to MongoDB transcripts collection 
 * - Uses existing services for consistency
 * - No additional processing - just fetch and save
 * 
 * Usage: node scripts/fetchYesterdayTranscripts.js
 */

require("dotenv").config();

const { fetchAllMeetingsForUser, validateAllMeetingsEnvironment } = require("../services/allMeetingsService");
const { storeTranscript, testMongoConnection, initializeMongoDB } = require("../services/mongoService");
const { getBangladeshTimeComponents } = require("../services/meetingUrlService");
const { logger } = require("firebase-functions");

/**
 * Calculate yesterday's date in YYYY-MM-DD format
 * @returns {string} Yesterday's date in YYYY-MM-DD format
 */
function getYesterdayDate() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  return yesterday.toISOString().slice(0, 10);
}

/**
 * Main function to fetch yesterday's transcripts and save to MongoDB
 */
async function fetchAndSaveYesterdayTranscripts() {
  console.log("=".repeat(80));
  console.log("🚀 FETCHING YESTERDAY'S TEAMS MEETING TRANSCRIPTS");
  console.log("=".repeat(80));
  
  const startTime = Date.now();
  
  try {
    // Step 1: Validate environment variables
    console.log("\n1. Checking environment variables...");
    
    const requiredEnvVars = [
      "AZURE_CLIENT_ID",
      "AZURE_CLIENT_SECRET", 
      "AZURE_AUTHORITY",
      "TARGET_USER_ID",
      "MONGODB_URI"
    ];
    
    const missingVars = [];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        missingVars.push(envVar);
      } else {
        const displayValue = envVar.includes("SECRET") || envVar.includes("KEY") || envVar.includes("TOKEN") ? "[HIDDEN]" : 
          envVar === "TARGET_USER_ID" ? process.env[envVar].substring(0, 20) + "..." :
          process.env[envVar].length > 30 ? 
            process.env[envVar].substring(0, 30) + "..." :
            process.env[envVar];
        console.log(`✓ ${envVar}: ${displayValue}`);
      }
    }
    
    if (missingVars.length > 0) {
      console.error("\n❌ Missing environment variables:");
      missingVars.forEach(envVar => console.error(`   - ${envVar}`));
      console.error("\nPlease check your .env file in the functions directory.");
      process.exit(1);
    }
    
    console.log("\n✓ All required environment variables found");
    
    // Step 2: Validate All Meetings environment
    console.log("\n2. Testing All Meetings environment...");
    try {
      const allMeetingsValidation = validateAllMeetingsEnvironment();
      console.log("   📊 Environment check:", allMeetingsValidation.success ? "✓" : "❌");
      
      if (!allMeetingsValidation.success) {
        console.log("   Missing:", allMeetingsValidation.missingVars.join(", "));
        process.exit(1);
      }
      
      console.log("   ✓ All Meetings environment validated");
    } catch (error) {
      console.error("   ❌ All Meetings environment validation failed:", error.message);
      process.exit(1);
    }
    
    // Step 3: Test MongoDB connection
    console.log("\n3. Testing MongoDB connection...");
    const mongoTest = await testMongoConnection();
    if (!mongoTest) {
      console.error("   ❌ MongoDB connection test failed");
      process.exit(1);
    }
    console.log("   ✓ MongoDB connection successful");
    
    // Step 4: Calculate yesterday's date
    console.log("\n4. Calculating target date...");
    const yesterdayDate = getYesterdayDate();
    console.log(`   📅 Target date (yesterday): ${yesterdayDate}`);
    console.log(`   👤 Target user: ${process.env.TARGET_USER_ID.substring(0, 20)}...`);
    
    // Step 5: Fetch all meetings and transcripts for yesterday
    console.log("\n5. 🔄 Fetching all meetings and transcripts for yesterday...");
    
    let allTranscriptsResults = [];
    
    try {
      console.log("   🔄 Starting All Meetings fetch...");
      const fetchStartTime = Date.now();
      
      allTranscriptsResults = await fetchAllMeetingsForUser(process.env.TARGET_USER_ID, yesterdayDate);
      
      const fetchDuration = ((Date.now() - fetchStartTime) / 1000).toFixed(2);
    
      if (allTranscriptsResults.length > 0) {
        console.log("   ✅ All meetings fetched successfully");
        console.log(`   ⏱️  Fetch duration: ${fetchDuration} seconds`);
        console.log(`   📊 Total transcripts found: ${allTranscriptsResults.length}`);
        
        // Show details for each transcript
        allTranscriptsResults.forEach((transcriptData, index) => {
          console.log(`\n   📋 Transcript ${index + 1}:`);
          console.log(`      - Meeting: ${transcriptData.metadata.meetingSubject}`);
          console.log(`      - Entries: ${transcriptData.metadata.entryCount}`);
          console.log(`      - Meeting ID: ${transcriptData.metadata.meetingId}`);
          console.log(`      - Saved to file: ${transcriptData.metadata.filename}`);
        });
      
      } else {
        console.log("   ⚠️  No transcripts found for yesterday");
        console.log("   This could mean:");
        console.log("      - No meetings occurred yesterday");
        console.log("      - No transcripts were generated"); 
        console.log("      - Transcription is still processing");
        console.log("      - User calendar access issues");
        console.log("\n   ✅ Script completed - no transcripts to save");
        return;
      }
      
    } catch (error) {
      console.log("\n   ❌ ERROR occurred during All Meetings fetch:");
      console.error(`      Message: ${error.message}`);
      
      if (error.response) {
        console.error(`      HTTP Status: ${error.response.status}`);
      }
      
      throw error;
    }
    
    // Step 6: Save all transcripts to MongoDB transcripts collection
    console.log("\n6. 💾 Saving transcripts to MongoDB transcripts collection...");
    
    let savedCount = 0;
    let failedCount = 0;
    const savedTranscripts = [];
    
    for (let i = 0; i < allTranscriptsResults.length; i++) {
      const transcriptData = allTranscriptsResults[i];
      
      console.log(`\n   💾 Saving transcript ${i + 1}/${allTranscriptsResults.length}: ${transcriptData.metadata.meetingSubject}`);
      
      try {
        // Save transcript to MongoDB using existing storeTranscript function
        const saveResult = await storeTranscript(
          transcriptData.transcript, 
          {
            ...transcriptData.metadata,
            targetDate: yesterdayDate,
            scriptExecutedAt: new Date().toISOString(),
            source: "fetchYesterdayTranscripts.js"
          }
        );
        
        if (saveResult.success) {
          savedCount++;
          savedTranscripts.push({
            meeting: transcriptData.metadata.meetingSubject,
            documentId: saveResult.documentId,
            entryCount: saveResult.entryCount,
            dataSize: saveResult.dataSize
          });
          
          console.log(`      ✅ Saved successfully`);
          console.log(`         - Document ID: ${saveResult.documentId}`);
          console.log(`         - Entry count: ${saveResult.entryCount}`);
          console.log(`         - Data size: ${saveResult.dataSize} characters`);
        } else {
          failedCount++;
          console.log(`      ❌ Save failed: ${saveResult.error || 'Unknown error'}`);
        }
        
      } catch (saveError) {
        failedCount++;
        console.log(`      ❌ Save failed with error: ${saveError.message}`);
      }
    }
    
    // Step 7: Final summary
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log("\n" + "=".repeat(80));
    console.log("🎉 YESTERDAY'S TRANSCRIPT FETCH COMPLETED!");
    console.log("=".repeat(80));
    
    console.log("\n📊 FINAL SUMMARY:");
    console.log(`   - 📅 Target date: ${yesterdayDate}`);
    console.log(`   - 👤 Target user: ${process.env.TARGET_USER_ID.substring(0, 20)}...`);
    console.log(`   - 📋 Total meetings found: ${allTranscriptsResults.length}`);
    console.log(`   - ✅ Successfully saved: ${savedCount}`);
    console.log(`   - ❌ Failed to save: ${failedCount}`);
    console.log(`   - ⏱️  Total execution time: ${totalDuration}s`);
    
    if (savedTranscripts.length > 0) {
      console.log("\n💾 SAVED TRANSCRIPTS:");
      savedTranscripts.forEach((saved, index) => {
        console.log(`   ${index + 1}. ${saved.meeting}`);
        console.log(`      - Document ID: ${saved.documentId}`);
        console.log(`      - Entries: ${saved.entryCount}`);
        console.log(`      - Size: ${saved.dataSize} characters`);
      });
    }
    
    console.log("\n✅ All transcripts have been fetched and saved to MongoDB transcripts collection");
    console.log("   Database: standuptickets");
    console.log("   Collection: transcripts");
    console.log("\n🎯 What was accomplished:");
    console.log("   - Fetched all meetings for TARGET_USER_ID from yesterday");
    console.log("   - Downloaded all available transcripts");
    console.log("   - Saved transcript data to MongoDB transcripts collection");
    console.log("   - Used existing services for consistency");
    console.log("   - No additional processing performed");
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.error("\n💥 Script Failed!");
    console.error("================");
    console.error(`❌ Error: ${error.message}`);
    console.error(`⏱️  Duration before failure: ${duration}s`);
    
    if (error.stack) {
      console.error("\n📋 Stack trace:");
      console.error(error.stack);
    }
    
    console.error("\n🔧 Troubleshooting tips:");
    console.error("   1. Check environment variables are set correctly");
    console.error("   2. Verify Azure app permissions for Microsoft Graph API");
    console.error("   3. Check MongoDB connection and permissions");
    console.error("   4. Ensure TARGET_USER_ID has access to meeting transcripts");
    console.error("   5. Check if meetings occurred yesterday and had transcription enabled");
    
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

// Run the script
if (require.main === module) {
  console.log("🚀 Starting yesterday's transcript fetch script...\n");
  fetchAndSaveYesterdayTranscripts().catch(error => {
    console.error("Script failed:", error);
    process.exit(1);
  });
}

module.exports = {
  fetchAndSaveYesterdayTranscripts,
  getYesterdayDate
};
