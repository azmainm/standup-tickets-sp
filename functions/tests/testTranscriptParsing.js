/**
 * Test file to verify transcript parsing functionality
 * 
 * This test shows how the transcript format is being parsed
 * and what the GPT will see as input
 * 
 * Usage: node tests/testTranscriptParsing.js [filename.json]
 */

const { formatTranscriptForGPT } = require("../services/openaiService");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function testTranscriptParsing() {
  console.log("=".repeat(70));
  console.log("TESTING TRANSCRIPT PARSING");
  console.log("=".repeat(70));
  
  // Find and load transcript file
  const outputDir = path.join(__dirname, "../output");
  
  if (!fs.existsSync(outputDir)) {
    console.error("❌ Output directory not found.");
    process.exit(1);
  }
  
  // Determine which transcript file to use
  let transcriptFile;
  let transcriptPath;
  
  if (process.argv[2]) {
    transcriptFile = process.argv[2];
    if (!transcriptFile.endsWith(".json")) {
      transcriptFile += ".json";
    }
    transcriptPath = path.join(outputDir, transcriptFile);
    
    if (!fs.existsSync(transcriptPath)) {
      console.error(`❌ Specified transcript file not found: ${transcriptFile}`);
      process.exit(1);
    }
  } else {
    const files = fs.readdirSync(outputDir);
    const jsonFiles = files.filter(file => file.endsWith(".json")).sort();
    
    if (jsonFiles.length === 0) {
      console.error("❌ No transcript JSON files found.");
      process.exit(1);
    }
    
    transcriptFile = jsonFiles[jsonFiles.length - 1];
    transcriptPath = path.join(outputDir, transcriptFile);
  }
  
  console.log(`📁 Using transcript file: ${transcriptFile}`);
  
  // Load transcript
  let transcript;
  try {
    const transcriptData = fs.readFileSync(transcriptPath, "utf8");
    transcript = JSON.parse(transcriptData);
    console.log(`✓ Loaded transcript with ${transcript.length} entries`);
  } catch (error) {
    console.error(`❌ Error loading transcript: ${error.message}`);
    process.exit(1);
  }
  
  // Show raw entries
  console.log("\n1. RAW TRANSCRIPT ENTRIES (first 5):");
  console.log("-".repeat(50));
  transcript.slice(0, 5).forEach((entry, index) => {
    console.log(`Entry ${index + 1}:`);
    console.log(`  speaker: "${entry.speaker}"`);
    console.log(`  text: "${entry.text}"`);
    console.log("");
  });
  
  // Show parsed entries
  console.log("\n2. PARSED ENTRIES (first 10):");
  console.log("-".repeat(50));
  transcript.slice(0, 10).forEach((entry, index) => {
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
    
    if (text.length > 0) {
      console.log(`${index + 1}. ${speaker}: ${text}`);
    }
  });
  
  // Format for GPT and show sample
  console.log("\n3. FORMATTED FOR GPT (first 500 characters):");
  console.log("-".repeat(50));
  const formattedTranscript = formatTranscriptForGPT(transcript);
  console.log(formattedTranscript.substring(0, 500) + "...");
  
  // Analyze participants
  console.log("\n4. PARTICIPANT ANALYSIS:");
  console.log("-".repeat(50));
  const participants = new Set();
  let totalMessages = 0;
  
  transcript.forEach(entry => {
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
    
    if (text.length > 0 && speaker !== "Unknown") {
      participants.add(speaker);
      totalMessages++;
    }
  });
  
  console.log(`Total participants identified: ${participants.size}`);
  console.log(`Total messages: ${totalMessages}`);
  console.log("\nParticipants:");
  Array.from(participants).forEach((participant, index) => {
    console.log(`  ${index + 1}. ${participant}`);
  });
  
  // Show character count for GPT
  console.log("\n5. GPT INPUT STATISTICS:");
  console.log("-".repeat(50));
  console.log(`Total characters: ${formattedTranscript.length}`);
  console.log(`Estimated tokens: ~${Math.ceil(formattedTranscript.length / 4)}`);
  console.log(`Lines: ${formattedTranscript.split("\n").length}`);
  
  console.log("\n" + "=".repeat(70));
  console.log("TRANSCRIPT PARSING TEST COMPLETED");
  console.log("=".repeat(70));
}

// Run the test
if (require.main === module) {
  testTranscriptParsing().catch(error => {
    console.error("Test failed:", error);
    process.exit(1);
  });
}

module.exports = {
  testTranscriptParsing
};
