/**
 * Script to Remove Embeddings from sptasks Collection
 * 
 * This script removes all embedding-related fields from the sptasks collection
 * to prepare for migration to MongoDB Atlas Vector Search.
 * 
 * WARNING: This script will remove embedding data permanently.
 * Make sure to backup your database before running this script.
 * 
 * Usage: node scripts/removeEmbeddingsFromTasks.js
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

// MongoDB configuration
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = "standuptickets";
const COLLECTION_NAME = "sptasks";

async function removeEmbeddingsFromTasks() {
  console.log("🧹 Starting removal of embeddings from sptasks collection...");
  console.log("=" .repeat(60));
  
  if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI environment variable is not set");
    process.exit(1);
  }

  let client;
  try {
    // Connect to MongoDB
    console.log("🔌 Connecting to MongoDB...");
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log("✅ Connected to MongoDB successfully");

    const db = client.db(DATABASE_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Check collection stats before
    const totalDocsBefore = await collection.countDocuments();
    console.log(`📊 Total documents in ${COLLECTION_NAME}: ${totalDocsBefore}`);

    // Count documents and tasks with embedding fields
    // Need to look inside participant.Coding[].embedding and participant.NonCoding[].embedding
    const allDocs = await collection.find({}).toArray();
    
    let totalTasks = 0;
    let tasksWithEmbeddings = 0;
    let docsWithEmbeddings = 0;
    
    allDocs.forEach(doc => {
      let docHasEmbeddings = false;
      
      Object.keys(doc).forEach(key => {
        if (key === '_id' || key === 'timestamp') return;
        
        const participantData = doc[key];
        if (participantData && typeof participantData === 'object') {
          // Check Coding tasks
          if (participantData.Coding && Array.isArray(participantData.Coding)) {
            participantData.Coding.forEach(task => {
              if (task) {
                totalTasks++;
                if (task.embedding || task.embeddingMetadata || task.embeddingHash || task.lastEmbeddingUpdate) {
                  tasksWithEmbeddings++;
                  docHasEmbeddings = true;
                }
              }
            });
          }
          
          // Check Non-Coding tasks
          if (participantData['Non-Coding'] && Array.isArray(participantData['Non-Coding'])) {
            participantData['Non-Coding'].forEach(task => {
              if (task) {
                totalTasks++;
                if (task.embedding || task.embeddingMetadata || task.embeddingHash || task.lastEmbeddingUpdate) {
                  tasksWithEmbeddings++;
                  docHasEmbeddings = true;
                }
              }
            });
          }
        }
      });
      
      if (docHasEmbeddings) {
        docsWithEmbeddings++;
      }
    });
    
    console.log(`📊 Total tasks found: ${totalTasks}`);
    console.log(`📈 Tasks with embedding fields: ${tasksWithEmbeddings}`);
    console.log(`📁 Documents containing tasks with embeddings: ${docsWithEmbeddings}`);

    if (tasksWithEmbeddings === 0) {
      console.log("ℹ️  No embedding fields found. Nothing to remove.");
      return;
    }

    // Show sample of what will be removed
    console.log("\n🔍 Sample of embedding fields that will be removed:");
    let sampleTask = null;
    let samplePath = "";
    
    // Find first task with embeddings to show as sample
    for (const doc of allDocs) {
      Object.keys(doc).forEach(key => {
        if (key === '_id' || key === 'timestamp') return;
        
        const participantData = doc[key];
        if (participantData && typeof participantData === 'object') {
          // Check Coding tasks
          if (participantData.Coding && Array.isArray(participantData.Coding)) {
            participantData.Coding.forEach((task, index) => {
              if (task && !sampleTask && (task.embedding || task.embeddingMetadata)) {
                sampleTask = task;
                samplePath = `${key}.Coding[${index}]`;
              }
            });
          }
          
          // Check Non-Coding tasks
          if (participantData['Non-Coding'] && Array.isArray(participantData['Non-Coding'])) {
            participantData['Non-Coding'].forEach((task, index) => {
              if (task && !sampleTask && (task.embedding || task.embeddingMetadata)) {
                sampleTask = task;
                samplePath = `${key}["Non-Coding"][${index}]`;
              }
            });
          }
        }
      });
      if (sampleTask) break;
    }

    if (sampleTask) {
      const embeddingFields = {};
      if (sampleTask.embedding) embeddingFields.embedding = `Array(${sampleTask.embedding.length})`;
      if (sampleTask.embeddingMetadata) embeddingFields.embeddingMetadata = sampleTask.embeddingMetadata;
      if (sampleTask.embeddingHash) embeddingFields.embeddingHash = sampleTask.embeddingHash;
      if (sampleTask.lastEmbeddingUpdate) embeddingFields.lastEmbeddingUpdate = sampleTask.lastEmbeddingUpdate;
      
      console.log(`Sample task path: ${samplePath}`);
      console.log("Sample embedding fields:", embeddingFields);
    }

    // Confirm before proceeding
    console.log("\n⚠️  WARNING: This will permanently remove all embedding data!");
    console.log("Make sure you have a backup before proceeding.");
    console.log("\nFields to be removed:");
    console.log("- embedding (vector arrays)");
    console.log("- embeddingMetadata (generation metadata)");
    console.log("- embeddingHash (content hashes)");
    console.log("- lastEmbeddingUpdate (timestamps)");

    // Proceed with removal
    console.log("\n🗑️  Removing embedding fields from all tasks...");
    
    let totalModified = 0;
    let tasksProcessed = 0;
    
    // Process each document individually since we need to modify nested arrays
    for (const doc of allDocs) {
      let docModified = false;
      const docId = doc._id;
      
      Object.keys(doc).forEach(participantName => {
        if (participantName === '_id' || participantName === 'timestamp') return;
        
        const participantData = doc[participantName];
        if (participantData && typeof participantData === 'object') {
          // Process Coding tasks
          if (participantData.Coding && Array.isArray(participantData.Coding)) {
            participantData.Coding.forEach((task, index) => {
              if (task) {
                tasksProcessed++;
                // Remove embedding fields from this task
                if (task.embedding || task.embeddingMetadata || task.embeddingHash || task.lastEmbeddingUpdate) {
                  delete task.embedding;
                  delete task.embeddingMetadata; 
                  delete task.embeddingHash;
                  delete task.lastEmbeddingUpdate;
                  docModified = true;
                }
              }
            });
          }
          
          // Process Non-Coding tasks
          if (participantData['Non-Coding'] && Array.isArray(participantData['Non-Coding'])) {
            participantData['Non-Coding'].forEach((task, index) => {
              if (task) {
                tasksProcessed++;
                // Remove embedding fields from this task
                if (task.embedding || task.embeddingMetadata || task.embeddingHash || task.lastEmbeddingUpdate) {
                  delete task.embedding;
                  delete task.embeddingMetadata;
                  delete task.embeddingHash;
                  delete task.lastEmbeddingUpdate;
                  docModified = true;
                }
              }
            });
          }
        }
      });
      
      // Update the document if modified
      if (docModified) {
        await collection.replaceOne({ _id: docId }, doc);
        totalModified++;
        console.log(`   ✓ Updated document ${totalModified}/${docsWithEmbeddings}`);
      }
    }

    console.log("✅ Embedding removal completed!");
    console.log(`📊 Results:`);
    console.log(`   - Total tasks processed: ${tasksProcessed}`);
    console.log(`   - Documents modified: ${totalModified}/${allDocs.length}`);

    // Verify removal by checking the data again
    const verificationDocs = await collection.find({}).toArray();
    let remainingTasksWithEmbeddings = 0;
    
    verificationDocs.forEach(doc => {
      Object.keys(doc).forEach(key => {
        if (key === '_id' || key === 'timestamp') return;
        
        const participantData = doc[key];
        if (participantData && typeof participantData === 'object') {
          // Check Coding tasks
          if (participantData.Coding && Array.isArray(participantData.Coding)) {
            participantData.Coding.forEach(task => {
              if (task && (task.embedding || task.embeddingMetadata || task.embeddingHash || task.lastEmbeddingUpdate)) {
                remainingTasksWithEmbeddings++;
              }
            });
          }
          
          // Check Non-Coding tasks
          if (participantData['Non-Coding'] && Array.isArray(participantData['Non-Coding'])) {
            participantData['Non-Coding'].forEach(task => {
              if (task && (task.embedding || task.embeddingMetadata || task.embeddingHash || task.lastEmbeddingUpdate)) {
                remainingTasksWithEmbeddings++;
              }
            });
          }
        }
      });
    });
    
    console.log(`\n🔍 Verification:`);
    console.log(`   - Tasks with embeddings before: ${tasksWithEmbeddings}`);
    console.log(`   - Tasks with embeddings after: ${remainingTasksWithEmbeddings}`);
    
    if (remainingTasksWithEmbeddings === 0) {
      console.log("✅ All embedding fields successfully removed!");
    } else {
      console.log("⚠️  Some embedding fields may still exist. Please check manually.");
    }

    // Show collection size reduction
    const stats = await db.command({ collStats: COLLECTION_NAME });
    console.log(`\n📊 Collection statistics after cleanup:`);
    console.log(`   - Total documents: ${stats.count}`);
    console.log(`   - Average document size: ${(stats.avgObjSize / 1024).toFixed(2)} KB`);
    console.log(`   - Total collection size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  } catch (error) {
    console.error("❌ Error during embedding removal:", error.message);
    console.error("Stack trace:", error.stack);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log("\n🔌 MongoDB connection closed");
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("🎉 Embedding removal script completed successfully!");
  console.log("\nNext steps:");
  console.log("1. Run generateTaskEmbeddings.js to create embeddings in Atlas Vector Search");
  console.log("2. Update services to use the new embedding approach");
  console.log("3. Test the new vector search functionality");
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

// Run the script
if (require.main === module) {
  removeEmbeddingsFromTasks().catch(error => {
    console.error("Script failed:", error);
    process.exit(1);
  });
}

module.exports = { removeEmbeddingsFromTasks };
