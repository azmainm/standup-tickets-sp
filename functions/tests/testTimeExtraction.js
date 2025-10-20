/**
 * Test Time Extraction Functionality
 * 
 * This test verifies that the Task Finder correctly extracts estimated time
 * and time spent from meeting transcripts.
 */

const { findTasksFromTranscript } = require("../services/pipeline/taskFinderService");
const { logger } = require("firebase-functions");

// Load environment variables
require("dotenv").config();

/**
 * Test transcript with time mentions
 */
const testTranscript = [
  {
    speaker: "00:00:01.000",
    text: "<v John>I need to create a new task for the email notification system. It should take about 5 hours to complete.</v>"
  },
  {
    speaker: "00:00:05.000", 
    text: "<v Jane>I've been working on SP-25 for the past 3 hours and should need another 2 hours to complete it.</v>"
  },
  {
    speaker: "00:00:10.000",
    text: "<v Mike>SP-30 is almost done. I spent about 3 hours on it yesterday.</v>"
  },
  {
    speaker: "00:00:15.000",
    text: "<v Sarah>This dashboard update will take 90 minutes to complete.</v>"
  },
  {
    speaker: "00:00:20.000",
    text: "<v Tom>I'll work on the mobile app optimization - no specific time estimate yet.</v>"
  }
];

/**
 * Run the time extraction test
 */
async function testTimeExtraction() {
  try {
    console.log("🧪 Testing Time Extraction Functionality");
    console.log("=" .repeat(50));
    
    // Process the test transcript
    const result = await findTasksFromTranscript(testTranscript);
    
    if (!result.success) {
      throw new Error("Task Finder failed");
    }
    
    console.log(`✅ Found ${result.foundTasks.length} tasks`);
    console.log("");
    
    // Display results
    result.foundTasks.forEach((task, index) => {
      console.log(`Task ${index + 1}:`);
      console.log(`  Description: ${task.description}`);
      console.log(`  Assignee: ${task.assignee}`);
      console.log(`  Type: ${task.type}`);
      console.log(`  Category: ${task.category}`);
      console.log(`  Ticket ID: ${task.ticketId}`);
      console.log(`  Estimated Time: ${task.estimatedTime} hours`);
      console.log(`  Time Spent: ${task.timeSpent} hours`);
      console.log(`  Evidence: ${task.evidence}`);
      console.log("");
    });
    
    // Verify expected results
    const expectedResults = [
      {
        description: "email notification system",
        estimatedTime: 5,
        timeSpent: 0,
        category: "NEW_TASK"
      },
      {
        description: "SP-25 completion",
        estimatedTime: 5, // 3 spent + 2 more needed
        timeSpent: 3,
        category: "UPDATE_TASK"
      },
      {
        description: "SP-30 completion",
        estimatedTime: 0,
        timeSpent: 3, // 3 hours
        category: "UPDATE_TASK"
      },
      {
        description: "dashboard update",
        estimatedTime: 1.5, // 90 minutes = 1.5 hours
        timeSpent: 0,
        category: "NEW_TASK"
      },
      {
        description: "mobile app optimization",
        estimatedTime: 0,
        timeSpent: 0,
        category: "NEW_TASK"
      }
    ];
    
    console.log("🔍 Verifying Results:");
    console.log("=" .repeat(30));
    
    let allTestsPassed = true;
    
    result.foundTasks.forEach((task, index) => {
      const expected = expectedResults[index];
      if (expected) {
        const estimatedTimeMatch = task.estimatedTime === expected.estimatedTime;
        const timeSpentMatch = task.timeSpent === expected.timeSpent;
        const categoryMatch = task.category === expected.category;
        
        console.log(`Task ${index + 1} (${task.description}):`);
        console.log(`  Estimated Time: ${task.estimatedTime} (expected: ${expected.estimatedTime}) ${estimatedTimeMatch ? '✅' : '❌'}`);
        console.log(`  Time Spent: ${task.timeSpent} (expected: ${expected.timeSpent}) ${timeSpentMatch ? '✅' : '❌'}`);
        console.log(`  Category: ${task.category} (expected: ${expected.category}) ${categoryMatch ? '✅' : '❌'}`);
        
        if (!estimatedTimeMatch || !timeSpentMatch || !categoryMatch) {
          allTestsPassed = false;
        }
        console.log("");
      }
    });
    
    if (allTestsPassed) {
      console.log("🎉 All time extraction tests passed!");
    } else {
      console.log("❌ Some time extraction tests failed!");
    }
    
    return {
      success: allTestsPassed,
      tasksFound: result.foundTasks.length,
      results: result.foundTasks
    };
    
  } catch (error) {
    console.error("❌ Time extraction test failed:", error.message);
    logger.error("Time extraction test failed", {
      error: error.message,
      stack: error.stack
    });
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Test the parseTimeStringToHours function directly
 */
function testParseTimeStringToHours() {
  const { parseTimeStringToHours } = require("../services/pipeline/taskFinderService");
  
  console.log("🧪 Testing parseTimeStringToHours Function");
  console.log("=" .repeat(40));
  
  const testCases = [
    { input: "5", expected: 5 },
    { input: "3 hours", expected: 3 },
    { input: "2.5 hours", expected: 2.5 },
    { input: "30 minutes", expected: 0.5 },
    { input: "90 minutes", expected: 1.5 },
    { input: "45 mins", expected: 0.75 },
    { input: "two hours", expected: 2 },
    { input: "three hours", expected: 3 },
    { input: "half hour", expected: 0.5 },
    { input: "1 hr", expected: 1 },
    { input: "0", expected: 0 },
    { input: "", expected: 0 },
    { input: "invalid", expected: 0 },
    { input: "2 days", expected: 0 }, // Should not convert days
    { input: "1 week", expected: 0 }  // Should not convert weeks
  ];
  
  let allTestsPassed = true;
  
  testCases.forEach((testCase, index) => {
    const result = parseTimeStringToHours(testCase.input);
    const passed = result === testCase.expected;
    
    console.log(`Test ${index + 1}: "${testCase.input}" → ${result} (expected: ${testCase.expected}) ${passed ? '✅' : '❌'}`);
    
    if (!passed) {
      allTestsPassed = false;
    }
  });
  
  console.log("");
  if (allTestsPassed) {
    console.log("🎉 All parseTimeStringToHours tests passed!");
  } else {
    console.log("❌ Some parseTimeStringToHours tests failed!");
  }
  
  return allTestsPassed;
}

/**
 * Main test runner
 */
async function runTimeExtractionTests() {
  console.log("🚀 Starting Time Extraction Tests");
  console.log("=" .repeat(50));
  console.log("");
  
  // Test the parsing function first
  const parseTestsPassed = testParseTimeStringToHours();
  console.log("");
  
  // Test the full pipeline
  const pipelineTestsPassed = await testTimeExtraction();
  
  console.log("");
  console.log("📊 Test Summary:");
  console.log("=" .repeat(20));
  console.log(`Parse Function Tests: ${parseTestsPassed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Pipeline Tests: ${pipelineTestsPassed.success ? '✅ PASSED' : '❌ FAILED'}`);
  
  const overallSuccess = parseTestsPassed && pipelineTestsPassed.success;
  console.log(`Overall Result: ${overallSuccess ? '🎉 ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  return overallSuccess;
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTimeExtractionTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error("Test runner failed:", error);
      process.exit(1);
    });
}

module.exports = {
  testTimeExtraction,
  testParseTimeStringToHours,
  runTimeExtractionTests
};
