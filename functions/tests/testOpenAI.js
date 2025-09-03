/**
 * Test file for OpenAI task processing functionality
 * 
 * This test file processes a transcript JSON file using OpenAI only
 * (without storing in MongoDB)
 * 
 * Usage: 
 * - node tests/testOpenAI.js (uses most recent transcript)
 * - node tests/testOpenAI.js filename.json (uses specific file)
 * - TRANSCRIPT_FILE=filename.json node tests/testOpenAI.js (via env var)
 */

const { processTranscriptForTasks, testOpenAIConnection } = require("../services/openaiService");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function testOpenAIProcessing() {
  console.log("=".repeat(70));
  console.log("TESTING OPENAI TASK PROCESSING");
  console.log("=".repeat(70));
  
  // Check environment variables
  console.log("\n1. Checking environment variables...");
  const requiredEnvVars = ["OPENAI_API_KEY"];
  
  const missingVars = [];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      missingVars.push(envVar);
    } else {
      console.log(`✓ ${envVar}: ${process.env[envVar].substring(0, 20)}...`);
    }
  }
  
  if (missingVars.length > 0) {
    console.error("\n❌ Missing environment variables:");
    missingVars.forEach(envVar => console.error(`   - ${envVar}`));
    console.error("\nPlease check your .env file in the functions directory.");
    process.exit(1);
  }
  
  console.log("\n✓ All environment variables found");
  
  // Test OpenAI connection
  console.log("\n2. Testing OpenAI connection...");
  const connectionTest = await testOpenAIConnection();
  if (!connectionTest) {
    console.error("❌ OpenAI connection test failed");
    process.exit(1);
  }
  console.log("✓ OpenAI connection successful");
  
  // Find and load transcript file
  console.log("\n3. Loading transcript file...");
  const outputDir = path.join(__dirname, "../output");
  
  if (!fs.existsSync(outputDir)) {
    console.error("❌ Output directory not found. Please run transcript fetch first.");
    process.exit(1);
  }
  
  // Determine which transcript file to use
  let transcriptFile;
  let transcriptPath;
  
  // Check for command line argument first
  if (process.argv[2]) {
    transcriptFile = process.argv[2];
    if (!transcriptFile.endsWith(".json")) {
      transcriptFile += ".json";
    }
    transcriptPath = path.join(outputDir, transcriptFile);
    
    if (!fs.existsSync(transcriptPath)) {
      console.error(`❌ Specified transcript file not found: ${transcriptFile}`);
      console.error(`Looked in: ${transcriptPath}`);
      process.exit(1);
    }
    
    console.log(`📁 Using specified transcript file: ${transcriptFile}`);
  }
  // Check for environment variable
  else if (process.env.TRANSCRIPT_FILE) {
    transcriptFile = process.env.TRANSCRIPT_FILE;
    if (!transcriptFile.endsWith(".json")) {
      transcriptFile += ".json";
    }
    transcriptPath = path.join(outputDir, transcriptFile);
    
    if (!fs.existsSync(transcriptPath)) {
      console.error(`❌ Environment-specified transcript file not found: ${transcriptFile}`);
      console.error(`Looked in: ${transcriptPath}`);
      process.exit(1);
    }
    
    console.log(`📁 Using environment-specified transcript file: ${transcriptFile}`);
  }
  // Use most recent file as default
  else {
    const files = fs.readdirSync(outputDir);
    const jsonFiles = files.filter(file => file.endsWith(".json"));
    
    if (jsonFiles.length === 0) {
      console.error("❌ No transcript JSON files found in output directory.");
      console.error("Please run transcript fetch first or manually place a transcript JSON file.");
      console.error("\nUsage options:");
      console.error("  node tests/testOpenAI.js filename.json");
      console.error("  TRANSCRIPT_FILE=filename.json node tests/testOpenAI.js");
      process.exit(1);
    }
    
    // Sort files by modification time, most recent first
    jsonFiles.sort((a, b) => {
      const statA = fs.statSync(path.join(outputDir, a));
      const statB = fs.statSync(path.join(outputDir, b));
      return statB.mtime - statA.mtime;
    });
    
    transcriptFile = jsonFiles[0];
    transcriptPath = path.join(outputDir, transcriptFile);
    
    console.log(`📁 Using most recent transcript file: ${transcriptFile}`);
    
    if (jsonFiles.length > 1) {
      console.log(`💡 ${jsonFiles.length} transcript files available. To use a specific file:`);
      console.log(`   node tests/testOpenAI.js ${transcriptFile}`);
      jsonFiles.slice(0, 3).forEach(file => {
        console.log(`   node tests/testOpenAI.js ${file}`);
      });
    }
  }
  
  let transcript;
  try {
    const transcriptData = fs.readFileSync(transcriptPath, "utf8");
    transcript = JSON.parse(transcriptData);
    console.log(`✓ Loaded transcript with ${transcript.length} entries`);
  } catch (error) {
    console.error(`❌ Error loading transcript file: ${error.message}`);
    process.exit(1);
  }
  
  // Process transcript with OpenAI
  console.log("\n4. Processing transcript with OpenAI...");
  console.log(`📊 Transcript entries: ${transcript.length}`);
  
  // Show first few entries for context
  console.log("\nFirst 3 transcript entries (parsed):");
  transcript.slice(0, 3).forEach((entry, index) => {
    // Extract speaker name from the text field using <v ParticipantName> format
    let speaker = "Unknown";
    let text = entry.text || "";
    
    const speakerMatch = text.match(/<v\s*([^>]+)>/);
    if (speakerMatch) {
      speaker = speakerMatch[1].trim();
      text = text.replace(/<v[^>]*>/, "").replace(/<\/v>/, "").trim();
    } else {
      speaker = entry.speaker?.replace(/<[^>]*>/g, "").trim() || "Unknown";
      text = text.replace(/<[^>]*>/g, "").trim();
    }
    
    const displayText = text.substring(0, 80);
    console.log(`   ${index + 1}. ${speaker}: ${displayText}${text.length > 80 ? "..." : ""}`);
  });
  
  try {
    console.log("\n🤖 Calling OpenAI for task extraction...");
    const startTime = Date.now();
    
    const result = await processTranscriptForTasks(transcript);
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    if (result.success) {
      console.log("\n✅ SUCCESS! Tasks extracted successfully");
      console.log(`⏱️  Duration: ${duration} seconds`);
      console.log(`🔧 Model: ${result.metadata.model}`);
      console.log(`📊 Tokens used: ${result.metadata.tokensUsed}`);
      
      // Display the extracted tasks
      console.log("\n📋 EXTRACTED TASKS:");
      console.log("=".repeat(50));
      
      const tasks = result.tasks;
      let totalTasks = 0;
      
      for (const [participant, participantTasks] of Object.entries(tasks)) {
        console.log(`\n👤 ${participant}'s Tasks:`);
        
        if (participantTasks.Coding && participantTasks.Coding.length > 0) {
          console.log("   💻 Coding Tasks:");
          participantTasks.Coding.forEach((task, index) => {
            const taskText = typeof task === "string" ? task : task.description;
            const taskStatus = typeof task === "object" ? task.status : "To-do";
            console.log(`      ${index + 1}. ${taskText} (${taskStatus})`);
            totalTasks++;
          });
        }
        
        if (participantTasks["Non-Coding"] && participantTasks["Non-Coding"].length > 0) {
          console.log("   📝 Non-Coding Tasks:");
          participantTasks["Non-Coding"].forEach((task, index) => {
            const taskText = typeof task === "string" ? task : task.description;
            const taskStatus = typeof task === "object" ? task.status : "To-do";
            console.log(`      ${index + 1}. ${taskText} (${taskStatus})`);
            totalTasks++;
          });
        }
        
        if ((!participantTasks.Coding || participantTasks.Coding.length === 0) && 
            (!participantTasks["Non-Coding"] || participantTasks["Non-Coding"].length === 0)) {
          console.log("   (No tasks identified)");
        }
      }
      
      console.log("\n📈 SUMMARY:");
      console.log(`   - Participants: ${Object.keys(tasks).length}`);
      console.log(`   - Total Tasks: ${totalTasks}`);
      console.log(`   - Processing Time: ${duration}s`);
      console.log(`   - Tokens Used: ${result.metadata.tokensUsed}`);
      
      // Show raw GPT response for debugging
      if (process.env.SHOW_RAW_RESPONSE === "true") {
        console.log("\n🔍 RAW GPT RESPONSE:");
        console.log("-".repeat(50));
        console.log(result.rawGptResponse);
        console.log("-".repeat(50));
      }
      
    } else {
      console.error("❌ Task extraction failed");
      process.exit(1);
    }
    
  } catch (error) {
    console.log("\n❌ ERROR occurred during OpenAI processing:");
    console.error(`   Message: ${error.message}`);
    
    if (error.response) {
      console.error(`   HTTP Status: ${error.response.status}`);
      console.error(`   Response Data: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    
    console.log("\nTroubleshooting tips:");
    console.log("   1. Check if your OpenAI API key is valid and has credits");
    console.log("   2. Verify the transcript format is correct");
    console.log("   3. Check your internet connection");
    console.log("   4. Try with a smaller transcript if the current one is very large");
    
    process.exit(1);
  }
  
  console.log("\n" + "=".repeat(70));
  console.log("OPENAI TEST COMPLETED");
  console.log("=".repeat(70));
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
  console.log("Starting OpenAI task processing test...\n");
  testOpenAIProcessing().catch(error => {
    console.error("Test failed:", error);
    process.exit(1);
  });
}

module.exports = {
  testOpenAIProcessing
};
