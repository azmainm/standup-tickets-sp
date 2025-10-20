/**
 * Transcript Processing Utilities
 * 
 * This script provides utilities for testing and monitoring the enhanced transcript processing system
 * with duplicate prevention and extended calendar windows.
 */

require("dotenv").config();

const { 
  getProcessedTranscriptStats, 
  cleanupOldProcessedTranscripts,
  getCronJobStats,
  calculateDynamicTimeWindow 
} = require("../services/storage/mongoService");

/**
 * Show statistics about processed transcripts
 */
async function showProcessedTranscriptStats() {
  try {
    console.log("📊 PROCESSED TRANSCRIPT STATISTICS");
    console.log("=".repeat(50));
    
    const stats = await getProcessedTranscriptStats(7);
    
    console.log(`Total Processed: ${stats.totalProcessed}`);
    console.log(`Recent (7 days): ${stats.recentProcessed}`);
    console.log(`\nRecent Transcripts:`);
    
    if (stats.recentTranscripts.length > 0) {
      stats.recentTranscripts.forEach((transcript, index) => {
        console.log(`  ${index + 1}. ${transcript.meetingSubject}`);
        console.log(`     ID: ${transcript.transcriptId}`);
        console.log(`     Processed: ${transcript.processedAt}`);
        console.log("");
      });
    } else {
      console.log("  No recent transcripts found");
    }
    
  } catch (error) {
    console.error("❌ Error getting processed transcript stats:", error.message);
  }
}

/**
 * Show cron job statistics and next window calculation
 */
async function showCronJobStats() {
  try {
    console.log("⏰ CRON JOB STATISTICS");
    console.log("=".repeat(50));
    
    const cronJobName = "github_actions_transcript_processor";
    const stats = await getCronJobStats(cronJobName);
    
    console.log(`Job Name: ${cronJobName}`);
    console.log(`Total Runs: ${stats.totalRuns}`);
    console.log(`Last Run: ${stats.lastRun?.toISOString() || 'Never'}`);
    console.log(`Last Successful Run: ${stats.lastSuccessfulRun?.toISOString() || 'Never'}`);
    console.log(`Last Status: ${stats.lastStatus || 'Unknown'}`);
    
    if (stats.lastSuccessfulRun) {
      const timeSinceLastRun = Math.round((new Date() - stats.lastSuccessfulRun) / (1000 * 60));
      console.log(`Time Since Last Success: ${timeSinceLastRun} minutes`);
    }
    
    console.log("\n🔮 NEXT PROCESSING WINDOW");
    console.log("-".repeat(30));
    
    const timeWindow = await calculateDynamicTimeWindow(cronJobName, 90, 3);
    
    console.log(`Window Type: ${timeWindow.windowType}`);
    console.log(`Processing Window: ${timeWindow.startTime} to ${timeWindow.endTime}`);
    console.log(`Calendar Window: ${timeWindow.calendarStartTime} to ${timeWindow.calendarEndTime}`);
    console.log(`Duration: ${timeWindow.durationMinutes} minutes`);
    console.log(`Calendar Extension: ${timeWindow.calendarExtensionHours} hours backwards`);
    console.log(`Description: ${timeWindow.windowDescription}`);
    
  } catch (error) {
    console.error("❌ Error getting cron job stats:", error.message);
  }
}

/**
 * Clean up old processed transcript records
 */
async function cleanupOldRecords(daysToKeep = 90) {
  try {
    console.log(`🧹 CLEANING UP OLD PROCESSED TRANSCRIPT RECORDS`);
    console.log(`Keeping records from last ${daysToKeep} days...`);
    
    const deletedCount = await cleanupOldProcessedTranscripts(daysToKeep);
    
    console.log(`✅ Cleaned up ${deletedCount} old records`);
    
  } catch (error) {
    console.error("❌ Error cleaning up old records:", error.message);
  }
}

/**
 * Test the enhanced system configuration
 */
async function testSystemConfiguration() {
  try {
    console.log("🧪 TESTING ENHANCED SYSTEM CONFIGURATION");
    console.log("=".repeat(50));
    
    // Test environment variables
    const requiredEnvVars = [
      "AZURE_CLIENT_ID",
      "AZURE_CLIENT_SECRET", 
      "AZURE_AUTHORITY",
      "TARGET_USER_ID",
      "OPENAI_API_KEY",
      "MONGODB_URI"
    ];
    
    console.log("Environment Variables:");
    const missingVars = [];
    requiredEnvVars.forEach(envVar => {
      const exists = !!process.env[envVar];
      console.log(`  ${envVar}: ${exists ? '✅' : '❌'}`);
      if (!exists) missingVars.push(envVar);
    });
    
    if (missingVars.length > 0) {
      console.log(`\n❌ Missing environment variables: ${missingVars.join(", ")}`);
      return;
    }
    
    console.log("\n✅ All environment variables present");
    
    // Test MongoDB connection and functions
    console.log("\nTesting MongoDB Functions:");
    
    try {
      const stats = await getProcessedTranscriptStats(1);
      console.log("  ✅ getProcessedTranscriptStats");
    } catch (error) {
      console.log("  ❌ getProcessedTranscriptStats:", error.message);
    }
    
    try {
      const cronStats = await getCronJobStats();
      console.log("  ✅ getCronJobStats");
    } catch (error) {
      console.log("  ❌ getCronJobStats:", error.message);
    }
    
    try {
      const timeWindow = await calculateDynamicTimeWindow();
      console.log("  ✅ calculateDynamicTimeWindow");
    } catch (error) {
      console.log("  ❌ calculateDynamicTimeWindow:", error.message);
    }
    
    console.log("\n🎉 System configuration test completed!");
    
  } catch (error) {
    console.error("❌ Error testing system configuration:", error.message);
  }
}

/**
 * Main function to handle command line arguments
 */
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'stats':
      await showProcessedTranscriptStats();
      break;
      
    case 'cron':
      await showCronJobStats();
      break;
      
    case 'cleanup':
      const days = parseInt(process.argv[3]) || 90;
      await cleanupOldRecords(days);
      break;
      
    case 'test':
      await testSystemConfiguration();
      break;
      
    case 'all':
      await testSystemConfiguration();
      console.log("\n");
      await showCronJobStats();
      console.log("\n");
      await showProcessedTranscriptStats();
      break;
      
    default:
      console.log("📋 TRANSCRIPT PROCESSING UTILITIES");
      console.log("=".repeat(40));
      console.log("Usage: node transcriptProcessingUtils.js <command>");
      console.log("");
      console.log("Commands:");
      console.log("  stats     - Show processed transcript statistics");
      console.log("  cron      - Show cron job statistics and next window");
      console.log("  cleanup   - Clean up old processed transcript records");
      console.log("  test      - Test system configuration");
      console.log("  all       - Run all commands");
      console.log("");
      console.log("Examples:");
      console.log("  node transcriptProcessingUtils.js stats");
      console.log("  node transcriptProcessingUtils.js cron");
      console.log("  node transcriptProcessingUtils.js cleanup 60");
      console.log("  node transcriptProcessingUtils.js test");
      break;
  }
  
  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error("💥 Script failed:", error.message);
    process.exit(1);
  });
}

module.exports = {
  showProcessedTranscriptStats,
  showCronJobStats,
  cleanupOldRecords,
  testSystemConfiguration
};
