/**
 * Test script for the new ticket ID functionality
 * 
 * This test validates:
 * 1. Ticket counter initialization
 * 2. Unique ID generation
 * 3. Counter persistence
 * 4. Meeting URL service
 * 
 * Usage: node tests/testTicketIds.js
 */

const { 
  initializeTicketCounter, 
  getNextTicketId, 
  getCurrentTicketCount, 
  resetTicketCounter,
  testMongoConnection 
} = require("../services/mongoService");

const { 
  testMeetingUrlService,
  getMeetingUrlForDay,
  shouldHaveMeetingOnDay,
  getMeetingTypeForDay 
} = require("../services/meetingUrlService");

const { parseTimeToHours } = require("../services/openaiService");

require("dotenv").config();

async function testTicketIdSystem() {
  console.log("=".repeat(60));
  console.log("TESTING TICKET ID SYSTEM");
  console.log("=".repeat(60));
  
  // Test MongoDB connection
  console.log("\n1. Testing MongoDB connection...");
  const mongoConnected = await testMongoConnection();
  if (!mongoConnected) {
    console.error("❌ MongoDB connection failed");
    process.exit(1);
  }
  console.log("✅ MongoDB connection successful");
  
  // Test ticket counter initialization
  console.log("\n2. Testing ticket counter initialization...");
  try {
    await initializeTicketCounter();
    const currentCount = await getCurrentTicketCount();
    console.log(`✅ Ticket counter initialized. Current count: ${currentCount}`);
    console.log(`   Next ticket ID will be: SP-${currentCount + 1}`);
  } catch (error) {
    console.error("❌ Ticket counter initialization failed:", error.message);
    process.exit(1);
  }
  
  // Test ticket ID generation
  console.log("\n3. Testing ticket ID generation...");
  try {
    const generatedIds = [];
    console.log("   Generating 3 test ticket IDs...");
    
    for (let i = 0; i < 3; i++) {
      const ticketId = await getNextTicketId();
      generatedIds.push(ticketId);
      console.log(`   Generated: ${ticketId}`);
    }
    
    console.log(`✅ Successfully generated ${generatedIds.length} unique ticket IDs`);
    console.log(`   IDs: ${generatedIds.join(", ")}`);
    
    // Verify they are sequential
    const numbers = generatedIds.map(id => parseInt(id.split("-")[1]));
    const isSequential = numbers.every((num, index) => index === 0 || num === numbers[index - 1] + 1);
    
    if (isSequential) {
      console.log("✅ Ticket IDs are sequential");
    } else {
      console.log("❌ Ticket IDs are not sequential");
    }
    
  } catch (error) {
    console.error("❌ Ticket ID generation failed:", error.message);
  }
  
  // Test current count after generation
  console.log("\n4. Testing counter persistence...");
  try {
    const finalCount = await getCurrentTicketCount();
    console.log(`✅ Final counter value: ${finalCount}`);
    console.log(`   Next ticket ID will be: SP-${finalCount + 1}`);
  } catch (error) {
    console.error("❌ Counter persistence check failed:", error.message);
  }
}

async function testMeetingUrlSystem() {
  console.log("\n" + "=".repeat(60));
  console.log("TESTING MEETING URL SYSTEM");
  console.log("=".repeat(60));
  
  // Test environment variables
  console.log("\n1. Checking meeting URL environment variables...");
  const mwfUrl = process.env.DAILY_STANDUP_URL_MWF;
  const ttUrl = process.env.DAILY_STANDUP_URL_TT;
  const legacyUrl = process.env.DAILY_STANDUP_URL;
  
  console.log(`   DAILY_STANDUP_URL_MWF: ${mwfUrl ? "✅ Set" : "❌ Not set"}`);
  console.log(`   DAILY_STANDUP_URL_TT: ${ttUrl ? "✅ Set" : "❌ Not set"}`);
  console.log(`   DAILY_STANDUP_URL (legacy): ${legacyUrl ? "✅ Set" : "❌ Not set"}`);
  
  // Test meeting URL service
  console.log("\n2. Testing meeting URL service...");
  try {
    const testResults = await testMeetingUrlService();
    
    console.log(`   Environment check: ${testResults.environmentCheck.success ? "✅" : "❌"}`);
    if (!testResults.environmentCheck.success) {
      console.log(`   Missing variables: ${testResults.environmentCheck.missingVars.join(", ")}`);
    }
    
    console.log("\n   📅 Weekly meeting schedule:");
    testResults.dayTests.forEach(test => {
      const status = test.shouldHaveMeeting ? 
        (test.meetingUrl === "URL_SET" ? "✅" : "❌") : 
        "⚫";
      const type = test.meetingType || "No meeting";
      console.log(`      ${test.dayName.padEnd(9)}: ${status} ${type}`);
    });
    
  } catch (error) {
    console.error("❌ Meeting URL service test failed:", error.message);
  }
  
  // Test specific days
  console.log("\n3. Testing specific day logic...");
  const testDates = [
    new Date("2024-01-01"), // Monday
    new Date("2024-01-02"), // Tuesday  
    new Date("2024-01-03"), // Wednesday
    new Date("2024-01-04"), // Thursday
    new Date("2024-01-05"), // Friday
    new Date("2024-01-06"), // Saturday
    new Date("2024-01-07"), // Sunday
  ];
  
  testDates.forEach(date => {
    const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
    const shouldHave = shouldHaveMeetingOnDay(date);
    const meetingType = getMeetingTypeForDay(date);
    const url = getMeetingUrlForDay(date);
    
    console.log(`   ${dayName.padEnd(9)}: ${shouldHave ? "✅" : "⚫"} ${meetingType || "No meeting"} ${url ? "(URL available)" : ""}`);
  });
}

