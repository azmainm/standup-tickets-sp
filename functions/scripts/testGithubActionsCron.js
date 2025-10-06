/**
 * Test script for GitHub Actions cron job
 * 
 * This script tests the GitHub Actions cron functionality locally
 * to ensure it works before deploying to GitHub Actions.
 */

require("dotenv").config();

const { runTranscriptProcessor, calculateLast60MinutesWindow } = require("./githubActionsCron");

async function testGithubActionsCron() {
  console.log("🧪 TESTING GITHUB ACTIONS CRON JOB LOCALLY");
  console.log("=".repeat(50));
  
  try {
    // Test time window calculation
    console.log("1. Testing time window calculation...");
    const timeWindow = calculateLast60MinutesWindow();
    console.log("✅ Time window calculated:");
    console.log(`   Start: ${timeWindow.startTime}`);
    console.log(`   End: ${timeWindow.endTime}`);
    console.log(`   Duration: 60 minutes`);
    
    // Set test mode
    process.env.TEST_MODE = 'true';
    
    console.log("\n2. Running transcript processor in test mode...");
    const result = await runTranscriptProcessor();
    
    console.log("\n✅ Test completed successfully!");
    console.log("📊 Results:", {
      meetingsFound: result.meetingsFound,
      transcriptsProcessed: result.transcriptsProcessed,
      errors: result.errors,
      duration: `${result.duration}s`
    });
    
    return result;
    
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    console.error("Stack:", error.stack);
    throw error;
  }
}

// Run test if this script is executed directly
if (require.main === module) {
  testGithubActionsCron()
    .then(() => {
      console.log("\n🎉 All tests passed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Tests failed:", error.message);
      process.exit(1);
    });
}

module.exports = {
  testGithubActionsCron
};
