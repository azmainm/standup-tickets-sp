/**
 * GitHub Actions Cron Job Script
 * 
 * This script replaces the Firebase Functions cron job and runs every 60 minutes
 * to check for meetings that ENDED in the last 90 minutes and process their transcripts.
 * 
 * Key changes from Firebase version:
 * - Runs every 60 minutes instead of daily
 * - Only processes meetings that ENDED in the last 90 minutes (catches long meetings)
 * - Uses environment variables instead of Firebase config
 * - Includes proper error handling and logging for GitHub Actions
 */

require("dotenv").config();

// Import required services with updated paths
const { fetchAllMeetingsForUser } = require("../services/integrations/allMeetingsService");
const { processTranscriptToTasksWithPipeline } = require("../services/core/taskProcessor");
const { 
  calculateDynamicTimeWindow, 
  updateCronRunTimestamp, 
  getCronJobStats 
} = require("../services/storage/mongoService");
const { testJiraConnection } = require("../services/integrations/jiraService");
// const { getBangladeshTimeComponents } = require("../services/utilities/meetingUrlService");

/**
 * LEGACY: Calculate the time window for the last 90 minutes in UTC
 * This function is kept for backward compatibility but is no longer used.
 * The new system uses calculateDynamicTimeWindow from mongoService.
 * @returns {Object} Object with startTime and endTime in ISO format
 */
function calculateLast60MinutesWindow() {
  const now = new Date(); // This is already in UTC
  
  // Calculate 90 minutes ago in UTC
  const ninetyMinutesAgo = new Date(now.getTime() - (90 * 60 * 1000));
  
  // Format for Microsoft Graph API (ISO format) - already in UTC
  const startTime = ninetyMinutesAgo.toISOString();
  const endTime = now.toISOString();
  
  return {
    startTime,
    endTime,
    now,
    ninetyMinutesAgo
  };
}

/**
 * Main cron job function
 */
