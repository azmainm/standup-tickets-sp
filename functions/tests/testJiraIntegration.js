/**
 * Test file for Jira integration functionality
 * 
 * This test file allows manual testing of:
 * 1. Jira API connection
 * 2. Jira issue creation for coding tasks
 * 3. Processing transcript files to create Jira issues
 * 
 * Usage: 
 * - Default: node tests/testJiraIntegration.js
 * - Specific file: node tests/testJiraIntegration.js [filename]
 * - Environment variable: TRANSCRIPT_FILE=filename node tests/testJiraIntegration.js
 */

const { testJiraConnection, getProjectInfo, createJiraIssuesForCodingTasks } = require("../services/jiraService");
const { processTranscriptFromFile } = require("../services/taskProcessor");
const { validateParticipantMapping, getJiraAssigneeForParticipant } = require("../config/participantMapping");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

/**
 * Load transcript data from a JSON file
 * @param {string} filename - Name of the transcript file
 * @returns {Object} Transcript data and metadata
 */
function loadTranscriptFile(filename) {
  const outputDir = path.join(__dirname, "../output");
  const filePath = path.join(outputDir, filename);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`Transcript file not found: ${filePath}`);
  }
  
  const transcriptData = JSON.parse(fs.readFileSync(filePath, "utf8"));
  
  return {
    transcript: transcriptData,
    filename: filename,
    filePath: filePath,
    entryCount: transcriptData.length,
  };
}

/**
 * Simulate processing a transcript to extract tasks (for testing Jira only)
 * @param {Object} transcriptFileData - Transcript file data
 * @returns {Object} Mock task data structure
 */
function createMockTasksFromTranscript(transcriptFileData) {
  console.log("   🔄 Creating mock tasks from transcript entries...");
  
  // Extract participant names and create sample coding tasks
  const participants = {};
  const transcriptText = transcriptFileData.transcript
    .map(entry => entry.text || "")
    .join(" ");
  
  // Look for participant names in <v ParticipantName> format
  const participantMatches = transcriptText.match(/<v\s*([^>]+)>/g) || [];
  const uniqueParticipants = [...new Set(
    participantMatches.map(match => 
      match.replace(/<v\s*([^>]+)>/, "$1").trim()
    )
  )];
  
  console.log(`   👥 Found participants: ${uniqueParticipants.join(", ")}`);
  
  // Create mock coding tasks for each participant
  uniqueParticipants.forEach((participant, index) => {
    const jiraAssignee = getJiraAssigneeForParticipant(participant);
    const assigneeStatus = jiraAssignee ? "✓" : "⚠️";
    
    console.log(`   ${assigneeStatus} "${participant}" → ${jiraAssignee || "Unassigned"}`);
    
    // Only create tasks for Azmain and Shafkat, and only 1 coding task each
    if (participant === "Azmain Morshed" || participant === "Shafkat Kabir") {
      participants[participant] = {
        "Coding": [
          {
            description: `Implement feature ${String.fromCharCode(65 + index)} for the admin panel`,
            status: "To-do"
          }
        ],
        "Non-Coding": [
          {
            description: `Research best practices for project ${String.fromCharCode(65 + index)}`,
            status: "To-do"
          }
        ]
      };
    } else {
      // For other participants, only create non-coding tasks
      participants[participant] = {
        "Coding": [],
        "Non-Coding": [
          {
            description: `Research best practices for project ${String.fromCharCode(65 + index)}`,
            status: "To-do"
          }
        ]
      };
    }
  });
  
  console.log(`   📋 Generated ${Object.keys(participants).length} participants with mock tasks`);
  
  return participants;
}

/**
 * Test Jira integration with a specific transcript file
 * @param {string} filename - Transcript filename (default: 'test_transcript.json')
 */
