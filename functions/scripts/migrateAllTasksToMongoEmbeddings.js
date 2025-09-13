/**
 * Migration Script: Generate MongoDB Embeddings for ALL Tasks (Including Completed)
 * 
 * This script generates embeddings for ALL tasks in the database, not just active ones.
 * This is needed for complete historical data for future features.
 * 
 * Usage: node scripts/migrateAllTasksToMongoEmbeddings.js
 */

const { 
  initializeMongoDB,
  getDatabase
} = require("../services/mongoService");

const { 
  addOrUpdateTaskEmbedding, 
  getEmbeddingStatistics
} = require("../services/mongoEmbeddingService");

const { logger } = require("firebase-functions");

/**
 * Get ALL tasks from MongoDB (including completed ones)
 */
async function getAllTasksIncludingCompleted() {
  try {
    await initializeMongoDB();
    const db = getDatabase();
    const collection = db.collection('sptasks');
    
    // Get all documents
    const documents = await collection.find({}, { sort: { timestamp: -1 } }).toArray();
    
    const allTasks = [];
    
    // Extract ALL tasks from all documents (including completed)
    for (const doc of documents) {
      const docId = doc._id;
      const timestamp = doc.timestamp;
      
      // Process each participant in the document
      for (const [participantName, participantData] of Object.entries(doc)) {
        if (participantName === "_id" || participantName === "timestamp") continue;
        
        // Process coding tasks
        if (participantData.Coding && Array.isArray(participantData.Coding)) {
          for (let i = 0; i < participantData.Coding.length; i++) {
            const task = participantData.Coding[i];
            const taskObj = typeof task === "string" ? { description: task, status: "To-do" } : task;
            
            // Include ALL tasks regardless of status
            if (taskObj.description && taskObj.ticketId) {
              allTasks.push({
                participantName,
                ticketId: taskObj.ticketId,
                title: taskObj.title || taskObj.description,
                description: taskObj.description,
                status: taskObj.status || "To-do",
                type: "Coding",
                estimatedTime: taskObj.estimatedTime || 0,
                timeTaken: taskObj.timeTaken || 0,
                isFuturePlan: taskObj.isFuturePlan || false,
                documentId: docId,
                timestamp,
                taskIndex: i,
                taskPath: `${participantName}.Coding.${i}`,
                embedding: taskObj.embedding,
                embeddingMetadata: taskObj.embeddingMetadata
              });
            }
          }
        }
        
        // Process non-coding tasks
        if (participantData["Non-Coding"] && Array.isArray(participantData["Non-Coding"])) {
          for (let i = 0; i < participantData["Non-Coding"].length; i++) {
            const task = participantData["Non-Coding"][i];
            const taskObj = typeof task === "string" ? { description: task, status: "To-do" } : task;
            
            // Include ALL tasks regardless of status
            if (taskObj.description && taskObj.ticketId) {
              allTasks.push({
                participantName,
                ticketId: taskObj.ticketId,
                title: taskObj.title || taskObj.description,
                description: taskObj.description,
                status: taskObj.status || "To-do",
                type: "Non-Coding",
                estimatedTime: taskObj.estimatedTime || 0,
                timeTaken: taskObj.timeTaken || 0,
                isFuturePlan: taskObj.isFuturePlan || false,
                documentId: docId,
                timestamp,
                taskIndex: i,
                taskPath: `${participantName}.Non-Coding.${i}`,
                embedding: taskObj.embedding,
                embeddingMetadata: taskObj.embeddingMetadata
              });
            }
          }
        }
      }
    }
    
    logger.info("Retrieved all tasks from MongoDB", {
      totalTasks: allTasks.length,
      documentsProcessed: documents.length
    });
    
    return allTasks;
    
  } catch (error) {
    logger.error("Error retrieving all tasks", {
      error: error.message
    });
    throw error;
  }
}

/**
 * Main migration function for ALL tasks
 */
