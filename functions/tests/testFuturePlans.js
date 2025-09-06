/**
 * Test future plans detection functionality
 * 
 * This test validates that the system correctly detects future plan language
 * and creates tasks with isFuturePlan: true assigned to "TBD"
 */

const { processTranscriptForTasks } = require("../services/openaiService");
const { logger } = require("firebase-functions");

// Load environment variablesz
require("dotenv").config();

// Sample transcript with future plan mentions
const sampleTranscript = [
  {
    speaker: "00:00:10.000",
    text: "<v John Doe>Hi everyone, let's start our standup</v>",
    startTime: "00:00:10.000",
    endTime: "00:00:12.000"
  },
  {
    speaker: "00:00:15.000", 
    text: "<v Jane Smith>I completed SP-45 yesterday, took about 3 hours to finish the authentication bug fix</v>",
    startTime: "00:00:15.000",
    endTime: "00:00:20.000"
  },
  {
    speaker: "00:00:25.000",
    text: "<v John Doe>Great work! I have a new task to implement the search functionality, should take around 5 hours</v>",
    startTime: "00:00:25.000",
    endTime: "00:00:30.000"
  },
  {
    speaker: "00:00:35.000",
    text: "<v Jane Smith>Mobile app development is a future plan we should consider for Q2. It's not urgent but should be on our roadmap</v>",
    startTime: "00:00:35.000",
    endTime: "00:00:42.000"
  },
  {
    speaker: "00:00:45.000",
    text: "<v John Doe>API rate limiting would be a future enhancement when we scale up. Something for later</v>",
    startTime: "00:00:45.000",
    endTime: "00:00:50.000"
  }
];

async function testFuturePlansDetection() {
  try {
    console.log("🧪 Testing Future Plans Detection");
    console.log("=====================================");
    
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error("❌ OPENAI_API_KEY environment variable is not set");
      console.log("\nPlease set your OpenAI API key in the .env file:");
      console.log("OPENAI_API_KEY=your-api-key-here");
      return;
    }
    
    console.log("📝 Processing sample transcript with future plan mentions...");
    console.log(`Transcript entries: ${sampleTranscript.length}`);
    
    // Process the transcript with OpenAI
    const result = await processTranscriptForTasks(sampleTranscript);
    
    if (!result.success) {
      console.error("❌ OpenAI processing failed:", result.error);
      return;
    }
    
    console.log("\n✅ OpenAI processing completed successfully");
    console.log(`📊 Tokens used: ${result.metadata.tokensUsed}`);
    console.log(`👥 Participants found: ${result.metadata.participantCount}`);
    
    // Analyze the extracted tasks
    console.log("\n📋 Extracted Tasks:");
    console.log("===================");
    
    let totalTasks = 0;
    let futurePlansFound = 0;
    let regularTasksFound = 0;
    
    for (const [participant, tasks] of Object.entries(result.tasks)) {
      console.log(`\n👤 ${participant}:`);
      
      // Check Coding tasks
      if (tasks.Coding && tasks.Coding.length > 0) {
        console.log("  🔧 Coding Tasks:");
        tasks.Coding.forEach((task, index) => {
          const isFuture = task.isFuturePlan ? "🔮 FUTURE PLAN" : "📝 REGULAR TASK";
          const status = task.status || "To-do";
          console.log(`    ${index + 1}. ${task.description} [${isFuture}] [Status: ${status}]`);
          totalTasks++;
          if (task.isFuturePlan) futurePlansFound++;
          else regularTasksFound++;
        });
      }
      
      // Check Non-Coding tasks
      if (tasks["Non-Coding"] && tasks["Non-Coding"].length > 0) {
        console.log("  📚 Non-Coding Tasks:");
        tasks["Non-Coding"].forEach((task, index) => {
          const isFuture = task.isFuturePlan ? "🔮 FUTURE PLAN" : "📝 REGULAR TASK";
          const status = task.status || "To-do";
          console.log(`    ${index + 1}. ${task.description} [${isFuture}] [Status: ${status}]`);
          totalTasks++;
          if (task.isFuturePlan) futurePlansFound++;
          else regularTasksFound++;
        });
      }
    }
    
    // Summary
    console.log("\n📊 Summary:");
    console.log("============");
    console.log(`Total tasks extracted: ${totalTasks}`);
    console.log(`Regular tasks: ${regularTasksFound}`);
    console.log(`Future plans: ${futurePlansFound}`);
    
    // Validation
    console.log("\n✅ Validation Results:");
    console.log("======================");
    
    if (futurePlansFound > 0) {
      console.log("✅ Future plans detection: WORKING");
      
      // Check if future plans are assigned to "TBD"
      const tbdTasks = result.tasks["TBD"];
      if (tbdTasks) {
        const tbdTasksCount = (tbdTasks.Coding?.length || 0) + (tbdTasks["Non-Coding"]?.length || 0);
        console.log(`✅ TBD assignment: WORKING (${tbdTasksCount} tasks assigned to TBD)`);
      } else {
        console.log("⚠️  TBD assignment: No tasks found assigned to TBD");
      }
      
      // Check if future plans have isFuturePlan: true
      let correctlyMarked = 0;
      for (const [participant, tasks] of Object.entries(result.tasks)) {
        [...(tasks.Coding || []), ...(tasks["Non-Coding"] || [])].forEach(task => {
          if (task.isFuturePlan === true) correctlyMarked++;
        });
      }
      console.log(`✅ Future plan marking: ${correctlyMarked} tasks correctly marked with isFuturePlan: true`);
      
    } else {
      console.log("❌ Future plans detection: NOT WORKING - No future plans detected");
      console.log("Expected to find mentions of 'mobile app development' and 'API rate limiting' as future plans");
    }
    
    if (regularTasksFound > 0) {
      console.log("✅ Regular task detection: WORKING");
    } else {
      console.log("❌ Regular task detection: NOT WORKING - No regular tasks detected");
    }
    
    // Show raw GPT response for debugging
    if (process.env.SHOW_RAW_RESPONSE === "true") {
      console.log("\n🔍 Raw GPT Response:");
      console.log("====================");
      console.log(result.rawGptResponse);
    }
    
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }
  }
}

// Enhanced logger for test output
const originalInfo = logger.info;
const originalError = logger.error;
const originalWarn = logger.warn;

logger.info = (...args) => {
  if (process.env.SHOW_LOGS === "true") {
    console.log("ℹ️ ", ...args);
  }
};

logger.error = (...args) => {
  console.error("❌", ...args);
};

logger.warn = (...args) => {
  console.warn("⚠️ ", ...args);
};

// Main execution
if (require.main === module) {
  console.log("🚀 Starting Future Plans Test");
  console.log("==============================");
  console.log("This test validates the new future plans detection functionality");
  console.log("");
  
  testFuturePlansDetection()
    .then(() => {
      console.log("\n🎉 Test completed");
    })
    .catch((error) => {
      console.error("\n💥 Test failed with error:", error.message);
      process.exit(1);
    });
} else {
  module.exports = { testFuturePlansDetection };
}
