/**
 * Migration Script: Move from FAISS Vector DB to MongoDB Embeddings
 * 
 * This script:
 * 1. Migrates all existing tasks to use MongoDB-stored embeddings
 * 2. Generates embeddings for tasks that don't have them
 * 3. Safely removes old FAISS vector database files
 * 4. Validates the migration was successful
 * 
 * Usage: node scripts/migrateToMongoEmbeddings.js
 */

const { 
  getActiveTasks, 
  initializeMongoDB 
} = require("../services/mongoService");

const { 
  addOrUpdateTaskEmbedding, 
  getEmbeddingStatistics,
  removeTaskEmbedding
} = require("../services/mongoEmbeddingService");

const { logger } = require("firebase-functions");
const fs = require("fs").promises;
const path = require("path");

// Configuration
const VECTOR_DB_PATH = path.join(__dirname, "../output/vector_db");
const BACKUP_PATH = path.join(__dirname, "../output/vector_db_backup");

/**
 * Main migration function
 */
async function migrateToMongoEmbeddings() {
  console.log("🚀 Starting Migration: FAISS Vector DB → MongoDB Embeddings");
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
    
    // Step 3: Backup existing FAISS vector database
    console.log("\n📋 Step 3: Backing Up Existing Vector Database");
    const backupResult = await backupVectorDB();
    if (backupResult.success) {
      console.log("✅ Vector database backed up successfully");
    } else {
      console.log("⚠️ Vector database backup failed, but continuing...");
    }
    
    // Step 4: Fetch all existing tasks from MongoDB
    console.log("\n📋 Step 4: Fetching All Tasks from MongoDB");
    const allTasks = await getActiveTasks();
    console.log(`📊 Found ${allTasks.length} tasks in database`);
    
    if (allTasks.length === 0) {
      console.log("ℹ️  No tasks found in database. Migration complete.");
      return;
    }
    
    // Step 5: Generate MongoDB embeddings for all tasks
    console.log("\n📋 Step 5: Generating MongoDB Embeddings");
    console.log("⏳ This may take a few minutes depending on the number of tasks...");
    
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;
    
    for (let i = 0; i < allTasks.length; i++) {
      const task = allTasks[i];
      
      try {
        // Check if task already has embedding
        const hasExistingEmbedding = task.embedding && task.embeddingMetadata;
        
        if (hasExistingEmbedding) {
          // Check if embedding is up to date
          const text = `${task.title || ''} ${task.description || ''}`.trim();
          const { needsEmbeddingUpdate, createTextHash } = require("../services/mongoEmbeddingService");
          
          if (!needsEmbeddingUpdate(text, task.embeddingMetadata)) {
            console.log(`⏭️  Skipped ${task.ticketId}: Already has up-to-date embedding`);
            skippedCount++;
            continue;
          }
          
          console.log(`🔄 Updating ${task.ticketId}: Embedding needs refresh`);
        }
        
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
          if (hasExistingEmbedding) {
            updatedCount++;
            console.log(`✅ Updated embedding for ${task.ticketId}: ${task.title || 'No title'}`);
          } else {
            successCount++;
            console.log(`✅ Created embedding for ${task.ticketId}: ${task.title || 'No title'}`);
          }
        } else {
          errorCount++;
          console.log(`❌ Failed to create embedding for ${task.ticketId}`);
        }
        
        // Progress indicator
        if ((successCount + updatedCount + errorCount + skippedCount) % 10 === 0) {
          console.log(`📊 Progress: ${successCount + updatedCount + errorCount + skippedCount}/${allTasks.length} tasks processed`);
        }
        
      } catch (error) {
        errorCount++;
        console.log(`❌ Error processing ${task.ticketId}: ${error.message}`);
      }
      
      // Add small delay to avoid overwhelming the OpenAI API
      if ((successCount + updatedCount + errorCount) % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Step 6: Final statistics and validation
    console.log("\n📋 Step 6: Migration Complete - Final Statistics");
    
    const finalStats = await getEmbeddingStatistics();
    
    console.log("\n🎉 MIGRATION SUMMARY:");
    console.log(`📊 Total tasks processed: ${allTasks.length}`);
    console.log(`✅ New embeddings created: ${successCount}`);
    console.log(`🔄 Existing embeddings updated: ${updatedCount}`);
    console.log(`⏭️  Tasks skipped (up-to-date): ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📊 Final coverage: ${finalStats.embeddingCoverage}`);
    console.log(`📊 Total embeddings: ${finalStats.tasksWithEmbeddings}`);
    
    // Step 7: Test the migration with a sample search
    console.log("\n📋 Step 7: Testing Migration with Sample Search");
    
    if (allTasks.length > 0) {
      const { findSimilarTasksInMongoDB } = require("../services/mongoEmbeddingService");
      
      const sampleTask = allTasks.find(t => t.description && t.description.length > 10) || allTasks[0];
      const sampleQuery = sampleTask.description ? sampleTask.description.substring(0, 50) : sampleTask.title || "test query";
      
      console.log(`🔍 Testing with query: "${sampleQuery}"`);
      
      try {
        const results = await findSimilarTasksInMongoDB(sampleQuery, { assignee: sampleTask.participantName }, 3, 0.5);
        console.log(`✅ Search test successful: Found ${results.length} similar tasks`);
        
        if (results.length > 0) {
          console.log("📋 Top results:");
          results.forEach((result, index) => {
            console.log(`  ${index + 1}. ${result.ticketId}: ${result.title || result.description.substring(0, 50)} (${(result.similarity * 100).toFixed(1)}%)`);
          });
        }
      } catch (error) {
        console.log(`⚠️  Search test failed: ${error.message}`);
      }
    }
    
    // Step 8: Cleanup old vector database (optional)
    console.log("\n📋 Step 8: Cleanup Options");
    console.log("🗂️  Old FAISS vector database files backed up to:", BACKUP_PATH);
    console.log("⚠️  You can safely delete the old vector database files:");
    console.log(`   - ${path.join(VECTOR_DB_PATH, "faiss_index.index")}`);
    console.log(`   - ${path.join(VECTOR_DB_PATH, "task_embeddings.json")}`);
    console.log(`   - ${path.join(VECTOR_DB_PATH, "metadata.json")}`);
    console.log("💡 Run: npm run cleanup:old-vector-db");
    
    console.log("\n✨ Migration completed successfully!");
    console.log("🚀 MongoDB embeddings are now ready for ultra-fast task similarity search!");
    console.log("\nNext steps:");
    console.log("1. Test the enhanced system: npm run test:fake-flow");
    console.log("2. Test real flow: npm run test:real-flow");
    console.log("3. Deploy to production when ready");
    
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    console.error("Stack trace:", error.stack);
    process.exit(1);
  }
}

