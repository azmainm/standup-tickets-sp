/**
 * Convert WebVTT transcript format to clean JSON format
 * 
 * This script converts test_transcript_real.json (WebVTT format) 
 * to the same format as test_transcript.json (clean JSON array)
 */

const fs = require("fs");
const path = require("path");

/**
 * Parse WebVTT format and convert to clean JSON format
 * @param {string} webvttContent - Raw WebVTT content
 * @returns {Array} Array of transcript entries in clean format
 */
function convertWebVTTToJSON(webvttContent) {
  const lines = webvttContent.split("\n");
  const transcriptEntries = [];
  
  let currentEntry = null;
  let isProcessingEntry = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines and WEBVTT header
    if (!line || line === "WEBVTT") {
      continue;
    }
    
    // Check if this is a timestamp line (contains -->)
    if (line.includes(" --> ")) {
      // Extract start and end times
      const [startTime, _endTime] = line.split(" --> ");
      
      currentEntry = {
        speaker: startTime,
        startTime: "-->",
        text: ""
      };
      isProcessingEntry = true;
      continue;
    }
    
    // Check if this is an ID line (UUID format or similar)
    if (line.match(/^[a-f0-9-]+\/\d+-\d+$/)) {
      // This is an entry ID, skip it
      continue;
    }
    
    // If we"re processing an entry and this line contains text
    if (isProcessingEntry && line) {
      // This should be the text content
      currentEntry.text = line;
      
      // Add the entry to our array
      transcriptEntries.push(currentEntry);
      
      // Reset for next entry
      currentEntry = null;
      isProcessingEntry = false;
    }
  }
  
  return transcriptEntries;
}

/**
 * Clean up speaker names and format text properly
 * @param {Array} entries - Raw transcript entries
 * @returns {Array} Cleaned transcript entries
 */
function cleanTranscriptEntries(entries) {
  return entries
    .filter(entry => entry.text && entry.text.trim()) // Remove empty entries
    .map((entry, index) => {
      let text = entry.text.trim();
      
      // Extract speaker name if it exists in the text
      const speakerMatch = text.match(/<v ([^>]+)>/);
      let speaker = speakerMatch ? speakerMatch[1] : "Unknown Speaker";
      
      // Clean up the text by removing speaker tags
      text = text.replace(/<v [^>]+>/, "").replace(/<\/v>/, "").trim();
      
      // If text is empty after cleaning, skip this entry
      if (!text) {
        return null;
      }
      
      // Re-wrap with speaker tags for consistency with test_transcript.json format
      const formattedText = `<v ${speaker}>${text}</v>`;
      
      // Generate a simple timestamp format
      const minutes = Math.floor(index / 4); // Roughly 4 entries per minute
      const seconds = (index % 4) * 15; // 15 seconds apart
      const timestamp = `00:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.000`;
      
      return {
        speaker: timestamp,
        startTime: "-->",
        text: formattedText
      };
    })
    .filter(entry => entry !== null); // Remove null entries
}

/**
 * Main conversion function
 */
async function convertTranscript() {
  const inputPath = path.join(__dirname, "..", "output", "test_transcript_real.json");
  const outputPath = path.join(__dirname, "..", "output", "test_transcript_converted.json");
  
  console.log("🔄 Converting WebVTT transcript to JSON format...");
  console.log(`📁 Input: ${inputPath}`);
  console.log(`📁 Output: ${outputPath}`);
  
  try {
    // Check if input file exists
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }
    
    // Read the WebVTT content
    console.log("📖 Reading WebVTT file...");
    const webvttContent = fs.readFileSync(inputPath, "utf8");
    
    // Convert WebVTT to JSON format
    console.log("🔄 Converting format...");
    const rawEntries = convertWebVTTToJSON(webvttContent);
    console.log(`📊 Found ${rawEntries.length} raw entries`);
    
    // Clean and format the entries
    console.log("🧹 Cleaning and formatting entries...");
    const cleanedEntries = cleanTranscriptEntries(rawEntries);
    console.log(`✅ Processed ${cleanedEntries.length} clean entries`);
    
    // Write the converted JSON
    console.log("💾 Writing converted JSON...");
    fs.writeFileSync(outputPath, JSON.stringify(cleanedEntries, null, 2), "utf8");
    
    console.log("✅ Conversion completed successfully!");
    console.log("📊 Statistics:");
    console.log(`   - Raw entries: ${rawEntries.length}`);
    console.log(`   - Clean entries: ${cleanedEntries.length}`);
    const reductionPercent = ((rawEntries.length - cleanedEntries.length) / rawEntries.length * 100).toFixed(1);
    console.log(`   - Reduction: ${reductionPercent}%`);
    console.log(`📁 Output saved to: ${outputPath}`);
    
    // Show a sample of the converted data
    console.log("\n📋 Sample of converted data:");
    console.log(JSON.stringify(cleanedEntries.slice(0, 3), null, 2));
    
    return {
      success: true,
      inputPath,
      outputPath,
      rawEntries: rawEntries.length,
      cleanEntries: cleanedEntries.length
    };
    
  } catch (error) {
    console.error("❌ Conversion failed:", error.message);
    console.error("📋 Stack trace:", error.stack);
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Alternative function to replace the original test_transcript.json
 */
async function replaceOriginalTestTranscript() {
  const convertedPath = path.join(__dirname, "..", "output", "test_transcript_converted.json");
  const originalPath = path.join(__dirname, "..", "output", "test_transcript.json");
  const backupPath = path.join(__dirname, "..", "output", "test_transcript_backup.json");
  
  try {
    // Check if converted file exists
    if (!fs.existsSync(convertedPath)) {
      throw new Error("Converted file not found. Run conversion first.");
    }
    
    // Backup original file
    if (fs.existsSync(originalPath)) {
      console.log("📋 Creating backup of original test_transcript.json...");
      fs.copyFileSync(originalPath, backupPath);
      console.log(`✅ Backup created: ${backupPath}`);
    }
    
    // Replace original with converted
    console.log("🔄 Replacing original test_transcript.json...");
    fs.copyFileSync(convertedPath, originalPath);
    console.log("✅ Original test_transcript.json replaced successfully!");
    
    return { success: true };
    
  } catch (error) {
    console.error("❌ Replacement failed:", error.message);
    return { success: false, error: error.message };
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const shouldReplace = args.includes("--replace");
  
  console.log("🚀 WebVTT to JSON Transcript Converter");
  console.log("=====================================");
  
  convertTranscript()
    .then((result) => {
      if (result.success) {
        console.log("\n🎉 Conversion completed successfully!");
        
        if (shouldReplace) {
          console.log("\n🔄 Replacing original test_transcript.json...");
          return replaceOriginalTestTranscript();
        } else {
          console.log("\n💡 To replace the original test_transcript.json, run:");
          console.log("   node scripts/convertTranscriptFormat.js --replace");
        }
      }
      return result;
    })
    .then((result) => {
      if (result && result.success !== undefined) {
        process.exit(result.success ? 0 : 1);
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Script failed:", error.message);
      process.exit(1);
    });
}

module.exports = {
  convertTranscript,
  replaceOriginalTestTranscript,
  convertWebVTTToJSON,
  cleanTranscriptEntries
};