async function migrateAllTasksToMongoEmbeddings() {
  console.log("🚀 Starting Migration: Generate Embeddings for ALL Tasks (Including Completed)");
  console.log("=" .repeat(80));
  
  try {
    // Step 1: Initialize MongoDB connection
    console.log("\n📋 Step 1: Initializing MongoDB Connection");
    await initializeMongoDB();
    console.log("✅ MongoDB connection established");
    
    // Step 2: Get current embedding statistics
    console.log("\n📋 Step 2: Current Embedding Statistics");
    const initialStats = await getEmbeddingStatistics();
    console.log(`📊 Tasks with embeddings: ${initialStats.tasksWithEmbeddings}/${initialStats.totalTasks}`);
    console.log(`📊 Coverage: ${initialStats.embeddingCoverage}`);
    
    // Step 3: Fetch ALL tasks from MongoDB (including completed)
    console.log("\n📋 Step 3: Fetching ALL Tasks from MongoDB (Including Completed)");
    const allTasks = await getAllTasksIncludingCompleted();
    console.log(`📊 Found ${allTasks.length} total tasks in database`);
    
    if (allTasks.length === 0) {
      console.log("ℹ️  No tasks found in database. Migration complete.");
      return;
    }
    
    // Step 4: Categorize tasks
    const tasksWithEmbeddings = allTasks.filter(t => t.embedding && t.embeddingMetadata);
    const tasksNeedingEmbeddings = allTasks.filter(t => !t.embedding || !t.embeddingMetadata);
    const completedTasks = allTasks.filter(t => t.status === "Completed");
    const activeTasks = allTasks.filter(t => t.status !== "Completed");
    
    console.log(`📊 Tasks with embeddings: ${tasksWithEmbeddings.length}`);
    console.log(`📊 Tasks needing embeddings: ${tasksNeedingEmbeddings.length}`);
    console.log(`📊 Completed tasks: ${completedTasks.length}`);
    console.log(`📊 Active tasks: ${activeTasks.length}`);
    
    if (tasksNeedingEmbeddings.length === 0) {
      console.log("✨ All tasks already have embeddings!");
      return;
    }
    
    // Step 5: Generate MongoDB embeddings for all tasks needing them
    console.log("\n📋 Step 5: Generating MongoDB Embeddings for All Tasks");
    console.log("⏳ This may take a few minutes depending on the number of tasks...");
    
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;
    
    for (let i = 0; i < tasksNeedingEmbeddings.length; i++) {
      const task = tasksNeedingEmbeddings[i];
      
      try {
        // Create text for embedding
        const text = `${task.title || ''} ${task.description || ''}`.trim();
        
        if (!text || text.length < 3) {
          console.log(`⚠️  Skipped ${task.ticketId}: No meaningful text content`);
          skippedCount++;
          continue;
        }
        
        // Create task data for embedding
        const taskData = {
          title: task.title,
          description: task.description,
          assignee: task.participantName,
          participantName: task.participantName,
          type: task.type,
          status: task.status,
          isFuturePlan: task.isFuturePlan
        };
        
        // Generate and store embedding in MongoDB
        const success = await addOrUpdateTaskEmbedding(task.ticketId, taskData);
        
        if (success) {
          successCount++;
          const statusLabel = task.status === "Completed" ? "🏁" : "🔄";
          console.log(`✅ ${statusLabel} Created embedding for ${task.ticketId}: ${task.title || 'No title'} [${task.status}]`);
        } else {
          errorCount++;
          console.log(`❌ Failed to create embedding for ${task.ticketId}`);
        }
        
        // Progress indicator
        if ((successCount + errorCount + skippedCount) % 10 === 0) {
          console.log(`📊 Progress: ${successCount + errorCount + skippedCount}/${tasksNeedingEmbeddings.length} tasks processed`);
        }
        
      } catch (error) {
        errorCount++;
        console.log(`❌ Error processing ${task.ticketId}: ${error.message}`);
      }
      
      // Add small delay to avoid overwhelming the OpenAI API
      if ((successCount + errorCount) % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Step 6: Final statistics and validation
    console.log("\n📋 Step 6: Migration Complete - Final Statistics");
    
    const finalStats = await getEmbeddingStatistics();
    
    console.log("\n🎉 COMPLETE MIGRATION SUMMARY:");
    console.log(`📊 Total tasks in database: ${allTasks.length}`);
    console.log(`✅ New embeddings created: ${successCount}`);
    console.log(`🔄 Existing embeddings updated: ${updatedCount}`);
    console.log(`⏭️  Tasks skipped (no content): ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📊 Final coverage: ${finalStats.embeddingCoverage}`);
    console.log(`📊 Total embeddings: ${finalStats.tasksWithEmbeddings}`);
    console.log(`🏁 Completed tasks with embeddings: ${completedTasks.filter(t => !tasksNeedingEmbeddings.includes(t)).length + Math.min(successCount, completedTasks.filter(t => tasksNeedingEmbeddings.includes(t)).length)}`);
    console.log(`🔄 Active tasks with embeddings: ${activeTasks.filter(t => !tasksNeedingEmbeddings.includes(t)).length + Math.min(successCount, activeTasks.filter(t => tasksNeedingEmbeddings.includes(t)).length)}`);
    
    console.log("\n✨ Complete historical data migration finished!");
    console.log("🚀 All tasks now have embeddings for future features!");
    
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    console.error("Stack trace:", error.stack);
    process.exit(1);
  }
}

// Main execution
if (require.main === module) {
  migrateAllTasksToMongoEmbeddings()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { 
  migrateAllTasksToMongoEmbeddings,
  getAllTasksIncludingCompleted
};