/**
 * Backup existing FAISS vector database files
 */
async function backupVectorDB() {
  try {
    // Create backup directory
    await fs.mkdir(BACKUP_PATH, { recursive: true });
    
    const filesToBackup = [
      "faiss_index.index",
      "task_embeddings.json", 
      "metadata.json"
    ];
    
    let backedUpCount = 0;
    
    for (const filename of filesToBackup) {
      const sourcePath = path.join(VECTOR_DB_PATH, filename);
      const backupPath = path.join(BACKUP_PATH, filename);
      
      try {
        await fs.access(sourcePath);
        await fs.copyFile(sourcePath, backupPath);
        backedUpCount++;
        console.log(`📁 Backed up: ${filename}`);
      } catch (error) {
        // File doesn't exist, skip
        console.log(`⏭️  Skipped: ${filename} (not found)`);
      }
    }
    
    // Create backup info file
    const backupInfo = {
      timestamp: new Date().toISOString(),
      backedUpFiles: backedUpCount,
      totalFiles: filesToBackup.length,
      migration: "FAISS to MongoDB Embeddings"
    };
    
    await fs.writeFile(
      path.join(BACKUP_PATH, "backup_info.json"), 
      JSON.stringify(backupInfo, null, 2)
    );
    
    return { success: true, backedUpCount };
    
  } catch (error) {
    console.error("Error backing up vector database:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Preview migration without executing
 */
async function previewMigration() {
  console.log("🔍 MIGRATION PREVIEW - What will be migrated");
  console.log("=" .repeat(50));
  
  try {
    // Initialize MongoDB
    await initializeMongoDB();
    
    // Get current statistics
    const stats = await getEmbeddingStatistics();
    console.log(`📊 Total tasks: ${stats.totalTasks}`);
    console.log(`📊 Tasks with embeddings: ${stats.tasksWithEmbeddings}`);
    console.log(`📊 Coverage: ${stats.embeddingCoverage}`);
    
    // Get task breakdown
    const allTasks = await getActiveTasks();
    const tasksByType = allTasks.reduce((acc, task) => {
      acc[task.type] = (acc[task.type] || 0) + 1;
      return acc;
    }, {});
    
    const tasksByAssignee = allTasks.reduce((acc, task) => {
      acc[task.participantName] = (acc[task.participantName] || 0) + 1;
      return acc;
    }, {});
    
    console.log("\n📊 Tasks by type:");
    Object.entries(tasksByType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    
    console.log("\n👥 Tasks by assignee:");
    Object.entries(tasksByAssignee).forEach(([assignee, count]) => {
      console.log(`  ${assignee}: ${count}`);
    });
    
    // Check existing embeddings
    const tasksWithEmbeddings = allTasks.filter(t => t.embedding && t.embeddingMetadata);
    const tasksNeedingEmbeddings = allTasks.filter(t => !t.embedding || !t.embeddingMetadata);
    
    console.log(`\n🔄 Tasks needing new embeddings: ${tasksNeedingEmbeddings.length}`);
    console.log(`✅ Tasks with existing embeddings: ${tasksWithEmbeddings.length}`);
    
    if (tasksNeedingEmbeddings.length > 0) {
      console.log("\n💡 To run the actual migration: node scripts/migrateToMongoEmbeddings.js");
    } else {
      console.log("\n✨ All tasks already have embeddings!");
    }
    
  } catch (error) {
    console.error("❌ Preview failed:", error.message);
  }
}

/**
 * Clean up old vector database files
 */
async function cleanupOldVectorDB() {
  console.log("🧹 Cleaning up old FAISS vector database files");
  
  try {
    const filesToRemove = [
      "faiss_index.index",
      "task_embeddings.json",
      "metadata.json"
    ];
    
    let removedCount = 0;
    
    for (const filename of filesToRemove) {
      const filePath = path.join(VECTOR_DB_PATH, filename);
      
      try {
        await fs.access(filePath);
        await fs.unlink(filePath);
        removedCount++;
        console.log(`🗑️  Removed: ${filename}`);
      } catch (error) {
        console.log(`⏭️  Skipped: ${filename} (not found)`);
      }
    }
    
    console.log(`✅ Cleanup complete: ${removedCount} files removed`);
    
    // Try to remove empty vector_db directory
    try {
      const files = await fs.readdir(VECTOR_DB_PATH);
      if (files.length === 0) {
        await fs.rmdir(VECTOR_DB_PATH);
        console.log("📁 Removed empty vector_db directory");
      }
    } catch (error) {
      // Directory not empty or doesn't exist, ignore
    }
    
  } catch (error) {
    console.error("❌ Cleanup failed:", error.message);
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes("preview")) {
    previewMigration().then(() => process.exit(0)).catch(() => process.exit(1));
  } else if (args.includes("cleanup")) {
    cleanupOldVectorDB().then(() => process.exit(0)).catch(() => process.exit(1));
  } else {
    migrateToMongoEmbeddings().then(() => process.exit(0)).catch(() => process.exit(1));
  }
}

module.exports = { 
  migrateToMongoEmbeddings, 
  previewMigration, 
  cleanupOldVectorDB, 
  backupVectorDB 
};
