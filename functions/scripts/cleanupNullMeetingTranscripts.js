/**
 * Cleanup Script: Delete transcripts with null meeting_id
 * 
 * This script removes all documents from the transcripts collection
 * where meeting_id is null. These are typically test transcripts or
 * incomplete transcript records.
 * 
 * Usage: node scripts/cleanupNullMeetingTranscripts.js
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");

const DATABASE_NAME = "standuptickets";
const COLLECTION_NAME = "transcripts";

async function cleanupNullMeetingTranscripts() {
  console.log("🧹 Starting cleanup of transcripts with null meeting_id");
  console.log("=" .repeat(60));
  
  const startTime = Date.now();
  let client = null;
  
  try {
    // Check for MongoDB URI
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI environment variable not set");
    }
    
    console.log("📡 Connecting to MongoDB...");
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    
    const db = client.db(DATABASE_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    console.log(`✅ Connected to database: ${DATABASE_NAME}`);
    console.log(`📋 Target collection: ${COLLECTION_NAME}`);
    
    // First, count documents with null meeting_id
    console.log("\n🔍 Analyzing transcripts with null meeting_id...");
    const nullMeetingIdFilter = { meeting_id: null };
    
    const totalCount = await collection.countDocuments({});
    const nullMeetingIdCount = await collection.countDocuments(nullMeetingIdFilter);
    
    console.log(`📊 Total transcripts in collection: ${totalCount}`);
    console.log(`🎯 Transcripts with null meeting_id: ${nullMeetingIdCount}`);
    
    if (nullMeetingIdCount === 0) {
      console.log("✅ No transcripts with null meeting_id found. Nothing to clean up!");
      return;
    }
    
    // Show some sample documents before deletion
    console.log("\n📝 Sample documents to be deleted:");
    const sampleDocs = await collection.find(nullMeetingIdFilter).limit(3).toArray();
    sampleDocs.forEach((doc, index) => {
      console.log(`${index + 1}. ID: ${doc._id}`);
      console.log(`   Date: ${doc.date || 'N/A'}`);
      console.log(`   Entry Count: ${doc.entry_count || 'N/A'}`);
      console.log(`   Timestamp: ${doc.timestamp || 'N/A'}`);
      console.log(`   Meeting ID: ${doc.meeting_id}`);
      console.log("");
    });
    
    if (sampleDocs.length < nullMeetingIdCount) {
      console.log(`   ... and ${nullMeetingIdCount - sampleDocs.length} more documents`);
    }
    
    // Confirm deletion
    console.log(`⚠️  About to delete ${nullMeetingIdCount} documents with null meeting_id`);
    console.log("⚠️  This action cannot be undone!");
    
    // In a production script, you might want to add a confirmation prompt
    // For now, we'll proceed with a 3-second delay
    console.log("\n⏳ Proceeding with deletion in 3 seconds...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Perform the deletion
    console.log("🗑️  Deleting documents...");
    const deleteResult = await collection.deleteMany(nullMeetingIdFilter);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log("\n🎉 Cleanup completed successfully!");
    console.log("=" .repeat(60));
    console.log(`✅ Documents deleted: ${deleteResult.deletedCount}`);
    console.log(`⏱️  Total duration: ${duration}s`);
    
    // Verify the cleanup
    const remainingNullCount = await collection.countDocuments(nullMeetingIdFilter);
    const finalTotalCount = await collection.countDocuments({});
    
    console.log(`📊 Remaining transcripts with null meeting_id: ${remainingNullCount}`);
    console.log(`📊 Total transcripts remaining: ${finalTotalCount}`);
    
    if (remainingNullCount === 0) {
      console.log("✅ All transcripts with null meeting_id have been successfully removed!");
    } else {
      console.log("⚠️  Some transcripts with null meeting_id still remain. Please check manually.");
    }
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.error("\n💥 Cleanup failed!");
    console.error("=" .repeat(60));
    console.error(`❌ Error: ${error.message}`);
    console.error(`⏱️  Duration before failure: ${duration}s`);
    
    if (error.stack) {
      console.error("\n📋 Stack trace:");
      console.error(error.stack);
    }
    
    console.error("\n🔧 Troubleshooting tips:");
    console.error("1. Check MongoDB connection string in .env file");
    console.error("2. Verify database and collection names");
    console.error("3. Ensure MongoDB server is running and accessible");
    console.error("4. Check network connectivity");
    
    process.exit(1);
    
  } finally {
    if (client) {
      console.log("\n🔌 Closing MongoDB connection...");
      await client.close();
      console.log("✅ Connection closed");
    }
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

// Run the cleanup
if (require.main === module) {
  console.log("🚀 MongoDB Transcript Cleanup Script");
  console.log("Deleting all transcripts with meeting_id: null");
  console.log("");
  
  cleanupNullMeetingTranscripts()
    .then(() => {
      console.log("\n🎉 Script completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Script failed:", error.message);
      process.exit(1);
    });
} else {
  module.exports = { cleanupNullMeetingTranscripts };
}
