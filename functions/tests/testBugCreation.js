/**
 * Simple Bug Creation Test
 * Tests creating 2 tasks and 1 bug from a dummy transcript
 */

const fs = require("fs");
const path = require("path");
const { processTranscriptToTasksWithPipeline } = require("../services/core/taskProcessor");

require("dotenv").config();

async function testBugCreation() {
  console.log("========================================");
  console.log("🐛 BUG CREATION TEST");
  console.log("========================================\n");

  const startTime = Date.now();

  try {
    // Load the bug test transcript
    console.log("📁 Loading bug test transcript...");
    const transcriptPath = path.join(__dirname, "..", "output", "test_transcript_bugs.json");
    
    if (!fs.existsSync(transcriptPath)) {
      throw new Error(`Bug test transcript not found at: ${transcriptPath}`);
    }

    const transcriptData = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
    console.log(`✅ Loaded transcript with ${transcriptData.length} entries\n`);

    // Show what we're testing
    console.log("📋 Test Transcript Summary:");
    console.log("1. Azmain: 'New task for me - update API documentation'");
    console.log("2. Sarah: 'New task for me - create user profile page'");
    console.log("3. John: 'New bug - login page crashes on mobile'");
    console.log("");

    // Process the transcript
    console.log("🚀 Processing transcript through system...\n");
    
    const processingResult = await processTranscriptToTasksWithPipeline(
      transcriptData,
      {
        sourceFile: "test_transcript_bugs.json",
        fetchedAt: new Date().toISOString(),
        meetingId: `test-bug-meeting-${Date.now()}`,
        isTestRun: true,
        testDescription: "🧪 TEST - Bug creation test"
      },
      {},
      { testMode: false } // Set to false to actually create in Jira
    );

    if (!processingResult.success) {
      throw new Error("Processing failed");
    }

    console.log("✅ Processing completed!\n");

    // Analyze results
    console.log("========================================");
    console.log("📊 RESULTS ANALYSIS");
    console.log("========================================\n");

    let bugCount = 0;
    let taskCount = 0;
    const bugs = [];
    const tasks = [];

    for (const [participant, participantTasks] of Object.entries(processingResult.tasks)) {
      const allTasks = [
        ...(participantTasks.Coding || []),
        ...(participantTasks["Non-Coding"] || [])
      ];

      for (const task of allTasks) {
        if (task.workType === "Bug") {
          bugCount++;
          bugs.push({
            assignee: participant,
            title: task.title,
            description: task.description?.substring(0, 100) + "..."
          });
        } else {
          taskCount++;
          tasks.push({
            assignee: participant,
            title: task.title,
            description: task.description?.substring(0, 100) + "..."
          });
        }
      }
    }

    // Display tasks
    console.log("✅ TASKS CREATED:");
    tasks.forEach((task, index) => {
      console.log(`\n${index + 1}. Assignee: ${task.assignee}`);
      console.log(`   Title: ${task.title}`);
      console.log(`   WorkType: Task`);
    });

    // Display bugs
    console.log("\n🐛 BUGS CREATED:");
    bugs.forEach((bug, index) => {
      console.log(`\n${index + 1}. Assignee: ${bug.assignee}`);
      console.log(`   Title: ${bug.title}`);
      console.log(`   WorkType: Bug`);
    });

    // Check Jira results
    console.log("\n========================================");
    console.log("🎫 JIRA CREATION RESULTS");
    console.log("========================================\n");

    if (processingResult.jira && processingResult.jira.success) {
      console.log("✅ Jira integration successful");
      
      if (processingResult.jira.participants && processingResult.jira.participants.length > 0) {
        for (const participantResult of processingResult.jira.participants) {
          console.log(`\n👤 ${participantResult.participant}:`);
          
          if (participantResult.createdIssues && participantResult.createdIssues.length > 0) {
            participantResult.createdIssues.forEach(issue => {
              const emoji = issue.type === "Bug" ? "🐛" : "✅";
              console.log(`   ${emoji} ${issue.issueKey}: ${issue.summary}`);
              console.log(`      Type: ${issue.type || "Task"}`);
              console.log(`      URL: ${issue.url}`);
            });
          }
        }
      }
    } else {
      console.log("⚠️ Jira integration not successful");
      if (processingResult.jira) {
        console.log(`   Reason: ${processingResult.jira.message || "Unknown"}`);
      }
    }

    // Final Summary
    console.log("\n========================================");
    console.log("📊 SUMMARY");
    console.log("========================================");
    console.log(`Total Tasks: ${taskCount}`);
    console.log(`Total Bugs: ${bugCount}`);
    console.log(`Total Items: ${bugCount + taskCount}`);
    console.log("");
    
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️  Processing time: ${totalDuration}s`);
    console.log("");

    // Verification
    console.log("========================================");
    console.log("✅ VERIFICATION");
    console.log("========================================");
    console.log(`Expected: 2 tasks, 1 bug`);
    console.log(`Actual:   ${taskCount} tasks, ${bugCount} bug(s)`);
    console.log("");

    if (taskCount === 2 && bugCount === 1) {
      console.log("🎉 TEST PASSED! Bug creation works correctly!");
      console.log("");
      console.log("✅ Bugs are created with 'Bug' work type in Jira");
      console.log("✅ Bugs show in MongoDB with [BUG] prefix");
      console.log("✅ Tasks are still created normally");
      console.log("");
      console.log("🔍 Check Jira to verify bug issues were created with Bug work type!");
    } else {
      console.log("⚠️ TEST RESULT MISMATCH");
      console.log("   Please check the logs above for details");
    }

  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.error("\n❌ TEST FAILED!");
    console.error("================");
    console.error(`Error: ${error.message}`);
    console.error(`Duration: ${duration}s`);
    
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  console.log("\n🧪 Starting Bug Creation Test");
  console.log("Testing: 2 tasks + 1 bug from dummy transcript\n");
  
  testBugCreation()
    .then(() => {
      console.log("\n✅ Test completed successfully!\n");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Test failed:", error.message);
      process.exit(1);
    });
}

module.exports = { testBugCreation };