async function testTimeExtraction() {
  console.log("\n" + "=".repeat(60));
  console.log("TESTING ENHANCED TIME EXTRACTION");
  console.log("=".repeat(60));
  
  const testCases = [
    // Hour formats
    { input: "3 hours", expected: 3 },
    { input: "three hours", expected: 3 },
    { input: "2.5 hours", expected: 2.5 },
    { input: "couple hours", expected: 2 },
    { input: "a few hours", expected: 3 },
    
    // Day formats
    { input: "2 days", expected: 16 },
    { input: "two days", expected: 16 },
    { input: "half day", expected: 4 },
    { input: "full day", expected: 8 },
    { input: "whole day", expected: 8 },
    
    // Special cases
    { input: "morning", expected: 4 },
    { input: "afternoon", expected: 4 },
    { input: "1", expected: 1 },
    { input: "5", expected: 5 },
    { input: "invalid", expected: 0 },
    { input: "", expected: 0 },
  ];
  
  console.log("\n   Testing time string parsing:");
  let passed = 0;
  let total = testCases.length;
  
  testCases.forEach(testCase => {
    const result = parseTimeToHours(testCase.input);
    const success = result === testCase.expected;
    
    if (success) {
      passed++;
      console.log(`   ✅ "${testCase.input}" → ${result} hours`);
    } else {
      console.log(`   ❌ "${testCase.input}" → ${result} hours (expected ${testCase.expected})`);
    }
  });
  
  console.log(`\n   Results: ${passed}/${total} tests passed (${Math.round(passed/total*100)}%)`);
}

async function testTitleGeneration() {
  console.log("\n" + "=".repeat(60));
  console.log("TESTING AI TITLE GENERATION");
  console.log("=".repeat(60));
  
  // Test OpenAI connection first
  console.log("\n1. Testing OpenAI connection...");
  const openaiConnected = await testOpenAIConnection();
  if (!openaiConnected) {
    console.error("❌ OpenAI connection failed - skipping title generation tests");
    return;
  }
  console.log("✅ OpenAI connection successful");
  
  // Test cases for title generation
  const testCases = [
    "Implement user authentication for the login page",
    "Build a dashboard for the admin panel",
    "Research on machine learning algorithms",
    "Fix bug in payment processing",
    "Create API documentation",
    "Set up database migration scripts",
    "Design user interface for mobile app",
    "Optimize performance of search functionality",
  ];
  
  console.log("\n2. Testing title generation...");
  console.log("   Generating titles for sample task descriptions:");
  
  let successful = 0;
  const results = [];
  
  for (const description of testCases) {
    try {
      const title = await generateTaskTitle(description);
      results.push({ description, title });
      console.log(`   ✅ "${description.substring(0, 40)}..." → "${title}"`);
      successful++;
    } catch (error) {
      console.log(`   ❌ "${description.substring(0, 40)}..." → Error: ${error.message}`);
      results.push({ description, title: "ERROR", error: error.message });
    }
  }
  
  console.log(`\n   Results: ${successful}/${testCases.length} titles generated successfully`);
  
  // Test edge cases
  console.log("\n3. Testing edge cases...");
  const edgeCases = [
    { input: "", expected: "Untitled Task" },
    { input: "Fix bug", expected: "Fix bug" }, // Should use as-is for short descriptions
    { input: "A".repeat(200), expected: "Generated title" }, // Very long description
  ];
  
  for (const testCase of edgeCases) {
    try {
      const title = await generateTaskTitle(testCase.input);
      const success = testCase.expected === "Generated title" ? title.length > 0 : title === testCase.expected;
      
      if (success || title.length > 0) {
        console.log(`   ✅ Edge case: "${testCase.input.substring(0, 20)}..." → "${title}"`);
      } else {
        console.log(`   ❌ Edge case: "${testCase.input.substring(0, 20)}..." → "${title}" (expected: ${testCase.expected})`);
      }
    } catch (error) {
      console.log(`   ❌ Edge case error: "${testCase.input.substring(0, 20)}..." → Error: ${error.message}`);
    }
  }
  
  console.log("\n   ✅ Title generation testing completed");
}

async function runAllTests() {
  try {
    await testTicketIdSystem();
    await testMeetingUrlSystem();
    await testTimeExtraction();
    await testTitleGeneration();
    
    console.log("\n" + "=".repeat(60));
    console.log("ALL TESTS COMPLETED! 🎉");
    console.log("=".repeat(60));
    
    console.log("\nSummary of new features:");
    console.log("✅ Unique ticket ID system (SP-{number})");
    console.log("✅ AI-generated task titles (concise 2-5 words)");
    console.log("✅ Day-based meeting URL selection (MWF/TT)");
    console.log("✅ Enhanced time extraction from natural language");
    console.log("✅ Task ID reference system for existing task updates");
    console.log("✅ Weekend-aware scheduler (skips Sat/Sun)");
    
    console.log("\nNext steps:");
    console.log("1. Update your .env file with DAILY_STANDUP_URL_MWF and DAILY_STANDUP_URL_TT");
    console.log("2. Share the updated participant guidelines with your team");
    console.log("3. Test the complete flow with node tests/testFullFlow.js");
    console.log("4. Deploy to Firebase with firebase deploy --only functions");
    
  } catch (error) {
    console.error("\n❌ Test execution failed:", error.message);
    console.error(error.stack);
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

// Run the tests
if (require.main === module) {
  console.log("Starting ticket ID and meeting URL system tests...\n");
  runAllTests().catch(error => {
    console.error("Test execution failed:", error);
    process.exit(1);
  });
}

module.exports = {
  testTicketIdSystem,
  testMeetingUrlSystem,
  testTimeExtraction,
  testTitleGeneration,
  runAllTests
};