async function runTranscriptProcessor() {
  const startTime = Date.now();
  const runStartTime = new Date();
  const isTestMode = process.env.TEST_MODE === "true";
  const cronJobName = "github_actions_transcript_processor";
  
  console.log("🚀 GITHUB ACTIONS TRANSCRIPT PROCESSOR STARTED (ENHANCED)");
  console.log("=".repeat(70));
  
  try {
    // Mark cron job as started
    await updateCronRunTimestamp(cronJobName, runStartTime, "started", {
      testMode: isTestMode,
      startedAt: runStartTime.toISOString()
    });
    
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
    
    // Validate Jira integration setup
    console.log("\n🔧 JIRA INTEGRATION CHECK");
    console.log("=".repeat(70));
    
    const jiraEnvVars = {
      JIRA_URL: process.env.JIRA_URL,
      JIRA_EMAIL: process.env.JIRA_EMAIL,
      JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
      JIRA_PROJECT_KEY: process.env.JIRA_PROJECT_KEY
    };
    
    const hasJiraCredentials = Object.values(jiraEnvVars).every(val => val && val.trim());
    
    if (!hasJiraCredentials) {
      const missingJiraVars = Object.entries(jiraEnvVars)
        .filter(([_, val]) => !val || !val.trim())
        .map(([key, _]) => key);
      
      console.log("⚠️  Jira Integration: DISABLED (Optional)");
      console.log(`   Missing credentials: ${missingJiraVars.join(", ")}`);
      console.log("   Tasks will be extracted but NOT created in Jira");
      console.log("   To enable: Set all Jira environment variables in GitHub Secrets");
    } else {
      console.log("🔍 Jira credentials found - Testing connection...");
      console.log(`   JIRA_URL: ${jiraEnvVars.JIRA_URL}`);
      console.log(`   JIRA_EMAIL: ${jiraEnvVars.JIRA_EMAIL}`);
      console.log(`   JIRA_PROJECT_KEY: ${jiraEnvVars.JIRA_PROJECT_KEY}`);
      console.log(`   JIRA_API_TOKEN: ${jiraEnvVars.JIRA_API_TOKEN ? "***SET***" : "NOT SET"}`);
      
      const jiraConnectionSuccess = await testJiraConnection();
      
      if (jiraConnectionSuccess) {
        console.log("✅ Jira Integration: READY");
        console.log("   Connection test: SUCCESS");
        console.log("   🎯 Jira tasks WILL be created when tasks are found in transcripts");
      } else {
        console.log("❌ Jira Integration: CONNECTION FAILED");
        console.log("   Connection test: FAILED");
        console.log("   Possible issues:");
        console.log("   - JIRA_URL is malformed (should be: https://yourcompany.atlassian.net)");
        console.log("   - JIRA_EMAIL is incorrect");
        console.log("   - JIRA_API_TOKEN is invalid or expired");
        console.log("   - Network/firewall blocking connection to Jira");
        console.log("   ⚠️  Tasks will be extracted but NOT created in Jira until this is fixed");
      }
    }
    
    console.log("=".repeat(70));
    
    // Get cron job statistics for logging
    const cronStats = await getCronJobStats(cronJobName);
    console.log("📊 Cron Job History:", {
      totalPreviousRuns: cronStats.totalRuns || 0,
      lastSuccessfulRun: cronStats.lastSuccessfulRun?.toISOString() || "Never",
      lastStatus: cronStats.lastStatus || "Unknown",
      timeSinceLastRun: cronStats.lastSuccessfulRun ? 
        Math.round((runStartTime - cronStats.lastSuccessfulRun) / (1000 * 60)) + " minutes" : 
        "N/A"
    });
    
    // Calculate dynamic time window based on last successful run
    const timeWindow = await calculateDynamicTimeWindow(cronJobName, 90);
    
    console.log("⏰ ENHANCED Time Window Calculation:");
    console.log(`   Window Type: ${timeWindow.windowType}`);
    console.log(`   Description: ${timeWindow.windowDescription}`);
    console.log(`   Window Start: ${timeWindow.startTime}`);
    console.log(`   Window End: ${timeWindow.endTime}`);
    console.log(`   Duration: ${timeWindow.durationMinutes} minutes`);
    console.log(`   Last Run Found: ${timeWindow.lastRunFound ? "✅ Yes" : "❌ No (using fallback)"}`);
    console.log("   Logic: Find meetings in calendar window → Process ALL their transcripts");
    console.log("   Benefit: No transcript gaps - processes ALL transcripts for meetings found");
    console.log(`   Test Mode: ${isTestMode}`);
    
    // Fetch meetings for the target user within the extended calendar window
    console.log("📅 Fetching meetings from extended calendar window...");
    console.log(`   Calendar Window: ${timeWindow.calendarStartTime} to ${timeWindow.calendarEndTime}`);
    console.log(
      `   Lookback: ${timeWindow.calendarExtensionHours} hours to catch meetings with delayed/early transcripts`
    );
    console.log("   Transcript Filtering: Process ALL transcripts (duplicate prevention only)");
    
    const allTranscripts = await fetchAllMeetingsForUser(
      process.env.TARGET_USER_ID,
      {
        startDateTime: timeWindow.calendarStartTime, // Use extended calendar window
        endDateTime: timeWindow.calendarEndTime,
        processingStartDateTime: timeWindow.startTime, // Pass processing window for filtering
        processingEndDateTime: timeWindow.endTime,
        customTimeWindow: true
      }
    );
    
    console.log(`📊 Transcripts found: ${allTranscripts.length}`);
    
    if (allTranscripts.length === 0) {
      console.log(`ℹ️  No transcripts found in the time window (${timeWindow.windowDescription})`);
      console.log("   This could mean:");
      console.log("   - No meetings ended in the specified time window");
      console.log("   - No transcripts were created in the specified time window");
      console.log("   - All transcripts were filtered out (too old)");
      console.log("✅ Cron job completed successfully (no processing needed)");
      
      const earlyExitResult = {
        success: true,
        transcriptsFound: 0,
        transcriptsProcessed: 0,
        errors: 0,
        duration: (Date.now() - startTime) / 1000,
        timeWindow: timeWindow,
        message: "No transcripts found in the time window - early exit"
      };
      
      // Still mark as successful run to update the timestamp
      await updateCronRunTimestamp(cronJobName, runStartTime, "success", {
        ...earlyExitResult,
        completedAt: new Date().toISOString(),
        windowType: timeWindow.windowType,
        windowDurationMinutes: timeWindow.durationMinutes,
        earlyExit: true
      });
      
      console.log("✅ Cron run timestamp updated (early exit)");
      
      return earlyExitResult;
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
            targetDate: timeWindow.now.toISOString().split("T")[0],
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
    
    // Mark cron job as successful and update timestamp
    const finalResult = {
      success: true,
      transcriptsFound: allTranscripts.length,
      transcriptsProcessed: processedCount,
      errors: errorCount,
      duration: duration,
      timeWindow: timeWindow,
      results: results
    };
    
    await updateCronRunTimestamp(cronJobName, runStartTime, "success", {
      ...finalResult,
      completedAt: new Date().toISOString(),
      windowType: timeWindow.windowType,
      windowDurationMinutes: timeWindow.durationMinutes
    });
    
    console.log("✅ Cron run timestamp updated successfully");
    
    return finalResult;
    
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    
    console.error("\n" + "=".repeat(60));
    console.error("💥 CRON JOB FAILED");
    console.error("=".repeat(60));
    console.error(`⏱️  Duration: ${duration.toFixed(2)}s`);
    console.error(`❌ Error: ${error.message}`);
    console.error(`📚 Stack: ${error.stack}`);
    
    // Mark cron job as failed (but don't throw if this fails)
    try {
      await updateCronRunTimestamp(cronJobName, runStartTime, "failed", {
        error: error.message,
        stack: error.stack,
        duration: duration,
        failedAt: new Date().toISOString()
      });
      console.error("❌ Cron run marked as failed in database");
    } catch (updateError) {
      console.error("⚠️  Failed to update cron failure status:", updateError.message);
    }
    
    // Exit with error code for GitHub Actions to detect failure
    process.exit(1);
  }
}

// Run the cron job if this script is executed directly
if (require.main === module) {
  runTranscriptProcessor()
    .then((_result) => {
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
