/**
 * One-time Migration Script: Populate Vector Database with Existing Tasks
 * 
 * This script generates embeddings for all existing tasks in the MongoDB database
 * and stores them in the FAISS vector database for similarity search.
 * 
 * Usage: node scripts/migrateExistingTasksToVectorDB.js
 */

const { 
  initializeVectorDB, 
  addTaskEmbedding, 
  clearVectorDB, 
  getVectorDBStats,
  isVectorDBAvailable 
} = require("../services/vectorService");

const { getActiveTasks, getTasks } = require("../services/mongoService");
const { logger } = require("firebase-functions");

// Load environment variables
require("dotenv").config();

/**
 * Main migration function
 */
async function migrateExistingTasks() {
  console.log("🚀 Starting Migration: Existing Tasks → Vector Database");
  console.log("=" .repeat(80));
  
  try {
    // Step 1: Check if vector database is available
    console.log("\n📋 Step 1: Checking Vector Database Availability");
    const vectorAvailable = await isVectorDBAvailable();
    
    if (!vectorAvailable) {
      console.log("❌ Vector database (FAISS) not available!");
      console.log("📦 Please install faiss-node: npm install faiss-node");
      process.exit(1);
    }
    
    console.log("✅ Vector database available");
    
    // Step 2: Initialize vector database
    console.log("\n📋 Step 2: Initializing Vector Database");
    await initializeVectorDB();
    console.log("✅ Vector database initialized");
    
    // Step 3: Get current vector database stats
    console.log("\n📋 Step 3: Current Vector Database Statistics");
    const initialStats = await getVectorDBStats();
    console.log(`📊 Current embeddings: ${initialStats.totalEmbeddings}`);
    console.log(`📊 Index loaded: ${initialStats.indexLoaded}`);
    
    // Step 4: Ask user if they want to clear existing embeddings
    if (initialStats.totalEmbeddings > 0) {
      console.log(`\n⚠️  Found ${initialStats.totalEmbeddings} existing embeddings in vector database`);
      console.log("🔄 Clearing existing embeddings to ensure clean migration...");
      await clearVectorDB();
      console.log("✅ Existing embeddings cleared");
    }
    
    // Step 5: Fetch all existing tasks from database
    console.log("\n📋 Step 5: Fetching All Existing Tasks from Database");
    
    // Get all task documents (not just active ones for complete migration)
    const allTaskDocuments = await getTasks({}, { limit: 1000, sort: { timestamp: -1 } });
    console.log(`📊 Found ${allTaskDocuments.length} task documents in database`);
    
    // Convert documents to flat task list
    const allTasks = [];
    
    for (const doc of allTaskDocuments) {
      const docId = doc._id;
      const timestamp = doc.timestamp;
      
      // Process each participant in the document
      for (const [participantName, participantData] of Object.entries(doc)) {
        if (participantName === "_id" || participantName === "timestamp") continue;
        
        // Process coding tasks
        if (participantData.Coding && Array.isArray(participantData.Coding)) {
          for (let i = 0; i < participantData.Coding.length; i++) {
            const task = participantData.Coding[i];
            if (!task) continue;
            
            const taskObj = typeof task === "string" ? { description: task, status: "To-do" } : task;
            
            allTasks.push({
              participantName,
              ticketId: taskObj.ticketId || `${docId}_${participantName}_coding_${i}`,
              title: taskObj.title || null,
              description: taskObj.description || task,
              status: taskObj.status || "To-do",
              type: "Coding",
              estimatedTime: taskObj.estimatedTime || 0,
              timeTaken: taskObj.timeTaken || 0,
              documentId: docId,
              timestamp,
              lastModifiedAp: taskObj.lastModifiedAp,
              isFuturePlan: taskObj.isFuturePlan || false
            });
          }
        }
        
        // Process non-coding tasks
        if (participantData["Non-Coding"] && Array.isArray(participantData["Non-Coding"])) {
          for (let i = 0; i < participantData["Non-Coding"].length; i++) {
            const task = participantData["Non-Coding"][i];
            if (!task) continue;
            
            const taskObj = typeof task === "string" ? { description: task, status: "To-do" } : task;
            
            allTasks.push({
              participantName,
              ticketId: taskObj.ticketId || `${docId}_${participantName}_noncoding_${i}`,
              title: taskObj.title || null,
              description: taskObj.description || task,
              status: taskObj.status || "To-do",
              type: "Non-Coding",
              estimatedTime: taskObj.estimatedTime || 0,
              timeTaken: taskObj.timeTaken || 0,
              documentId: docId,
              timestamp,
              lastModifiedAp: taskObj.lastModifiedAp,
              isFuturePlan: taskObj.isFuturePlan || false
            });
          }
        }
      }
    }
    
    console.log(`📊 Extracted ${allTasks.length} individual tasks for migration`);
    
    if (allTasks.length === 0) {
      console.log("ℹ️  No tasks found in database. Migration complete.");
      return;
    }
    
    // Step 6: Generate embeddings for all tasks
    console.log("\n📋 Step 6: Generating Embeddings for All Tasks");
    console.log("⏳ This may take a few minutes depending on the number of tasks...");
    
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    
    for (let i = 0; i < allTasks.length; i++) {
      const task = allTasks[i];
      
      try {
        // Create text for embedding (title + description)
        const text = `${task.title || ''} ${task.description || ''}`.trim();
        
        if (!text || text.length < 3) {
          console.log(`⚠️  Skipped task ${task.ticketId || `#${i+1}`}: No meaningful text content`);
          skippedCount++;
          continue;
        }
        
        // Create metadata
        const metadata = {
          assignee: task.participantName,
          type: task.type,
          status: task.status,
          title: task.title,
          lastModified: task.timestamp,
          lastModifiedAp: task.lastModifiedAp,
          isFuturePlan: task.isFuturePlan
        };
        
        // Generate and store embedding
        const success = await addTaskEmbedding(task.ticketId, text, metadata);
        
        if (success) {
          successCount++;
          if (successCount % 10 === 0) {
            console.log(`✅ Progress: ${successCount}/${allTasks.length} embeddings created`);
          }
        } else {
          errorCount++;
          console.log(`❌ Failed to create embedding for ${task.ticketId}: ${task.title || task.description.substring(0, 50)}`);
        }
        
      } catch (error) {
        errorCount++;
        console.log(`❌ Error processing task ${task.ticketId || `#${i+1}`}: ${error.message}`);
      }
      
      // Add small delay to avoid overwhelming the OpenAI API
      if ((successCount + errorCount) % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Step 7: Final statistics and verification
    console.log("\n📋 Step 7: Migration Complete - Final Statistics");
    
    const finalStats = await getVectorDBStats();
    
    console.log("\n🎉 MIGRATION SUMMARY:");
    console.log(`📊 Total tasks processed: ${allTasks.length}`);
    console.log(`✅ Embeddings created: ${successCount}`);
    console.log(`⚠️  Tasks skipped: ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📊 Final vector DB size: ${finalStats.totalEmbeddings} embeddings`);
    console.log(`📊 Index status: ${finalStats.indexLoaded ? 'Loaded' : 'Not loaded'}`);
    
    // Step 8: Test the migration with a sample search
    console.log("\n📋 Step 8: Testing Migration with Sample Search");
    
    if (allTasks.length > 0) {
      const { findSimilarTasks } = require("../services/vectorService");
      
      const sampleTask = allTasks[0];
      const sampleQuery = sampleTask.description.substring(0, 50);
      
      console.log(`🔍 Testing with query: "${sampleQuery}"`);
      
      try {
        const results = await findSimilarTasks(sampleQuery, { assignee: sampleTask.participantName }, 3, 0.5);
        console.log(`✅ Search test successful: Found ${results.length} similar tasks`);
        
        if (results.length > 0) {
          console.log("📋 Top results:");
          results.forEach((result, index) => {
            console.log(`  ${index + 1}. ${result.taskId}: ${result.metadata.title || result.text.substring(0, 50)} (${(result.similarity * 100).toFixed(1)}%)`);
          });
        }
      } catch (error) {
        console.log(`⚠️  Search test failed: ${error.message}`);
      }
    }
    
    console.log("\n✨ Migration completed successfully!");
    console.log("🚀 Vector database is now ready for ultra-fast task similarity search!");
    console.log("\nNext steps:");
    console.log("1. Test the enhanced system: node tests/testVectorDB.js");
    console.log("2. Run full flow test: node tests/testFakeFlow.js");
    console.log("3. Deploy to production when ready");
    
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    console.error("Stack trace:", error.stack);
    process.exit(1);
  }
}

/**
 * Additional function to show migration preview without executing
 */
async function previewMigration() {
  console.log("🔍 MIGRATION PREVIEW - What will be migrated");
  console.log("=" .repeat(50));
  
  try {
    // Get all task documents
    const allTaskDocuments = await getTasks({}, { limit: 1000, sort: { timestamp: -1 } });
    console.log(`📊 Found ${allTaskDocuments.length} task documents`);
    
    let totalTasks = 0;
    const participantCounts = {};
    const typeCounts = { "Coding": 0, "Non-Coding": 0 };
    
    for (const doc of allTaskDocuments) {
      for (const [participantName, participantData] of Object.entries(doc)) {
        if (participantName === "_id" || participantName === "timestamp") continue;
        
        participantCounts[participantName] = participantCounts[participantName] || { Coding: 0, "Non-Coding": 0 };
        
        if (participantData.Coding && Array.isArray(participantData.Coding)) {
          const validTasks = participantData.Coding.filter(task => task && (task.description || task));
          participantCounts[participantName].Coding += validTasks.length;
          typeCounts.Coding += validTasks.length;
          totalTasks += validTasks.length;
        }
        
        if (participantData["Non-Coding"] && Array.isArray(participantData["Non-Coding"])) {
          const validTasks = participantData["Non-Coding"].filter(task => task && (task.description || task));
          participantCounts[participantName]["Non-Coding"] += validTasks.length;
          typeCounts["Non-Coding"] += validTasks.length;
          totalTasks += validTasks.length;
        }
      }
    }
    
    console.log(`📊 Total tasks to migrate: ${totalTasks}`);
    console.log(`📊 Coding tasks: ${typeCounts.Coding}`);
    console.log(`📊 Non-Coding tasks: ${typeCounts["Non-Coding"]}`);
    console.log("\n👥 Tasks by participant:");
    
    for (const [participant, counts] of Object.entries(participantCounts)) {
      console.log(`  ${participant}: ${counts.Coding + counts["Non-Coding"]} total (${counts.Coding} coding, ${counts["Non-Coding"]} non-coding)`);
    }
    
    console.log("\n💡 To run the actual migration: node scripts/migrateExistingTasksToVectorDB.js migrate");
    
  } catch (error) {
    console.error("❌ Preview failed:", error.message);
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes("preview")) {
    previewMigration().then(() => process.exit(0)).catch(() => process.exit(1));
  } else {
    migrateExistingTasks().then(() => process.exit(0)).catch(() => process.exit(1));
  }
}

module.exports = { migrateExistingTasks, previewMigration };
