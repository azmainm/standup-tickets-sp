/**
 * Cron Tracking Utilities
 * 
 * Utility functions for managing and monitoring the enhanced cron tracking system.
 * This script provides tools for:
 * 1. Viewing cron job history and statistics
 * 2. Manually resetting cron timestamps (for testing/recovery)
 * 3. Monitoring time windows and potential gaps
 * 4. Debugging cron job issues
 */

require("dotenv").config();

const { 
  getCronJobStats,
  getLastCronRunTimestamp,
  updateCronRunTimestamp,
  calculateDynamicTimeWindow,
  initializeMongoDB
} = require("../services/storage/mongoService");

/**
 * Display comprehensive cron job statistics
 */
async function showCronStats(cronJobName = "github_actions_transcript_processor") {
  try {
    console.log("📊 CRON JOB STATISTICS");
    console.log("=".repeat(50));
    
    const stats = await getCronJobStats(cronJobName);
    
    if (!stats.exists) {
      console.log("❌ No cron job records found for:", cronJobName);
      console.log("   This means the enhanced cron has never run successfully.");
      return;
    }
    
    console.log(`📋 Job Name: ${stats.cronJobName}`);
    console.log(`🔢 Total Runs: ${stats.totalRuns}`);
    console.log(`📅 Last Run: ${stats.lastRun?.toISOString() || "Never"}`);
    console.log(`✅ Last Successful Run: ${stats.lastSuccessfulRun?.toISOString() || "Never"}`);
    console.log(`📊 Last Status: ${stats.lastStatus || "Unknown"}`);
    console.log(`🕐 Last Updated: ${stats.lastUpdated?.toISOString() || "Never"}`);
    
    if (stats.lastSuccessfulRun) {
      const timeSinceLastSuccess = Math.round((new Date() - stats.lastSuccessfulRun) / (1000 * 60));
      console.log(`⏱️  Time Since Last Success: ${timeSinceLastSuccess} minutes`);
      
      if (timeSinceLastSuccess > 120) {
        console.log("⚠️  WARNING: It's been over 2 hours since last successful run!");
      }
    }
    
    // Show current time window
    const currentWindow = await calculateDynamicTimeWindow(cronJobName);
    console.log("\n🕐 CURRENT TIME WINDOW");
    console.log(`   Type: ${currentWindow.windowType}`);
    console.log(`   Description: ${currentWindow.windowDescription}`);
    console.log(`   Duration: ${currentWindow.durationMinutes} minutes`);
    console.log(`   Start: ${currentWindow.startTime}`);
    console.log(`   End: ${currentWindow.endTime}`);
    
    if (currentWindow.durationMinutes > 300) {
      console.log("⚠️  WARNING: Time window is very large (>5 hours). This might process many transcripts.");
    }
    
  } catch (error) {
    console.error("❌ Error showing cron stats:", error.message);
  }
}

/**
 * Reset cron job timestamp (for testing or recovery)
 */
async function resetCronTimestamp(cronJobName = "github_actions_transcript_processor", minutesAgo = 90) {
  try {
    console.log("🔄 RESETTING CRON TIMESTAMP");
    console.log("=".repeat(50));
    
    const resetTime = new Date(Date.now() - (minutesAgo * 60 * 1000));
    
    console.log(`Setting last successful run to: ${resetTime.toISOString()}`);
    console.log(`This is ${minutesAgo} minutes ago`);
    
    const confirmation = await askForConfirmation(
      `Are you sure you want to reset the cron timestamp for '${cronJobName}'? (y/N): `
    );
    
    if (!confirmation) {
      console.log("❌ Reset cancelled");
      return;
    }
    
    await updateCronRunTimestamp(cronJobName, resetTime, "success", {
      manualReset: true,
      resetBy: "cronTrackingUtils",
      resetAt: new Date().toISOString(),
      previousTimestamp: await getLastCronRunTimestamp(cronJobName)
    });
    
    console.log("✅ Cron timestamp reset successfully");
    
    // Show new stats
    await showCronStats(cronJobName);
    
  } catch (error) {
    console.error("❌ Error resetting cron timestamp:", error.message);
  }
}

/**
 * Simulate a cron run for testing
 */
