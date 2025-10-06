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
 * Calculate the time window for the last 60 minutes in Bangladesh time
 * @returns {Object} Object with startTime and endTime in ISO format
 */
function calculateLast60MinutesWindow() {
  const now = new Date();
  const bangladeshTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
  
  // Calculate 60 minutes ago
  const sixtyMinutesAgo = new Date(bangladeshTime.getTime() - (60 * 60 * 1000));
  
  // Format for Microsoft Graph API (ISO format)
  const startTime = sixtyMinutesAgo.toISOString();
  const endTime = bangladeshTime.toISOString();
  
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
  const isTestMode = process.env.TEST_MODE === 'true';
  
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
    console.log(`   Logic: Processing meetings that ENDED in this window`);
    console.log(`   Benefit: Catches long meetings regardless of start time`);
    console.log(`   Test Mode: ${isTestMode}`);
    
    // Fetch meetings for the target user within the time window
    console.log("📅 Fetching meetings from the last 60 minutes...");
    
    const meetingsResult = await fetchAllMeetingsForUser(
      process.env.TARGET_USER_ID,
      {
        startDateTime: timeWindow.startTime,
        endDateTime: timeWindow.endTime,
        customTimeWindow: true
      }
    );
    
    if (!meetingsResult.success) {
      throw new Error(`Failed to fetch meetings: ${meetingsResult.error}`);
    }
    
    console.log(`📊 Meetings found: ${meetingsResult.meetings.length}`);
    
    if (meetingsResult.meetings.length === 0) {
      console.log("ℹ️  No meetings found in the last 60 minutes");
      console.log("✅ Cron job completed successfully (no processing needed)");
      return {
        success: true,
        meetingsFound: 0,
        transcriptsProcessed: 0,
        message: "No meetings found in the time window"
      };
    }
    
    // Filter meetings that have transcripts and ENDED within the time window
    const meetingsWithTranscripts = meetingsResult.meetings.filter(meeting => {
      if (!meeting.transcript || meeting.transcript.length === 0) {
        return false;
      }
      
      // Check if meeting ENDED within the last 60 minutes (regardless of start time)
      const meetingEnd = new Date(meeting.endTime);
      const windowStart = new Date(timeWindow.startTime);
      const windowEnd = new Date(timeWindow.endTime);
      
      // Only check if the meeting ended within our time window
      const endedInWindow = meetingEnd >= windowStart && meetingEnd <= windowEnd;
      
      return endedInWindow;
    });
    
    console.log(`📝 Meetings with transcripts that ended in time window: ${meetingsWithTranscripts.length}`);
    
    if (meetingsWithTranscripts.length === 0) {
      console.log("ℹ️  No meetings with transcripts found in the time window");
      console.log("✅ Cron job completed successfully (no transcripts to process)");
      return {
        success: true,
        meetingsFound: meetingsResult.meetings.length,
        transcriptsProcessed: 0,
        message: "No transcripts found in the time window"
      };
    }
    
    // Process each transcript
    let processedCount = 0;
    let errorCount = 0;
    const results = [];
    
    for (const meeting of meetingsWithTranscripts) {
      try {
        console.log(`\n🔄 Processing meeting: ${meeting.subject}`);
        console.log(`   Meeting ID: ${meeting.id}`);
        console.log(`   Start Time: ${meeting.startTime}`);
        console.log(`   End Time: ${meeting.endTime}`);
        
        // Calculate meeting duration
        const startTime = new Date(meeting.startTime);
        const endTime = new Date(meeting.endTime);
        const durationMinutes = Math.round((endTime - startTime) / (1000 * 60));
        console.log(`   Duration: ${durationMinutes} minutes`);
        console.log(`   Transcript Entries: ${meeting.transcript.length}`);
        
        // Process the transcript through the 3-stage pipeline
        const processingResult = await processTranscriptToTasksWithPipeline(
          meeting.transcript,
          {
            meetingId: meeting.id,
            meetingSubject: meeting.subject,
            startTime: meeting.startTime,
            endTime: meeting.endTime,
            targetDate: timeWindow.bangladeshTime.toISOString().split('T')[0],
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
          console.log(`✅ Successfully processed meeting: ${meeting.subject}`);
          console.log(`   New tasks created: ${processingResult.summary.newTasksCreated}`);
          console.log(`   Existing tasks updated: ${processingResult.summary.existingTasksUpdated}`);
          console.log(`   Status changes applied: ${processingResult.summary.statusChangesApplied}`);
        } else {
          errorCount++;
          console.error(`❌ Failed to process meeting: ${meeting.subject}`);
        }
        
        results.push({
          meetingId: meeting.id,
          meetingSubject: meeting.subject,
          success: processingResult.success,
          summary: processingResult.summary
        });
        
      } catch (error) {
        errorCount++;
        console.error(`❌ Error processing meeting ${meeting.subject}:`, error.message);
        
        results.push({
          meetingId: meeting.id,
          meetingSubject: meeting.subject,
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
    console.log(`🔍 Meetings Found: ${meetingsResult.meetings.length}`);
    console.log(`📝 Meetings with Transcripts: ${meetingsWithTranscripts.length}`);
    console.log(`✅ Successfully Processed: ${processedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`🧪 Test Mode: ${isTestMode}`);
    
    if (errorCount > 0) {
      console.log("\n⚠️  Some meetings failed to process. Check logs above for details.");
    }
    
    console.log("\n🎉 GitHub Actions cron job completed!");
    
    return {
      success: true,
      meetingsFound: meetingsResult.meetings.length,
      meetingsWithTranscripts: meetingsWithTranscripts.length,
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