async function testJiraIntegration(filename = "test_transcript.json") {
  console.log("=".repeat(80));
  console.log("TESTING JIRA INTEGRATION");
  console.log("=".repeat(80));
  
  // Check environment variables
  console.log("\n1. Checking Jira environment variables...");
  const requiredEnvVars = [
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
      const displayValue = envVar.includes("TOKEN") ? "[HIDDEN]" : 
        process.env[envVar].length > 30 ? 
          process.env[envVar].substring(0, 30) + "..." :
          process.env[envVar];
      console.log(`✓ ${envVar}: ${displayValue}`);
    }
  }
  
  if (missingVars.length > 0) {
    console.error("\n❌ Missing Jira environment variables:");
    missingVars.forEach(envVar => console.error(`   - ${envVar}`));
    console.error("\nPlease check your .env file in the functions directory.");
    console.error("Required variables for Jira integration:");
    console.error("   JIRA_URL=https://your-domain.atlassian.net/");
    console.error("   JIRA_EMAIL=your-email@domain.com");
    console.error("   JIRA_API_TOKEN=your-api-token");
    console.error("   JIRA_PROJECT_KEY=YOUR_PROJECT_KEY");
    process.exit(1);
  }
  
  console.log("\n✓ All Jira environment variables found");
  
  // Test participant mapping configuration
  console.log("\n1.5. Testing participant mapping configuration...");
  const mappingValidation = validateParticipantMapping();
  
  if (mappingValidation.valid && mappingValidation.validCount > 0) {
    console.log(`✓ Participant mapping configured (${mappingValidation.validCount} participants)`);
    console.log("   Configured participants:");
    mappingValidation.validEntries.forEach(entry => {
      console.log(`      • "${entry.participant}" → ${entry.email}`);
    });
  } else {
    console.log("⚠️  Participant mapping issues detected:");
    if (mappingValidation.validCount === 0) {
      console.log("      - No valid participant mappings found");
      console.log("      - Issues will be created unassigned");
    }
    if (mappingValidation.invalidCount > 0) {
      console.log(`      - ${mappingValidation.invalidCount} invalid email formats`);
      mappingValidation.invalidEntries.forEach(entry => {
        console.log(`        • "${entry.participant}" → "${entry.email}" (${entry.reason})`);
      });
    }
    console.log("   Please check config/participantMapping.js");
  }
  
  // Test Jira connection
  console.log("\n2. Testing Jira API connection...");
  console.log("   🔄 Connecting to Jira...");
  
  const connectionTest = await testJiraConnection();
  if (!connectionTest) {
    console.error("   ❌ Jira connection test failed");
    console.error("\n   Common issues:");
    console.error("      - Invalid API token or email");
    console.error("      - Incorrect Jira URL");
    console.error("      - Network connectivity issues");
    console.error("      - Jira instance not accessible");
    process.exit(1);
  }
  console.log("   ✓ Jira connection successful");
  
  // Test project access
  console.log("\n3. Testing project access...");
  console.log(`   🔄 Checking access to project: ${process.env.JIRA_PROJECT_KEY}`);
  
  const projectInfo = await getProjectInfo(process.env.JIRA_PROJECT_KEY);
  if (!projectInfo) {
    console.error(`   ❌ Cannot access project: ${process.env.JIRA_PROJECT_KEY}`);
    console.error("\n   Possible issues:");
    console.error("      - Project key does not exist");
    console.error("      - No permission to access the project");
    console.error("      - Project key is case-sensitive");
    process.exit(1);
  }
  
  console.log("   ✓ Project access confirmed");
  console.log(`      - Project Name: ${projectInfo.name}`);
  console.log(`      - Project Key: ${projectInfo.key}`);
  console.log(`      - Project Type: ${projectInfo.projectTypeKey}`);
  
  // Load transcript file
  console.log("\n4. Loading transcript file...");
  console.log(`   📁 Loading: ${filename}`);
  
  let transcriptData;
  try {
    transcriptData = loadTranscriptFile(filename);
    console.log("   ✓ Transcript file loaded successfully");
    console.log(`      - File path: ${transcriptData.filePath}`);
    console.log(`      - Entry count: ${transcriptData.entryCount}`);
  } catch (error) {
    console.error(`   ❌ Failed to load transcript file: ${error.message}`);
    console.error("\n   Available files in output directory:");
    
    try {
      const outputDir = path.join(__dirname, "../output");
      const files = fs.readdirSync(outputDir).filter(f => f.endsWith(".json"));
      files.forEach(file => console.error(`      - ${file}`));
    } catch (dirError) {
      console.error("      (Could not read output directory)");
    }
    
    process.exit(1);
  }
  
  // Option 1: Test with mock tasks (faster, doesn't require OpenAI)
  console.log("\n5. Testing Jira issue creation with mock tasks...");
  console.log("   📋 Generating mock coding tasks from transcript participants...");
  
  const mockTasks = createMockTasksFromTranscript(transcriptData);
  
  console.log("\n   🎫 Creating Jira issues for mock coding tasks...");
  const mockStartTime = Date.now();
  
  try {
    const mockJiraResult = await createJiraIssuesForCodingTasks(mockTasks);
    const mockDuration = ((Date.now() - mockStartTime) / 1000).toFixed(2);
    
    console.log(`   ⏱️  Mock test duration: ${mockDuration} seconds`);
    
    if (mockJiraResult.success) {
      console.log("   ✅ Mock Jira issue creation successful!");
    } else {
      console.log("   ⚠️  Mock Jira issue creation completed with some failures");
    }
    
    // Display results
    console.log("\n   📊 Mock Test Results:");
    console.log(`      - Total coding tasks: ${mockJiraResult.totalCodingTasks}`);
    console.log(`      - Successfully created: ${mockJiraResult.createdIssues.length}`);
    console.log(`      - Failed to create: ${mockJiraResult.failedIssues.length}`);
    console.log(`      - Participants processed: ${mockJiraResult.participants.length}`);
    
    // Show created issues
    if (mockJiraResult.createdIssues.length > 0) {
      console.log("\n   🎉 Successfully Created Issues:");
      mockJiraResult.createdIssues.forEach((issue, index) => {
        console.log(`      ${index + 1}. ${issue.issueKey}: "${issue.title}"`);
        console.log(`         - Participant: ${issue.participant}`);
        console.log(`         - URL: ${issue.issueUrl}`);
      });
    }
    
    // Show failed issues
    if (mockJiraResult.failedIssues.length > 0) {
      console.log("\n   ❌ Failed Issues:");
      mockJiraResult.failedIssues.forEach((issue, index) => {
        console.log(`      ${index + 1}. Error: ${issue.error}`);
        console.log(`         - Participant: ${issue.participant}`);
        if (issue.title) {
          console.log(`         - Title: ${issue.title}`);
        }
      });
    }
    
  } catch (mockError) {
    console.error("   ❌ Mock Jira test failed:");
    console.error(`      Error: ${mockError.message}`);
    
    if (mockError.response) {
      console.error(`      HTTP Status: ${mockError.response.status}`);
      console.error(`      Response: ${JSON.stringify(mockError.response.data, null, 2)}`);
    }
  }
  
  // Option 2: Test with full processing (requires OpenAI)
  console.log("\n6. Testing full processing flow (OpenAI + Jira)...");
  console.log("   ⚠️  This will use OpenAI API and may consume tokens");
  
  // Check if OpenAI is configured
  if (!process.env.OPENAI_API_KEY) {
    console.log("   ⏭️  Skipping full processing test - OPENAI_API_KEY not configured");
  } else {
    console.log("   🔄 Processing transcript with OpenAI and creating Jira issues...");
    
    try {
      const fullStartTime = Date.now();
      
      // This will do: transcript -> OpenAI -> MongoDB -> Jira
      const fullResult = await processTranscriptFromFile(transcriptData.filePath);
      
      const fullDuration = ((Date.now() - fullStartTime) / 1000).toFixed(2);
      
      console.log(`   ⏱️  Full processing duration: ${fullDuration} seconds`);
      
      if (fullResult.success) {
        console.log("   ✅ Full processing flow successful!");
        
        // Display full results
        console.log("\n   📊 Full Processing Results:");
        console.log(`      - Participants: ${fullResult.summary.participantCount}`);
        console.log(`      - Total tasks: ${fullResult.summary.totalTasks}`);
        console.log(`      - Coding tasks: ${fullResult.summary.totalCodingTasks}`);
        console.log(`      - Jira issues created: ${fullResult.summary.jiraIssuesCreated}`);
        console.log(`      - Jira issues failed: ${fullResult.summary.jiraIssuesFailed}`);
        console.log(`      - MongoDB document: ${fullResult.storage.documentId}`);
        console.log(`      - OpenAI tokens used: ${fullResult.processing.metadata.tokensUsed}`);
        console.log(`      - Jira processing time: ${fullResult.processing.metadata.jiraProcessingTime}`);
        
        // Show actual extracted tasks and created issues
        if (fullResult.jira && fullResult.jira.createdIssues.length > 0) {
          console.log("\n   🎯 Real Issues Created from Actual Tasks:");
          fullResult.jira.createdIssues.forEach((issue, index) => {
            console.log(`      ${index + 1}. ${issue.issueKey}: "${issue.title}"`);
            console.log(`         - Participant: ${issue.participant}`);
            console.log(`         - URL: ${issue.issueUrl}`);
          });
        }
        
      } else {
        console.error("   ❌ Full processing flow failed");
      }
      
    } catch (fullError) {
      console.error("   ❌ Full processing test failed:");
      console.error(`      Error: ${fullError.message}`);
    }
  }
  
  console.log("\n" + "=".repeat(80));
  console.log("JIRA INTEGRATION TEST COMPLETED! 🎉");
  console.log("=".repeat(80));
  console.log("\nNext steps:");
  console.log("- Check your Jira project for created issues");
  console.log("- Review the test results above");
  console.log("- Test with different transcript files if needed");
  console.log("- Run the full flow test: node tests/testFullFlow.js");
}

