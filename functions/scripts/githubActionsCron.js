/**
 * GitHub Actions Cron Job Script
 * 
 * This script replaces the Firebase Functions cron job and runs every 60 minutes
 * to check for meetings that ENDED in the last 60 minutes and process their transcripts.
 * 
 * Key changes from Firebase version:
 * - Runs every 60 minutes instead of daily
 * - Only processes meetings that ENDED in the last 60 minutes (catches long meetings)
 * - Uses environment variables instead of Firebase config
 * - Includes proper error handling and logging for GitHub Actions
 */

require("dotenv").config();

// Import required services with updated paths
const { fetchAllMeetingsForUser } = require("../services/integrations/allMeetingsService");
const { processTranscriptToTasksWithPipeline } = require("../services/core/taskProcessor");
const { getBangladeshTimeComponents } = require("../services/utilities/meetingUrlService");

/**
 * Calculate the time window for the last 60 minutes in UTC
 * @returns {Object} Object with startTime and endTime in ISO format
 */
function calculateLast60MinutesWindow() {
  const now = new Date(); // This is already in UTC
  
  // Calculate 60 minutes ago in UTC
  const sixtyMinutesAgo = new Date(now.getTime() - (60 * 60 * 1000));
  
  // Format for Microsoft Graph API (ISO format) - already in UTC
  const startTime = sixtyMinutesAgo.toISOString();
  const endTime = now.toISOString();
  
  // For display purposes, also calculate Bangladesh time
  const bangladeshTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
  
  return {
    startTime,
    endTime,
    bangladeshTime,
    sixtyMinutesAgo
  };
}

/**
 * Main cron job function
 */
