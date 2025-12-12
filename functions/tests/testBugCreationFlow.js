/**
 * Test script to verify bug creation works in the full system
 */

require("dotenv").config();

async function testBugCreationFlow() {
  try {
    const { processTranscriptToTasksWithPipeline } = require("../services/core/taskProcessor");
    
    console.log("========================================");
    console.log("🧪 TESTING BUG CREATION IN SYSTEM");
    console.log("========================================\n");
    
    // Create a test transcript with bug creation
    const testTranscript = [
      {
        speaker: "00:00:01.000",
        text: "<v Azmain Morshed>New bug - the login page crashes when users click the forgot password button. It's a critical issue affecting mobile users.</v>"
      },
      {
        speaker: "00:00:10.000",
        text: "<v Sarah Johnson>New task for me - update the API documentation to include the new endpoints.</v>"
      },
      {
        speaker: "00:00:20.000",
        text: "<v John Smith>New bug for me - dashboard shows incorrect data after midnight refresh.</v>"
      }
    ];
    
    const transcriptMetadata = {
      sourceFile: "test_transcript_bugs.json",
      isTestRun: true,
      testDescription: "🧪 TEST - Bug creation flow test",
      targetDate: new Date().toISOString()
    };
    
    const processingOptions = {
      testMode: true
    };
    
    console.log("📋 Test Transcript:");
    console.log("1. Azmain says: 'New bug - login page crashes...'");
    console.log("2. Sarah says: 'New task for me - update API docs...'");
    console.log("3. John says: 'New bug for me - dashboard shows incorrect data...'");
    console.log("\n");
    
    console.log("🚀 Processing transcript...\n");
    
    const result = await processTranscriptToTasksWithPipeline(
      testTranscript,
      transcriptMetadata,
      {},
      processingOptions
    );
    
    console.log("========================================");
    console.log("✅ RESULTS");
    console.log("========================================\n");
    
    // Analyze the results
    let bugCount = 0;
    let taskCount = 0;
    
    for (const [participant, tasks] of Object.entries(result.tasks)) {
      const allTasks = [
        ...(tasks.Coding || []),
        ...(tasks["Non-Coding"] || [])
      ];
      
      for (const task of allTasks) {
        if (task.workType === "Bug") {
          bugCount++;
          console.log(`🐛 BUG CREATED:`);
          console.log(`   Assignee: ${participant}`);
          console.log(`   Title: ${task.title}`);
          console.log(`   Type: ${task.type}`);
          console.log(`   WorkType: ${task.workType}`);
          console.log("");
        } else {
          taskCount++;
          console.log(`✅ TASK CREATED:`);
          console.log(`   Assignee: ${participant}`);
          console.log(`   Title: ${task.title}`);
          console.log(`   Type: ${task.type}`);
          console.log(`   WorkType: ${task.workType}`);
          console.log("");
        }
      }
    }
    
    console.log("========================================");
    console.log("📊 SUMMARY");
    console.log("========================================");
    console.log(`Total Bugs Created: ${bugCount}`);
    console.log(`Total Tasks Created: ${taskCount}`);
    console.log(`\n`);
    
    // Check Jira creation
    if (result.jira && result.jira.success) {
      console.log("✅ Jira integration successful");
      console.log(`   Issues created: ${result.jira.createdIssues?.length || 0}`);
      
      if (result.jira.createdIssues) {
        result.jira.createdIssues.forEach(issue => {
          const emoji = issue.workType === "Bug" ? "🐛" : "✅";
          console.log(`   ${emoji} ${issue.issueKey}: ${issue.workType || "Task"}`);
        });
      }
    }
    
    console.log("\n========================================");
    console.log("🎉 BUG CREATION TEST COMPLETE");
    console.log("========================================\n");
    
    console.log("✅ Expected: 2 bugs, 1 task");
    console.log(`✅ Actual: ${bugCount} bugs, ${taskCount} task(s)`);
    console.log("");
    
    if (bugCount === 2 && taskCount === 1) {
      console.log("🎉 TEST PASSED! Bug creation works correctly!");
    } else {
      console.log("⚠️ TEST ISSUE: Bug/task counts don't match expected values");
    }
    
  } catch (error) {
    console.error("❌ TEST FAILED!");
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);
  }
}

// Run the test
testBugCreationFlow();