/**
 * Test with only Jira issue creation (no transcript processing)
 * @param {string} filename - Transcript filename for mock data generation
 */
async function testJiraOnly(filename = "test_transcript.json") {
  console.log("=".repeat(60));
  console.log("TESTING JIRA ISSUE CREATION ONLY");
  console.log("=".repeat(60));
  
  // Load transcript for participant names
  let transcriptData;
  try {
    transcriptData = loadTranscriptFile(filename);
    console.log(`✓ Loaded transcript: ${filename} (${transcriptData.entryCount} entries)`);
  } catch (error) {
    console.error(`❌ Failed to load transcript: ${error.message}`);
    process.exit(1);
  }
  
  // Create mock tasks
  const mockTasks = createMockTasksFromTranscript(transcriptData);
  
  // Test Jira connection
  console.log("\n🔄 Testing Jira connection...");
  const connected = await testJiraConnection();
  if (!connected) {
    console.error("❌ Jira connection failed");
    process.exit(1);
  }
  console.log("✓ Jira connection successful");
  
  // Create issues
  console.log("\n🎫 Creating Jira issues...");
  try {
    const result = await createJiraIssuesForCodingTasks(mockTasks);
    
    console.log("\n📊 Results:");
    console.log(`   - Coding tasks: ${result.totalCodingTasks}`);
    console.log(`   - Issues created: ${result.createdIssues.length}`);
    console.log(`   - Issues failed: ${result.failedIssues.length}`);
    console.log(`   - Processing time: ${result.processingTime}`);
    
    if (result.createdIssues.length > 0) {
      console.log("\n✅ Created Issues:");
      result.createdIssues.forEach(issue => {
        console.log(`   • ${issue.issueKey}: ${issue.title} (${issue.participant})`);
      });
    }
    
  } catch (error) {
    console.error(`❌ Jira issue creation failed: ${error.message}`);
    process.exit(1);
  }
}

// Handle command line arguments
const args = process.argv.slice(2);
const isJiraOnly = args.includes("--jira-only");
const filename = args.find(arg => !arg.startsWith("--")) || process.env.TRANSCRIPT_FILE || "test_transcript.json";

// Check for specific test modes
if (isJiraOnly) {
  console.log("Running Jira-only test mode...\n");
  testJiraOnly(filename).catch(error => {
    console.error("Jira-only test failed:", error);
    process.exit(1);
  });
} else {
  console.log(`Running full Jira integration test with file: ${filename}\n`);
  testJiraIntegration(filename).catch(error => {
    console.error("Jira integration test failed:", error);
    process.exit(1);
  });
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

module.exports = {
  testJiraIntegration,
  testJiraOnly,
  loadTranscriptFile,
  createMockTasksFromTranscript,
};