async function simulateCronRun(cronJobName = "github_actions_transcript_processor", status = "success", metadata = {}) {
  try {
    console.log("🧪 SIMULATING CRON RUN");
    console.log("=".repeat(50));
    
    const runTime = new Date();
    
    console.log(`Simulating ${status} run at: ${runTime.toISOString()}`);
    
    await updateCronRunTimestamp(cronJobName, runTime, status, {
      ...metadata,
      simulation: true,
      simulatedBy: "cronTrackingUtils",
      simulatedAt: runTime.toISOString()
    });
    
    console.log("✅ Cron run simulated successfully");
    
    // Show updated stats
    await showCronStats(cronJobName);
    
  } catch (error) {
    console.error("❌ Error simulating cron run:", error.message);
  }
}

/**
 * Check for potential transcript gaps
 */
async function checkForGaps(cronJobName = "github_actions_transcript_processor") {
  try {
    console.log("🔍 CHECKING FOR POTENTIAL TRANSCRIPT GAPS");
    console.log("=".repeat(50));
    
    const stats = await getCronJobStats(cronJobName);
    
    if (!stats.exists || !stats.lastSuccessfulRun) {
      console.log("ℹ️  No previous successful runs found - no gaps to check");
      return;
    }
    
    const now = new Date();
    const timeSinceLastRun = Math.round((now - stats.lastSuccessfulRun) / (1000 * 60));
    
    console.log(`⏱️  Time since last successful run: ${timeSinceLastRun} minutes`);
    
    // Check for various gap scenarios
    if (timeSinceLastRun > 180) {
      console.log("🚨 CRITICAL: Gap > 3 hours - High risk of missing transcripts!");
    } else if (timeSinceLastRun > 120) {
      console.log("⚠️  WARNING: Gap > 2 hours - Moderate risk of missing transcripts");
    } else if (timeSinceLastRun > 90) {
      console.log("⚠️  CAUTION: Gap > 90 minutes - Some transcripts might be missed");
    } else {
      console.log("✅ Gap is within normal range (< 90 minutes)");
    }
    
    // Show what the next run would process
    const nextWindow = await calculateDynamicTimeWindow(cronJobName);
    console.log("\n📅 Next run would process:");
    console.log(`   Time window: ${nextWindow.durationMinutes} minutes`);
    console.log(`   From: ${nextWindow.startTime}`);
    console.log(`   To: ${nextWindow.endTime}`);
    
    if (nextWindow.durationMinutes > 240) {
      console.log("⚠️  Large time window - next run might take longer than usual");
    }
    
  } catch (error) {
    console.error("❌ Error checking for gaps:", error.message);
  }
}

/**
 * Simple confirmation prompt
 */
function askForConfirmation(question) {
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Main CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const cronJobName = args[1] || "github_actions_transcript_processor";
  
  console.log("🛠️  CRON TRACKING UTILITIES");
  console.log("=".repeat(60));
  
  try {
    await initializeMongoDB();
    
    switch (command) {
      case 'stats':
        await showCronStats(cronJobName);
        break;
        
      case 'reset':
        const minutesAgo = parseInt(args[2]) || 90;
        await resetCronTimestamp(cronJobName, minutesAgo);
        break;
        
      case 'simulate':
        const status = args[2] || "success";
        const metadata = args[3] ? JSON.parse(args[3]) : { testRun: true };
        await simulateCronRun(cronJobName, status, metadata);
        break;
        
      case 'gaps':
        await checkForGaps(cronJobName);
        break;
        
      default:
        console.log("📋 Available commands:");
        console.log("   stats [cronJobName]                    - Show cron job statistics");
        console.log("   reset [cronJobName] [minutesAgo]       - Reset cron timestamp");
        console.log("   simulate [cronJobName] [status] [meta] - Simulate a cron run");
        console.log("   gaps [cronJobName]                     - Check for potential gaps");
        console.log("");
        console.log("📝 Examples:");
        console.log("   node cronTrackingUtils.js stats");
        console.log("   node cronTrackingUtils.js reset github_actions_transcript_processor 120");
        console.log("   node cronTrackingUtils.js simulate github_actions_transcript_processor success");
        console.log("   node cronTrackingUtils.js gaps");
        break;
    }
    
  } catch (error) {
    console.error("❌ Command failed:", error.message);
    process.exit(1);
  }
}

// Run CLI if this script is executed directly
if (require.main === module) {
  main()
    .then(() => {
      console.log("\n✅ Command completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Command failed:", error.message);
      process.exit(1);
    });
}

module.exports = {
  showCronStats,
  resetCronTimestamp,
  simulateCronRun,
  checkForGaps
};
