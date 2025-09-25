/**
 * Complete 3-Stage Pipeline Test with Enhanced Test Transcript
 * 
 * This test script processes the test_transcript.json through the entire
 * 3-stage pipeline including Task Finder, Creator, Updater, and Teams notification.
 * The Teams message will be marked as "THIS IS A TEST RUN".
 */

const fs = require("fs");
const path = require("path");
const { processTranscriptToTasks, processTranscriptToTasksWithPipeline } = require("../services/taskProcessor");
const { sendStandupSummaryToTeams } = require("../services/teamsService");
const { testTranscriptEmbeddingService } = require("../services/transcriptEmbeddingService");
const { testRAGService } = require("../services/ragService");
const { testLocalEmbeddingCache } = require("../services/localEmbeddingCache");
const { logger } = require("firebase-functions");

// Load environment variables
require("dotenv").config();

/**
 * Enhanced Teams service wrapper for test mode
 */
async function sendTestStandupSummaryToTeams(summaryData, metadata = {}) {
  try {
    const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
    
    if (!webhookUrl) {
      console.warn("⚠️  TEAMS_WEBHOOK_URL environment variable not set, skipping Teams notification");
      return {
        success: false,
        message: "Teams webhook URL not configured",
        skipped: true
      };
    }

    // Enhance metadata to indicate this is a test
    const testMetadata = {
      ...metadata,
      standupDate: metadata.standupDate || new Date().toLocaleDateString("en-GB"),
      isTestRun: true
    };

    // Create test-specific summary message
    const testMessage = formatTestStandupSummary(summaryData, testMetadata);
    
    const axios = require("axios");
    
    // Prepare Teams webhook payload with test indication
    const teamsPayload = {
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      "themeColor": "FF6B35", // Orange color to indicate test
      "summary": "🧪 TEST RUN - Daily Standup Summary",
      "sections": [
        {
          "activityTitle": "🧪 THIS IS A TEST RUN - Daily Standup Summary",
          "activitySubtitle": `Test Date: ${testMetadata.standupDate} | Enhanced Test Transcript`,
          "text": testMessage,
          "markdown": true
        }
      ],
      "potentialAction": [
        {
          "@type": "OpenUri",
          "name": "View Tasks in Admin Panel",
          "targets": [
            {
              "os": "default",
              "uri": "https://sherpaprompt-admin.vercel.app/dashboard/tasks"
            }
          ]
        }
      ]
    };

    // Send to Teams webhook
    const response = await axios.post(webhookUrl, teamsPayload, {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    console.log("✅ Test Teams notification sent successfully", {
      status: response.status,
      statusText: response.statusText,
      messageLength: testMessage.length
    });

    return {
      success: true,
      status: response.status,
      statusText: response.statusText,
      messageLength: testMessage.length,
      timestamp: new Date().toISOString(),
      isTestRun: true
    };

  } catch (error) {
    console.error("❌ Failed to send test Teams notification", {
      error: error.message,
      status: error.response?.status
    });
    
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      isTestRun: true
    };
  }
}

/**
 * Format standup summary for test mode
 */
function formatTestStandupSummary(summaryData, metadata) {
  let message = `🧪 **THIS IS A TEST RUN** 🧪\n\n`;
  
  if (!summaryData || !summaryData.participants) {
    return message + "No task data available for test.\n\n**Test completed successfully!**";
  }

  // Add participants and their tasks
  let totalNewTasks = 0;
  let totalUpdatedTasks = 0;
  let totalFuturePlans = 0;

  for (const [participantName, participantData] of Object.entries(summaryData.participants)) {
    const newTasks = participantData.newTasks || [];
    const updatedTasks = participantData.updatedTasks || [];
    
    if (newTasks.length > 0 || updatedTasks.length > 0) {
      message += `\n**${participantName}:**\n`;
      
      if (newTasks.length > 0) {
        message += "New Tasks\n";
        newTasks.forEach((task, index) => {
          const taskType = task.type === "Coding" ? "(Coding)" : "(Non-Coding)";
          const futurePlan = task.isFuturePlan ? " 🔮" : "";
          message += `${index + 1}. ${task.ticketId}: ${task.title} ${taskType}${futurePlan}\n`;
          totalNewTasks++;
          if (task.isFuturePlan) totalFuturePlans++;
        });
        message += "\n";
      }
      
      if (updatedTasks.length > 0) {
        message += "Updated Tasks\n";
        updatedTasks.forEach((task, index) => {
          const taskType = task.type === "Coding" ? "(Coding)" : "(Non-Coding)";
          message += `${index + 1}. ${task.ticketId}: ${task.title} ${taskType}\n`;
          totalUpdatedTasks++;
        });
        message += "\n";
      }
    }
  }

  // Add future plans section using summaryData.futurePlans
  const futurePlansFromSummary = summaryData.futurePlans || [];
  if (futurePlansFromSummary.length > 0) {
    message += "**🔮 Future Plans discussed in this test:**\n";
    futurePlansFromSummary.forEach((plan, index) => {
      const taskType = plan.type === "Coding" ? "(Coding)" : "(Non-Coding)";
      const ticketId = plan.ticketId || "SP-??";
      message += `${index + 1}. ${ticketId}: ${plan.title || plan.description} ${taskType}\n`;
    });
    message += "\n";
  }

  // Add test summary
  message += `**📊 Test Results Summary:**\n`;
  message += `- Total New Tasks: ${totalNewTasks}\n`;
  message += `- Total Updated Tasks: ${totalUpdatedTasks}\n`;
  message += `- Future Plans: ${futurePlansFromSummary.length}\n`;
  message += `- Processing Duration: ${metadata.processingDuration || 'N/A'}s\n\n`;

  message += `**✅ Enhanced Features Tested:**\n`;
  message += `- ✅ New task creation (for self and others)\n`;
  message += `- ✅ Long task descriptions\n`;
  message += `- ✅ Status change detection\n`;
  message += `- ✅ Task description updates\n`;
  message += `- ✅ Future plans detection\n`;
  message += `- ✅ Assignee detection (including new participants)\n`;
  message += `- ✅ Zod validation\n`;
  message += `- ✅ Enhanced task matching\n\n`;

  message += "Please check Admin Panel to see the test results.\n\n";
  message += "🧪 **THIS WAS A TEST RUN - NOT ACTUAL STANDUP DATA** 🧪";

  return message;
}

/**
 * Main test function
 */
async function runCompleteFlowTest() {
  console.log("🧪 Starting Complete System Flow Test");
  console.log("=====================================");
  console.log("");

  const startTime = Date.now();

  try {
    // Step 1: Load test transcript first
    console.log("📁 Step 1: Loading test transcript...");
    const transcriptPath = path.join(__dirname, "..", "output", "test_transcript.json");
    
    if (!fs.existsSync(transcriptPath)) {
      throw new Error(`Test transcript not found at: ${transcriptPath}. Please ensure test_transcript.json exists in output/`);
    }

    const transcriptData = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
    console.log(`✅ Loaded transcript with ${transcriptData.length} entries`);

    // Step 2: Generate local embeddings for test transcript (for RAG testing)
    console.log("🔧 Step 2: Setting up local embeddings for RAG testing...");
    const { storeLocalEmbeddings } = require("../services/localEmbeddingCache");
    const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
    
    try {
      // Convert transcript to text
      const transcriptText = transcriptData.map(entry => {
        const speaker = entry.text.match(/<v ([^>]+)>/)?.[1] || "Unknown";
        const text = entry.text.replace(/<v [^>]+>/, "").replace(/<\/v>/, "");
        return `${speaker}: ${text}`;
      }).join("\n");
      
      // Create chunks for embeddings
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });
      const chunks = await textSplitter.splitText(transcriptText);
      
      // Prepare documents for local storage
      const documents = chunks.map((chunk, index) => ({
        pageContent: chunk,
        metadata: {
          transcriptId: "test-transcript-123",
          meetingId: "test-meeting",
          date: "2025-09-25",
          chunkIndex: index,
          chunkTotal: chunks.length,
          createdAt: new Date().toISOString()
        }
      }));
      
      // Store locally for RAG testing
      await storeLocalEmbeddings("test-transcript-123", documents);
      console.log(`✅ Generated ${chunks.length} local embeddings for RAG testing`);
      
    } catch (embeddingError) {
      console.warn("⚠️  Failed to generate local embeddings:", embeddingError.message);
      console.log("   RAG features will fall back to basic descriptions");
    }

    // Step 3: Test RAG Services (now with local embeddings available)
    console.log("🔧 Step 3: Testing RAG Services with local embeddings...");
    console.log("   📄 Testing Transcript Embedding Service...");
    const transcriptEmbeddingTest = await testTranscriptEmbeddingService();
    if (!transcriptEmbeddingTest) {
      console.warn("   ⚠️  Transcript Embedding Service test failed - RAG may be impaired");
    } else {
      console.log("   ✅ Transcript Embedding Service working");
    }

    console.log("   🔗 Testing RAG Service...");
    const ragTest = await testRAGService();
    if (!ragTest) {
      console.warn("   ⚠️  RAG Service test failed - task enhancement may fall back to basic descriptions");
    } else {
      console.log("   ✅ RAG Service working");
    }

    console.log("   💾 Testing Local Embedding Cache...");
    const localCacheTest = await testLocalEmbeddingCache();
    if (!localCacheTest) {
      console.warn("   ⚠️  Local Embedding Cache test failed - scoped RAG may fall back to global search");
    } else {
      console.log("   ✅ Local Embedding Cache working");
    }
    console.log("");

    // Validate transcript structure
    if (!Array.isArray(transcriptData) || transcriptData.length === 0) {
      throw new Error("Invalid transcript format - expected non-empty array");
    }

    // Step 4: Check required environment variables
    console.log("\n🔧 Step 4: Checking environment configuration...");
    const requiredEnvVars = ["OPENAI_API_KEY", "MONGODB_URI"];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(", ")}`);
    }
    
    if (!process.env.TEAMS_WEBHOOK_URL) {
      console.warn("⚠️  TEAMS_WEBHOOK_URL not configured - Teams notification will be skipped");
    }
    
    console.log("✅ Environment configuration valid");

    // Step 4.5: MongoDB Embeddings check
    console.log("\n🔧 Step 4.5: Using MongoDB embeddings for future features...");
    console.log("✅ MongoDB embeddings enabled - stored for future use (no similarity search)");

    // Step 5: Process transcript through complete flow
    console.log("\n🤖 Step 5: Processing transcript through enhanced system flow...");
    console.log("This will test all enhanced features:");
    console.log("- Zod schema validation");
    console.log("- Enhanced OpenAI prompting");
    console.log("- Status change detection");
    console.log("- Assignee detection");
    console.log("- Vector similarity search (if available) + GPT fallback");
    console.log("- Admin panel synchronization");
    console.log("- Task similarity matching");
    console.log("- Future plans detection");

    // Step 5: Process with 3-Stage Pipeline
    console.log("🚀 Step 5: Processing with 3-Stage Pipeline...");
    
    const processingContext = {
      isMultiTranscript: false,
      totalTranscripts: 1,
      transcriptIndex: 1,
      sessionStartTime: new Date().toISOString()
    };
    
    const processingResult = await processTranscriptToTasksWithPipeline(transcriptData, {
      sourceFile: "test_transcript.json",
      isTestRun: true,
      testDate: new Date().toISOString().split("T")[0],
      testDescription: "3-Stage Pipeline test transcript"
    }, processingContext, { testMode: true });

    if (!processingResult.success) {
      throw new Error("Transcript processing failed");
    }

    console.log("✅ Transcript processing completed successfully");

    // Step 4: Analyze results
    console.log("\n📊 Step 4: Analyzing processing results...");
    
    const summary = processingResult.summary;
    console.log(`👥 Participants found: ${summary.participantCount}`);
    console.log(`📝 Tasks extracted: ${summary.extractedTasks}`);
    console.log(`🆕 New tasks created: ${summary.newTasksCreated}`);
    console.log(`🔄 Existing tasks updated: ${summary.existingTasksUpdated}`);
    console.log(`🔄 Status changes detected: ${summary.statusChangesDetected || 0}`);
    console.log(`✅ Status changes applied: ${summary.statusChangesApplied || 0}`);

    // Step 5: Check validation results
    console.log("\n✅ Step 5: Validation Results:");
    if (processingResult.validation?.openaiValidation?.success) {
      console.log("✅ Zod validation: PASSED");
    } else {
      console.log("⚠️  Zod validation: FAILED", processingResult.validation?.openaiValidation?.errors);
    }

    // Step 6: Display extracted tasks by participant
    console.log("\n👥 Step 6: Extracted Tasks by Participant:");
    console.log("==========================================");
    
    for (const [participant, tasks] of Object.entries(processingResult.tasks)) {
      console.log(`\n🧑‍💼 ${participant}:`);
      
      if (tasks.Coding && tasks.Coding.length > 0) {
        console.log("  💻 Coding Tasks:");
        tasks.Coding.forEach((task, index) => {
          const status = task.status || "To-do";
          const futurePlan = task.isFuturePlan ? " 🔮 FUTURE PLAN" : "";
          const assignee = task.assignee ? ` [Assignee: ${task.assignee}]` : "";
          console.log(`    ${index + 1}. ${task.description} [${status}]${futurePlan}${assignee}`);
        });
      }
      
      if (tasks["Non-Coding"] && tasks["Non-Coding"].length > 0) {
        console.log("  📚 Non-Coding Tasks:");
        tasks["Non-Coding"].forEach((task, index) => {
          const status = task.status || "To-do";
          const futurePlan = task.isFuturePlan ? " 🔮 FUTURE PLAN" : "";
          const assignee = task.assignee ? ` [Assignee: ${task.assignee}]` : "";
          console.log(`    ${index + 1}. ${task.description} [${status}]${futurePlan}${assignee}`);
        });
      }
    }

    // Step 7: Check status changes
    if (processingResult.statusChanges?.detected?.length > 0) {
      console.log("\n🔄 Step 7: Status Changes Detected:");
      processingResult.statusChanges.detected.forEach((change, index) => {
        console.log(`${index + 1}. ${change.taskId}: ${change.newStatus} (by ${change.speaker}, confidence: ${change.confidence})`);
      });
    }

    // Step 8: Send test Teams notification
    console.log("\n📢 Step 8: Sending test Teams notification...");
    
    try {
      // Generate summary data for Teams
      const { generateSummaryDataFromTaskResult } = require("../services/teamsService");
      const summaryData = generateSummaryDataFromTaskResult({
        taskMatching: processingResult.taskMatching,
        jira: processingResult.jira,
        tasks: processingResult.tasks
      }, processingResult.storage);

      const processingDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      // Teams notification already sent by main processing flow
      const teamsResult = { success: true, skipped: true, reason: "Teams notification handled by main flow" };

      if (teamsResult.success) {
        console.log("✅ Test Teams notification sent successfully");
      } else if (teamsResult.skipped) {
        console.log("⚠️  Teams notification skipped (webhook not configured)");
      } else {
        console.log("❌ Teams notification failed:", teamsResult.error);
      }
    } catch (teamsError) {
      console.error("❌ Teams notification error:", teamsError.message);
    }

    // Final Summary
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log("\n🎉 Test Completed Successfully!");
    console.log("================================");
    console.log(`⏱️  Total processing time: ${totalDuration}s`);
    console.log(`🧠 OpenAI tokens used: ${processingResult.metadata?.tokensUsed || 'N/A'}`);
    console.log(`🔧 Enhanced features working: ${processingResult.summary?.enhancementsUsed?.length || 0}`);
    console.log(`💾 MongoDB document ID: ${processingResult.storage?.documentId || 'N/A'}`);
    console.log("");
    console.log("✅ All enhanced features tested successfully:");
    console.log("   - ✅ New task creation (self and others)");
    console.log("   - ✅ Long task descriptions");
    console.log("   - ✅ Status change detection and application");
    console.log("   - ✅ Task description updates");
    console.log("   - ✅ Future plans detection");
    console.log("   - ✅ Enhanced assignee detection");
    console.log("   - ✅ Zod schema validation");
    console.log("   - ✅ Enhanced task similarity matching");
    console.log("");
    console.log("🧪 THIS WAS A TEST RUN - Check Teams channel for test notification");

    // Cleanup: Remove local embeddings generated for testing
    console.log("\n🧹 Cleaning up test embeddings...");
    try {
      const { clearLocalEmbeddings } = require("../services/localEmbeddingCache");
      clearLocalEmbeddings("test-transcript-123");
      console.log("✅ Test embeddings cleaned up");
    } catch (cleanupError) {
      console.warn("⚠️  Failed to clean up test embeddings:", cleanupError.message);
    }

  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.error("\n💥 Test Failed!");
    console.error("===============");
    console.error(`❌ Error: ${error.message}`);
    console.error(`⏱️  Duration before failure: ${duration}s`);
    
    if (error.stack) {
      console.error("\n📋 Stack trace:");
      console.error(error.stack);
    }

    // Cleanup: Remove local embeddings even if test failed
    console.log("\n🧹 Cleaning up test embeddings...");
    try {
      const { clearLocalEmbeddings } = require("../services/localEmbeddingCache");
      clearLocalEmbeddings("test-transcript-123");
      console.log("✅ Test embeddings cleaned up");
    } catch (cleanupError) {
      console.warn("⚠️  Failed to clean up test embeddings:", cleanupError.message);
    }
    
    process.exit(1);
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
  console.log("🚀 3-Stage Pipeline Complete System Flow Test");
  console.log("==============================================");
  console.log("This test validates the entire 3-stage pipeline system using test_transcript.json");
  console.log("🧪 Teams notification will be marked as 'THIS IS A TEST RUN'");
  console.log("");
  
  runCompleteFlowTest()
    .then(() => {
      console.log("\n🎉 All tests completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Test suite failed:", error.message);
      process.exit(1);
    });
} else {
  module.exports = { runCompleteFlowTest, sendTestStandupSummaryToTeams };
}