async function runTranscriptProcessor() {
  const startTime = Date.now();
  const isTestMode = process.env.TEST_MODE === "true";
  
  console.log("🚀 GITHUB ACTIONS TRANSCRIPT PROCESSOR STARTED");
  console.log("=".repeat(60));
  
  try {
    // Validate required environment variables
    const requiredEnvVars = [
      "AZURE_CLIENT_ID",
      "AZURE_CLIENT_SECRET", 
      "AZURE_AUTHORITY",
      "TARGET_USER_ID",
      "OPENAI_API_KEY",
      "MONGODB_URI"
    ];
    
    const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(", ")}`);
    }
    
    console.log("✅ Environment variables validated");
    
    // Calculate the 60-minute time window
    const timeWindow = calculateLast60MinutesWindow();
    
    console.log("⏰ Time Window Calculation:");
    console.log(`   Current Bangladesh Time: ${timeWindow.bangladeshTime.toISOString()}`);
    console.log(`   Window Start (60 min ago): ${timeWindow.startTime}`);
    console.log(`   Window End (now): ${timeWindow.endTime}`);
    console.log("   Logic: Processing meetings that ENDED in this window");
    console.log("   Benefit: Catches long meetings regardless of start time");
    console.log(`   Test Mode: ${isTestMode}`);
    
    // Fetch meetings for the target user within the time window
    console.log("📅 Fetching meetings from the last 60 minutes...");
    
    const allTranscripts = await fetchAllMeetingsForUser(
      process.env.TARGET_USER_ID,
      {
        startDateTime: timeWindow.startTime,
        endDateTime: timeWindow.endTime,
        customTimeWindow: true
      }
    );
    
    console.log(`📊 Transcripts found: ${allTranscripts.length}`);
    
    if (allTranscripts.length === 0) {
      console.log("ℹ️  No transcripts found in the last 60 minutes");
      console.log("   This could mean:");
      console.log("   - No meetings ended in the last 60 minutes");
      console.log("   - No transcripts were created in the last 60 minutes");
      console.log("   - All transcripts were filtered out (too old)");
      console.log("✅ Cron job completed successfully (no processing needed)");
      
      return {
        success: true,
        transcriptsFound: 0,
        transcriptsProcessed: 0,
        errors: 0,
        duration: (Date.now() - startTime) / 1000,
        message: "No transcripts found in the time window - early exit"
      };
    }
    
    // The allTranscripts array already contains transcripts from meetings that ended in the time window
    console.log(`📝 Transcripts ready for processing: ${allTranscripts.length}`);
    
    // Process each transcript
    let processedCount = 0;
    let errorCount = 0;
    const results = [];
    
    for (const transcript of allTranscripts) {
      try {
        console.log(`\n🔄 Processing transcript: ${transcript.meetingSubject}`);
        console.log(`   Meeting ID: ${transcript.meetingId}`);
        console.log(`   Transcript Entries: ${transcript.transcript.length}`);
        console.log(`   File Path: ${transcript.filePath}`);
        
        // Process the transcript through the 3-stage pipeline
        const processingResult = await processTranscriptToTasksWithPipeline(
          transcript.transcript,
          {
            meetingId: transcript.meetingId,
            meetingSubject: transcript.meetingSubject,
            startTime: transcript.startTime,
            endTime: transcript.endTime,
            targetDate: timeWindow.bangladeshTime.toISOString().split("T")[0],
            source: "github_actions_cron",
            timeWindow: {
              start: timeWindow.startTime,
              end: timeWindow.endTime
            }
          },
          {}, // processingContext
          { testMode: isTestMode }
        );
        
        if (processingResult.success) {
          processedCount++;
          console.log(`✅ Successfully processed transcript: ${transcript.meetingSubject}`);
          console.log(`   New tasks created: ${processingResult.summary.newTasksCreated}`);
          console.log(`   Existing tasks updated: ${processingResult.summary.existingTasksUpdated}`);
          console.log(`   Status changes applied: ${processingResult.summary.statusChangesApplied}`);
        } else {
          errorCount++;
          console.error(`❌ Failed to process transcript: ${transcript.meetingSubject}`);
        }
        
        results.push({
          meetingId: transcript.meetingId,
          meetingSubject: transcript.meetingSubject,
          success: processingResult.success,
          summary: processingResult.summary
        });
        
      } catch (error) {
        errorCount++;
        console.error(`❌ Error processing transcript ${transcript.meetingSubject}:`, error.message);
        
        results.push({
          meetingId: transcript.meetingId,
          meetingSubject: transcript.meetingSubject,
          success: false,
          error: error.message
        });
      }
    }
    
    // Final summary
    const duration = (Date.now() - startTime) / 1000;
    
    console.log("\n" + "=".repeat(60));
    console.log("📊 FINAL SUMMARY");
    console.log("=".repeat(60));
    console.log(`⏱️  Total Duration: ${duration.toFixed(2)}s`);
    console.log(`📅 Time Window: ${timeWindow.startTime} to ${timeWindow.endTime}`);
    console.log(`📝 Transcripts Found: ${allTranscripts.length}`);
    console.log(`🔄 Transcripts Processed: ${processedCount}`);
    console.log(`✅ Successfully Processed: ${processedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`🧪 Test Mode: ${isTestMode}`);
    
    if (errorCount > 0) {
      console.log("\n⚠️  Some meetings failed to process. Check logs above for details.");
    }
    
    console.log("\n🎉 GitHub Actions cron job completed!");
    
    return {
      success: true,
      transcriptsFound: allTranscripts.length,
      transcriptsProcessed: processedCount,
      errors: errorCount,
      duration: duration,
      timeWindow: timeWindow,
      results: results
    };
    
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    
    console.error("\n" + "=".repeat(60));
    console.error("💥 CRON JOB FAILED");
    console.error("=".repeat(60));
    console.error(`⏱️  Duration: ${duration.toFixed(2)}s`);
    console.error(`❌ Error: ${error.message}`);
    console.error(`📚 Stack: ${error.stack}`);
    
    // Exit with error code for GitHub Actions to detect failure
    process.exit(1);
  }
}

// Run the cron job if this script is executed directly
if (require.main === module) {
  runTranscriptProcessor()
    .then((result) => {
      console.log("\n✅ Cron job completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Cron job failed:", error.message);
      process.exit(1);
    });
}

module.exports = {
  runTranscriptProcessor,
  calculateLast60MinutesWindow
};
