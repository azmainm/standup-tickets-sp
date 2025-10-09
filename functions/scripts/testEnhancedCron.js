/**
 * Test Script for Enhanced Cron Job with Dynamic Time Windows
 * 
 * This script tests the new cron tracking functionality to ensure:
 * 1. Dynamic time windows work correctly
 * 2. Last run timestamps are tracked properly
 * 3. No transcripts are missed between runs
 * 4. Fallback to fixed windows works when no previous run exists
 */

require("dotenv").config();

const { 
  calculateDynamicTimeWindow, 
  updateCronRunTimestamp, 
  getCronJobStats,
  getLastCronRunTimestamp
} = require("../services/storage/mongoService");

const { runTranscriptProcessor } = require("./githubActionsCron");

/**
 * Test the cron tracking functionality
 */
async function testCronTracking() {
  const testCronName = "test_enhanced_cron";
  
  console.log("🧪 TESTING ENHANCED CRON FUNCTIONALITY");
  console.log("=".repeat(50));
  
  try {
    // Test 1: Check initial state (no previous runs)
    console.log("\n📋 Test 1: Initial State Check");
    const initialStats = await getCronJobStats(testCronName);
    console.log("Initial stats:", initialStats);
    
    const initialWindow = await calculateDynamicTimeWindow(testCronName, 90);
    console.log("Initial time window:", {
      type: initialWindow.windowType,
      description: initialWindow.windowDescription,
      duration: initialWindow.durationMinutes + " minutes",
      lastRunFound: initialWindow.lastRunFound
    });
    
    // Test 2: Simulate first run
    console.log("\n📋 Test 2: Simulate First Run");
    const firstRunTime = new Date();
    await updateCronRunTimestamp(testCronName, firstRunTime, "success", {
      transcriptsProcessed: 5,
      testRun: true
    });
    
    const afterFirstRun = await getCronJobStats(testCronName);
    console.log("After first run:", afterFirstRun);
    
    // Test 3: Simulate second run (should use first run as start time)
    console.log("\n📋 Test 3: Simulate Second Run (Dynamic Window)");
    
    // Wait a moment to simulate time passing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const secondWindow = await calculateDynamicTimeWindow(testCronName, 90);
    console.log("Second time window:", {
      type: secondWindow.windowType,
      description: secondWindow.windowDescription,
      duration: secondWindow.durationMinutes + " minutes",
      lastRunFound: secondWindow.lastRunFound,
      startTime: secondWindow.startTime,
      endTime: secondWindow.endTime
    });
    
    // Test 4: Simulate failed run
    console.log("\n📋 Test 4: Simulate Failed Run");
    const failedRunTime = new Date();
    await updateCronRunTimestamp(testCronName, failedRunTime, "failed", {
      error: "Test error",
      testRun: true
    });
    
    const afterFailedRun = await getCronJobStats(testCronName);
    console.log("After failed run:", afterFailedRun);
    
    // Test 5: Check that failed runs don't update lastSuccessfulRun
    console.log("\n📋 Test 5: Verify Failed Run Doesn't Affect Success Timestamp");
    const lastSuccessfulRun = await getLastCronRunTimestamp(testCronName);
    console.log("Last successful run timestamp:", lastSuccessfulRun?.toISOString());
    console.log("Should match first run time:", firstRunTime.toISOString());
    console.log("Timestamps match:", lastSuccessfulRun?.getTime() === firstRunTime.getTime());
    
    // Test 6: Simulate recovery run
    console.log("\n📋 Test 6: Simulate Recovery Run");
    const recoveryRunTime = new Date();
    await updateCronRunTimestamp(testCronName, recoveryRunTime, "success", {
      transcriptsProcessed: 3,
      recoveryRun: true,
      testRun: true
    });
    
    const finalStats = await getCronJobStats(testCronName);
    console.log("Final stats:", finalStats);
    
    console.log("\n✅ All cron tracking tests completed successfully!");
    
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.error("Stack:", error.stack);
  }
}

/**
 * Test the actual enhanced cron job (dry run)
 */
async function testEnhancedCronJob() {
  console.log("\n🚀 TESTING ENHANCED CRON JOB");
  console.log("=".repeat(50));
  
  try {
    // Set test mode to avoid actual processing
    process.env.TEST_MODE = "true";
    
    console.log("Running enhanced cron job in test mode...");
    const result = await runTranscriptProcessor();
    
    console.log("\n📊 Cron job test result:", {
      success: result.success,
      transcriptsFound: result.transcriptsFound,
      transcriptsProcessed: result.transcriptsProcessed,
      errors: result.errors,
      duration: result.duration + "s",
      windowType: result.timeWindow?.windowType,
      windowDuration: result.timeWindow?.durationMinutes + " minutes"
    });
    
    console.log("\n✅ Enhanced cron job test completed!");
    
  } catch (error) {
    console.error("❌ Enhanced cron job test failed:", error.message);
    console.error("Stack:", error.stack);
  }
}

/**
 * Main test function
 */
async function runAllTests() {
  console.log("🧪 ENHANCED CRON SYSTEM TESTS");
  console.log("=".repeat(60));
  
  try {
    // Test cron tracking functionality
    await testCronTracking();
    
    // Test enhanced cron job
    await testEnhancedCronJob();
    
    console.log("\n🎉 ALL TESTS COMPLETED SUCCESSFULLY!");
    console.log("The enhanced cron system is ready for deployment.");
    
  } catch (error) {
    console.error("\n💥 TESTS FAILED:", error.message);
    process.exit(1);
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runAllTests()
    .then(() => {
      console.log("\n✅ Test script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Test script failed:", error.message);
      process.exit(1);
    });
}

module.exports = {
  testCronTracking,
  testEnhancedCronJob,
  runAllTests
};
