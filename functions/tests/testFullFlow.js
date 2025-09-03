/**
 * Test file for complete task processing flow with All Meetings approach
 * 
 * This test file runs the complete flow:
 * 1. Fetch ALL meeting transcripts for a user using All Meetings approach
 * 2. Process each transcript with OpenAI to extract tasks
 * 3. Store in MongoDB and create Jira issues
 * 
 * Usage: node tests/testFullFlow.js
 */

require("dotenv").config();

const { fetchAllMeetingsForUser, validateAllMeetingsEnvironment } = require("../services/allMeetingsService");
const { processTranscriptToTasks } = require("../services/taskProcessor");
const { testOpenAIConnection } = require("../services/openaiService");
const { testMongoConnection, getCollectionStats, initializeTicketCounter, getCurrentTicketCount } = require("../services/mongoService");
const { testJiraConnection, getProjectInfo } = require("../services/jiraService");
const { getBangladeshTimeComponents } = require("../services/meetingUrlService");

async function testCompleteFlow() {
  console.log("=".repeat(80));
  console.log("🆕 TESTING COMPLETE TASK PROCESSING FLOW - ALL MEETINGS APPROACH");
  console.log("=".repeat(80));
  
  // Check environment variables for All Meetings approach
  console.log("\n1. Checking environment variables...");
  const requiredEnvVars = [
    "AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET", 
    "AZURE_AUTHORITY",
    "TARGET_USER_ID",
    "OPENAI_API_KEY",
    "MONGODB_URI",
    "JIRA_URL",
    "JIRA_EMAIL",
    "JIRA_API_TOKEN",
    "JIRA_PROJECT_KEY"
  ];
  
  const missingVars = [];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      missingVars.push(envVar);
    } else {
      const displayValue = envVar.includes("SECRET") || envVar.includes("KEY") || envVar.includes("TOKEN") ? "[HIDDEN]" : 
        envVar === "TARGET_USER_ID" ? process.env[envVar].substring(0, 20) + "..." :
        process.env[envVar].length > 30 ? 
          process.env[envVar].substring(0, 30) + "..." :
          process.env[envVar];
      console.log(`✓ ${envVar}: ${displayValue}`);
    }
  }
  
  if (missingVars.length > 0) {
    console.error("\n❌ Missing environment variables:");
    missingVars.forEach(envVar => console.error(`   - ${envVar}`));
    console.error("\nPlease check your .env file in the functions directory.");
    console.error("Note: TARGET_USER_ID is required for All Meetings approach");
    process.exit(1);
  }
  
  console.log("\n✓ All required environment variables found");
  
  // Test All Meetings environment
  console.log("\n🆕 Testing All Meetings environment...");
  try {
    const allMeetingsValidation = validateAllMeetingsEnvironment();
    console.log("   📊 Environment check:", allMeetingsValidation.success ? "✓" : "❌");
    
    if (!allMeetingsValidation.success) {
      console.log("   Missing:", allMeetingsValidation.missingVars.join(", "));
      process.exit(1);
    }
    
    console.log("   ✓ All Meetings environment validated");
  } catch (error) {
    console.error("   ❌ All Meetings environment validation failed:", error.message);
    process.exit(1);
  }
  
  // Test service connections
  console.log("\n2. Testing service connections...");
  
  console.log("   🤖 Testing OpenAI connection...");
  const openaiTest = await testOpenAIConnection();
  if (!openaiTest) {
    console.error("   ❌ OpenAI connection test failed");
    process.exit(1);
  }
  console.log("   ✓ OpenAI connection successful");
  
  console.log("   🍃 Testing MongoDB connection...");
  const mongoTest = await testMongoConnection();
  if (!mongoTest) {
    console.error("   ❌ MongoDB connection test failed");
    process.exit(1);
  }
  console.log("   ✓ MongoDB connection successful");
  
  console.log("   🎫 Testing Jira connection...");
  const jiraTest = await testJiraConnection();
  if (!jiraTest) {
    console.error("   ❌ Jira connection test failed");
    process.exit(1);
  }
  console.log("   ✓ Jira connection successful");
  
  console.log("   🔍 Testing Jira project access...");
  const projectInfo = await getProjectInfo(process.env.JIRA_PROJECT_KEY);
  if (!projectInfo) {
    console.error(`   ❌ Cannot access Jira project: ${process.env.JIRA_PROJECT_KEY}`);
    process.exit(1);
  }
  console.log(`   ✓ Jira project access confirmed: ${projectInfo.name} (${projectInfo.key})`);
  
  // Get MongoDB collection stats and initialize ticket counter
  try {
    const stats = await getCollectionStats();
    console.log(`   📊 MongoDB collection has ${stats.documentCount} existing documents`);
    
    // Initialize ticket counter if needed
    console.log("   🎫 Initializing ticket counter...");
    await initializeTicketCounter();
    const currentCount = await getCurrentTicketCount();
    console.log(`   🎫 Current ticket counter: ${currentCount} (next ID: SP-${currentCount + 1})`);
  } catch (error) {
    console.log("   📊 MongoDB collection stats unavailable (collection may not exist yet)");
    console.log("   🎫 Ticket counter initialization may be needed");
  }
  
  // Step 1: Fetch ALL meeting transcripts using All Meetings approach
  console.log("\n3. 🆕 Fetching ALL meeting transcripts using All Meetings approach...");
  
  // Calculate target date
  const bdTime = getBangladeshTimeComponents(new Date());
  let targetDateForFile = bdTime.dateString;
  if (bdTime.hour >= 0 && bdTime.hour < 6) {
    // Early morning - use previous day
    const targetDateObj = new Date(bdTime.year, bdTime.month - 1, bdTime.day);
    targetDateObj.setDate(targetDateObj.getDate() - 1);
    targetDateForFile = targetDateObj.toISOString().slice(0, 10);
  }
  
  console.log(`   📅 Target date: ${targetDateForFile}`);
  console.log(`   👤 Target user: ${process.env.TARGET_USER_ID.substring(0, 20)}...`);
  
  let allTranscriptsResults = [];
  
  try {
    console.log("   🔄 Starting All Meetings fetch...");
    const startTime = Date.now();
    
    allTranscriptsResults = await fetchAllMeetingsForUser(process.env.TARGET_USER_ID, targetDateForFile);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
    if (allTranscriptsResults.length > 0) {
      console.log("   ✅ All meetings fetched successfully");
      console.log(`   ⏱️  Duration: ${duration} seconds`);
      console.log(`   📊 Total transcripts found: ${allTranscriptsResults.length}`);
      
      // Show details for each transcript
      allTranscriptsResults.forEach((transcriptData, index) => {
        console.log(`\n   📋 Transcript ${index + 1}:`);
        console.log(`      - Meeting: ${transcriptData.metadata.meetingSubject}`);
        console.log(`      - Entries: ${transcriptData.metadata.entryCount}`);
        console.log(`      - Meeting ID: ${transcriptData.metadata.meetingId}`);
        console.log(`      - Saved to: ${transcriptData.metadata.filename}`);
        
        // Show sample entries for first transcript
        if (index === 0 && transcriptData.transcript.length > 0) {
          console.log("\n      📝 Sample entries from first transcript (first 3):");
          transcriptData.transcript.slice(0, 3).forEach((entry, entryIndex) => {
            const speaker = entry.speaker?.replace(/<[^>]*>/g, "").trim() || "Unknown";
            const text = entry.text?.replace(/<[^>]*>/g, "").substring(0, 80) || "";
            console.log(`         ${entryIndex + 1}. ${speaker}: ${text}${text.length >= 80 ? "..." : ""}`);
          });
        }
      });
    
    } else {
      console.log("   ⚠️  No transcripts found for the target date");
      console.log("   This could mean:");
      console.log("      - No meetings occurred on the target date");
      console.log("      - No transcripts were generated"); 
      console.log("      - Transcription is still processing");
      console.log("      - User calendar access issues");
      console.log("\n   📝 Using empty transcript for testing task processing...");
      allTranscriptsResults = [{
        transcript: [],
        metadata: {
          entryCount: 0,
          meetingId: "no-meetings-found",
          savedToFile: "empty-transcript.json",
          meetingSubject: "No meetings found"
        }
      }];
    }
    
  } catch (error) {
    console.log("\n   ❌ ERROR occurred during All Meetings fetch:");
    console.error(`      Message: ${error.message}`);
    
    if (error.response) {
      console.error(`      HTTP Status: ${error.response.status}`);
    }
    
    console.log("\n   📝 Using empty transcript for testing task processing...");
    allTranscriptsResults = [{
      transcript: [],
      metadata: {
        entryCount: 0,
        meetingId: "error-occurred",
        savedToFile: "error-transcript.json",
        meetingSubject: "Error occurred"
      }
    }];
  }
  
  // Step 2: Process ALL transcripts with complete flow (OpenAI + MongoDB + Jira)
  console.log("\n4. 🆕 Processing ALL transcripts with complete flow...");
  console.log(`   🔄 Starting processing for ${allTranscriptsResults.length} transcript(s)...`);
  
  try {
    const overallStartTime = Date.now();
    const allTaskResults = [];
    let totalSuccessfulProcessing = 0;
    let totalFailedProcessing = 0;
    
    for (let i = 0; i < allTranscriptsResults.length; i++) {
      const transcriptData = allTranscriptsResults[i];
      
      console.log(`\n   📋 Processing transcript ${i + 1}/${allTranscriptsResults.length}: ${transcriptData.metadata.meetingSubject}`);
      console.log(`      - Entries: ${transcriptData.metadata.entryCount}`);
      
      try {
        const startTime = Date.now();
        
        const taskResult = await processTranscriptToTasks(
          transcriptData.transcript, 
          transcriptData.metadata
        );
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        allTaskResults.push({
          transcriptIndex: i + 1,
          meetingSubject: transcriptData.metadata.meetingSubject,
          taskResult,
          success: true,
          duration
        });
        
        totalSuccessfulProcessing++;
        
        console.log(`      ✅ Transcript ${i + 1} processed successfully in ${duration}s`);
        console.log(`         - Participants: ${taskResult.summary.participantCount}`);
        console.log(`         - Tasks extracted: ${taskResult.summary.extractedTasks}`);
        console.log(`         - New tasks: ${taskResult.summary.newTasksCreated}`);
        console.log(`         - Updated tasks: ${taskResult.summary.existingTasksUpdated}`);
        console.log(`         - Jira issues: ${taskResult.summary.jiraIssuesCreated}`);
        
      } catch (transcriptError) {
        allTaskResults.push({
          transcriptIndex: i + 1,
          meetingSubject: transcriptData.metadata.meetingSubject,
          taskResult: null,
          success: false,
          error: transcriptError.message
        });
        
        totalFailedProcessing++;
        
        console.log(`      ❌ Transcript ${i + 1} processing failed: ${transcriptError.message}`);
      }
    }
    
    const overallDuration = ((Date.now() - overallStartTime) / 1000).toFixed(2);
    
    console.log(`\n   🎉 All transcripts processing completed!`);
    console.log(`   ⏱️  Total duration: ${overallDuration} seconds`);
    console.log(`   📊 Processing summary:`);
    console.log(`      - Total transcripts: ${allTranscriptsResults.length}`);
    console.log(`      - Successfully processed: ${totalSuccessfulProcessing}`);
    console.log(`      - Failed processing: ${totalFailedProcessing}`);
    
    if (totalSuccessfulProcessing > 0) {
      // Show consolidated results from successful processing
      const firstSuccessfulResult = allTaskResults.find(r => r.success)?.taskResult;
      
      if (firstSuccessfulResult) {
        // Show sample details from first successful result
        console.log("\n   📄 Sample Transcript Storage (from first successful transcript):");
        console.log(`      - Document ID: ${firstSuccessfulResult.transcriptStorage.documentId}`);
        console.log(`      - Date: ${firstSuccessfulResult.transcriptStorage.date}`);
        console.log(`      - Entry count: ${firstSuccessfulResult.transcriptStorage.entryCount}`);
        console.log(`      - Data size: ${firstSuccessfulResult.transcriptStorage.dataSize} characters`);
        
        // Show OpenAI processing details
        console.log("\n   🤖 Sample OpenAI Processing:");
        console.log(`      - Model: ${firstSuccessfulResult.processing.metadata.model}`);
        console.log(`      - Tokens used: ${firstSuccessfulResult.processing.metadata.tokensUsed}`);
        
        // Show MongoDB task storage details
        console.log("\n   🍃 Sample MongoDB Task Storage:");
        console.log(`      - Document ID: ${firstSuccessfulResult.storage.documentId}`);
        console.log(`      - Timestamp: ${firstSuccessfulResult.storage.timestamp}`);
        
        // Show consolidated Jira integration details
        console.log("\n   🎫 Consolidated Jira Integration:");
        const totalJiraIssues = allTaskResults
          .filter(r => r.success && r.taskResult.jira)
          .reduce((sum, r) => sum + (r.taskResult.jira.createdIssues?.length || 0), 0);
        const totalJiraFailures = allTaskResults
          .filter(r => r.success && r.taskResult.jira)
          .reduce((sum, r) => sum + (r.taskResult.jira.failedIssues?.length || 0), 0);
        
        console.log(`      - Total issues created across all transcripts: ${totalJiraIssues}`);
        console.log(`      - Total issues failed across all transcripts: ${totalJiraFailures}`);
        
        // Show created issues from all transcripts
        if (totalJiraIssues > 0) {
          console.log("\n      📋 All Created Jira Issues:");
          let issueIndex = 1;
          allTaskResults
            .filter(r => r.success && r.taskResult.jira && r.taskResult.jira.createdIssues)
            .forEach(r => {
              console.log(`\n         From ${r.meetingSubject}:`);
              r.taskResult.jira.createdIssues.forEach(issue => {
                console.log(`         ${issueIndex}. ${issue.issueKey}: "${issue.title}"`);
                console.log(`            - Participant: ${issue.participant}`);
                console.log(`            - URL: ${issue.issueUrl}`);
                issueIndex++;
              });
            });
        }
      }
      
      // Display consolidated extracted tasks from all transcripts
      console.log("\n5. 🆕 EXTRACTED AND STORED TASKS FROM ALL MEETINGS:");
      console.log("=".repeat(70));
      
      const consolidatedTasks = {};
      let totalTasksExtracted = 0;
      
      // Consolidate tasks from all successful results
      allTaskResults
        .filter(r => r.success)
        .forEach(r => {
          console.log(`\n📋 From meeting: ${r.meetingSubject}`);
          const tasks = r.taskResult.tasks;
          
          for (const [participant, participantTasks] of Object.entries(tasks)) {
            if (!consolidatedTasks[participant]) {
              consolidatedTasks[participant] = { Coding: [], "Non-Coding": [] };
            }
            
            console.log(`\n👤 ${participant}'s Tasks (from ${r.meetingSubject}):`);
            
            if (participantTasks.Coding && participantTasks.Coding.length > 0) {
              console.log("   💻 Coding Tasks:");
              participantTasks.Coding.forEach((task, index) => {
                const taskTitle = typeof task === "object" && task.title ? task.title : "Untitled";
                const taskText = typeof task === "string" ? task : task.description;
                const taskStatus = typeof task === "object" ? task.status : "To-do";
                const ticketId = typeof task === "object" && task.ticketId ? task.ticketId : "N/A";
                const estimatedTime = typeof task === "object" && task.estimatedTime ? `${task.estimatedTime}h` : "0h";
                const timeTaken = typeof task === "object" && task.timeTaken ? `${task.timeTaken}h` : "0h";
                console.log(`      ${index + 1}. [${ticketId}] "${taskTitle}" - ${taskText} (${taskStatus}) [Est: ${estimatedTime}, Spent: ${timeTaken}]`);
                totalTasksExtracted++;
              });
              consolidatedTasks[participant].Coding.push(...participantTasks.Coding);
            }
            
            if (participantTasks["Non-Coding"] && participantTasks["Non-Coding"].length > 0) {
              console.log("   📝 Non-Coding Tasks:");
              participantTasks["Non-Coding"].forEach((task, index) => {
                const taskTitle = typeof task === "object" && task.title ? task.title : "Untitled";
                const taskText = typeof task === "string" ? task : task.description;
                const taskStatus = typeof task === "object" ? task.status : "To-do";
                const ticketId = typeof task === "object" && task.ticketId ? task.ticketId : "N/A";
                const estimatedTime = typeof task === "object" && task.estimatedTime ? `${task.estimatedTime}h` : "0h";
                const timeTaken = typeof task === "object" && task.timeTaken ? `${task.timeTaken}h` : "0h";
                console.log(`      ${index + 1}. [${ticketId}] "${taskTitle}" - ${taskText} (${taskStatus}) [Est: ${estimatedTime}, Spent: ${timeTaken}]`);
                totalTasksExtracted++;
              });
              consolidatedTasks[participant]["Non-Coding"].push(...participantTasks["Non-Coding"]);
            }
            
            if ((!participantTasks.Coding || participantTasks.Coding.length === 0) && 
                (!participantTasks["Non-Coding"] || participantTasks["Non-Coding"].length === 0)) {
              console.log("   (No tasks identified)");
            }
          }
        });
      
      // Show consolidated final statistics
      console.log("\n📈 🆕 CONSOLIDATED FINAL STATISTICS:");
      const totalEntries = allTranscriptsResults.reduce((sum, t) => sum + t.metadata.entryCount, 0);
      const totalParticipants = new Set(
        allTaskResults
          .filter(r => r.success)
          .flatMap(r => Object.keys(r.taskResult.tasks))
      ).size;
      
      const totalNewTasks = allTaskResults
        .filter(r => r.success)
        .reduce((sum, r) => sum + (r.taskResult.summary.newTasksCreated || 0), 0);
      
      const totalUpdatedTasks = allTaskResults
        .filter(r => r.success)
        .reduce((sum, r) => sum + (r.taskResult.summary.existingTasksUpdated || 0), 0);
      
      const totalJiraCreated = allTaskResults
        .filter(r => r.success && r.taskResult.jira)
        .reduce((sum, r) => sum + (r.taskResult.jira.createdIssues?.length || 0), 0);
      
      const totalJiraFailed = allTaskResults
        .filter(r => r.success && r.taskResult.jira)
        .reduce((sum, r) => sum + (r.taskResult.jira.failedIssues?.length || 0), 0);
      
      const totalTokens = allTaskResults
        .filter(r => r.success)
        .reduce((sum, r) => sum + (r.taskResult.processing.metadata.tokensUsed || 0), 0);
      
      console.log(`   - 🆕 Total meetings processed: ${allTranscriptsResults.length}`);
      console.log(`   - ✅ Successfully processed meetings: ${totalSuccessfulProcessing}`);
      console.log(`   - ❌ Failed processing meetings: ${totalFailedProcessing}`);
      console.log(`   - 📄 Total transcript entries: ${totalEntries}`);
      console.log(`   - 👥 Unique participants identified: ${totalParticipants}`);
      console.log(`   - 📋 Total tasks extracted: ${totalTasksExtracted}`);
      console.log(`   - 🆕 Total new tasks created: ${totalNewTasks}`);
      console.log(`   - 🔄 Total existing tasks updated: ${totalUpdatedTasks}`);
      console.log(`   - 🎫 Total Jira issues created: ${totalJiraCreated}`);
      console.log(`   - ❌ Total Jira issues failed: ${totalJiraFailed}`);
      console.log(`   - 🤖 Total OpenAI tokens used: ${totalTokens}`);
      console.log(`   - ⏱️  Total processing time: ${overallDuration}s`);
      console.log(`   - 📅 Target date: ${targetDateForFile}`);
      
      // Show document IDs from successful results
      if (firstSuccessfulResult) {
        console.log(`   - 💾 Sample MongoDB task document ID: ${firstSuccessfulResult.storage.documentId}`);
        console.log(`   - 📄 Sample MongoDB transcript document ID: ${firstSuccessfulResult.transcriptStorage.documentId}`);
      }
      
      // Show updated collection stats
      try {
        const finalStats = await getCollectionStats();
        console.log(`   - 🍃 MongoDB documents (after): ${finalStats.documentCount}`);
      } catch (error) {
        console.log("   - 🍃 MongoDB final stats unavailable");
      }
      
    } else {
      console.error("   ❌ All transcript processing failed");
      console.error("   No transcripts were successfully processed");
      if (totalFailedProcessing > 0) {
        console.error(`   Failed transcripts: ${totalFailedProcessing}`);
        allTaskResults
          .filter(r => !r.success)
          .forEach(r => {
            console.error(`      - ${r.meetingSubject}: ${r.error}`);
          });
      }
      process.exit(1);
    }
    
  } catch (error) {
    console.log("\n   ❌ ERROR occurred during task processing:");
    console.error(`      Message: ${error.message}`);
    
    if (error.stack) {
      console.error(`      Stack: ${error.stack.substring(0, 200)}...`);
    }
    
    console.log("\nTroubleshooting tips:");
    console.log("   1. Check OpenAI API key and credits");
    console.log("   2. Verify MongoDB connection and permissions");
    console.log("   3. Check Jira connection and project permissions");
    console.log("   4. Check if transcript format is valid");
    console.log("   5. Review service logs for detailed error information");
    
    process.exit(1);
  }
  
  console.log("\n" + "=".repeat(80));
  console.log("🆕 ALL MEETINGS COMPLETE FLOW TEST COMPLETED SUCCESSFULLY! 🎉");
  console.log("=".repeat(80));
  console.log("\n🎯 What was tested:");
  console.log("- All Meetings approach with TARGET_USER_ID");
  console.log("- Multiple transcript fetching and processing");
  console.log("- Individual OpenAI processing for each transcript");
  console.log("- MongoDB storage for each transcript");
  console.log("- Jira issue creation for all coding tasks");
  console.log("- Consolidated reporting across all meetings");
  console.log("\n📋 Next steps:");
  console.log("- Check MongoDB to verify all transcripts and tasks were stored");
  console.log("- Check Jira project for all created issues from multiple meetings");
  console.log("- Review all transcript files in the output directory");
  console.log("- Test the Firebase Functions deployment with All Meetings");
  console.log("- Run: node tests/testFetchAllMeetings.js to test fetching only");
  console.log("- Test manual endpoint: POST /fetch-transcript (without meetingUrl)");
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

// Run the test
if (require.main === module) {
  console.log("Starting complete flow test...\n");
  testCompleteFlow().catch(error => {
    console.error("Test failed:", error);
    process.exit(1);
  });
}

module.exports = {
  testCompleteFlow
};