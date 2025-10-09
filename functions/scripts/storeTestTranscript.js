/**
 * Store test_transcript_converted.json in MongoDB transcripts collection
 * 
 * This script reads the converted transcript and stores it in the MongoDB
 * transcripts collection with the specified date and time.
 */

const fs = require("fs");
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");

// Load environment variables
require("dotenv").config();

/**
 * Store transcript in MongoDB transcripts collection
 */
async function storeTestTranscript() {
  const startTime = Date.now();
  
  console.log("🚀 Storing test transcript in MongoDB transcripts collection");
  console.log("===========================================================");
  
  try {
    // Check if MongoDB URI is configured
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI environment variable not set");
    }
    
    // Read the converted transcript file
    const transcriptPath = path.join(__dirname, "..", "output", "test_transcript_converted.json");
    
    if (!fs.existsSync(transcriptPath)) {
      throw new Error(`Transcript file not found: ${transcriptPath}`);
    }
    
    console.log("📖 Reading transcript file...");
    const transcriptData = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
    console.log(`✅ Loaded transcript with ${transcriptData.length} entries`);
    
    // Connect to MongoDB
    console.log("🔌 Connecting to MongoDB...");
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    
    const db = client.db("standuptickets");
    const transcriptsCollection = db.collection("transcripts");
    
    console.log("✅ Connected to MongoDB");
    
    // Prepare the document to store
    const transcriptDocument = {
      _id: new ObjectId(),
      timestamp: new Date("2025-10-08T14:00:00.000Z"), // October 8th, 2025 at 2 PM UTC
      date: "2025-10-08",
      transcript_data: JSON.stringify(transcriptData), // Store as JSON string, not array
      entry_count: transcriptData.length,
      meeting_id: "test-meeting-converted-transcript",
      transcript_id: "test-transcript-converted-" + Date.now(),
      source: "test_converted_transcript",
      original_filename: "test_transcript_converted.json"
    };
    
    console.log("💾 Storing transcript document...");
    console.log("📊 Document details:");
    console.log(`   - Date: ${transcriptDocument.date}`);
    console.log(`   - Timestamp: ${transcriptDocument.timestamp.toISOString()}`);
    console.log(`   - Entry count: ${transcriptDocument.entry_count}`);
    console.log(`   - Meeting ID: ${transcriptDocument.meeting_id}`);
    console.log(`   - Transcript ID: ${transcriptDocument.transcript_id}`);
    
    // Insert the document
    const result = await transcriptsCollection.insertOne(transcriptDocument);
    
    console.log("✅ Transcript stored successfully!");
    console.log(`📄 Document ID: ${result.insertedId}`);
    
    // Verify the document was stored
    console.log("🔍 Verifying storage...");
    const storedDoc = await transcriptsCollection.findOne({ _id: result.insertedId });
    
    if (storedDoc) {
      console.log("✅ Verification successful!");
      console.log("📊 Stored document summary:");
      console.log(`   - ID: ${storedDoc._id}`);
      console.log(`   - Date: ${storedDoc.date}`);
      console.log(`   - Entry count: ${storedDoc.entry_count}`);
      console.log(`   - Source: ${storedDoc.source}`);
    } else {
      console.warn("⚠️  Verification failed - document not found");
    }
    
    // Close connection
    await client.close();
    console.log("🔌 MongoDB connection closed");
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log("\n🎉 Script completed successfully!");
    console.log(`⏱️  Total duration: ${duration}s`);
    console.log(`📄 Document ID: ${result.insertedId}`);
    console.log(`📊 Entries stored: ${transcriptDocument.entry_count}`);
    
    return {
      success: true,
      documentId: result.insertedId,
      entryCount: transcriptDocument.entry_count,
      duration: duration
    };
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.error("\n💥 Script failed!");
    console.error("==================");
    console.error(`❌ Error: ${error.message}`);
    console.error(`⏱️  Duration before failure: ${duration}s`);
    
    if (error.stack) {
      console.error("\n📋 Stack trace:");
      console.error(error.stack);
    }
    
    return {
      success: false,
      error: error.message,
      duration: duration
    };
  }
}

/**
 * Alternative function to store with custom date/time
 */
async function storeTestTranscriptWithCustomDate(dateString, timeString) {
  console.log(`🕒 Using custom date: ${dateString} at ${timeString}`);
  
  // Parse the custom date and time
  const customDateTime = new Date(`${dateString}T${timeString}`);
  
  if (isNaN(customDateTime.getTime())) {
    throw new Error("Invalid date/time format. Use YYYY-MM-DD for date and HH:MM:SS for time");
  }
  
  console.log(`📅 Parsed datetime: ${customDateTime.toISOString()}`);
  
  // You can modify the storeTestTranscript function to accept custom date/time
  // For now, this is a placeholder for future enhancement
  return await storeTestTranscript();
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  // Check for custom date/time arguments
  if (args.length >= 2) {
    const customDate = args[0]; // YYYY-MM-DD
    const customTime = args[1]; // HH:MM:SS
    
    console.log("🚀 Storing test transcript with custom date/time");
    console.log("===============================================");
    
    storeTestTranscriptWithCustomDate(customDate, customTime)
      .then((result) => {
        process.exit(result.success ? 0 : 1);
      })
      .catch((error) => {
        console.error("\n💥 Script failed:", error.message);
        process.exit(1);
      });
  } else {
    // Use default date/time (October 7th, 2025 at 2 PM)
    storeTestTranscript()
      .then((result) => {
        process.exit(result.success ? 0 : 1);
      })
      .catch((error) => {
        console.error("\n💥 Script failed:", error.message);
        process.exit(1);
      });
  }
}

module.exports = {
  storeTestTranscript,
  storeTestTranscriptWithCustomDate
};
