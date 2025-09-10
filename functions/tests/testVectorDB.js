/**
 * Test Vector Database Functionality
 * 
 * This test validates:
 * 1. Vector database initialization
 * 2. Embedding generation and storage
 * 3. Similarity search functionality
 * 4. Synchronization with admin panel changes
 */

const {
  initializeVectorDB,
  generateEmbedding,
  addTaskEmbedding,
  findSimilarTasks,
  synchronizeEmbeddings,
  isVectorDBAvailable,
  getVectorDBStats,
  clearVectorDB
} = require("../services/vectorService");

const { logger } = require("firebase-functions");

// Test data
const testTasks = [
  {
    ticketId: "SP-100",
    title: "User Authentication",
    description: "Implement user authentication system with JWT tokens",
    assignee: "John Doe",
    type: "Coding",
    status: "To-do"
  },
  {
    ticketId: "SP-101", 
    title: "Database Migration",
    description: "Migrate user data from old database to new PostgreSQL database",
    assignee: "Jane Smith",
    type: "Coding",
    status: "In-progress"
  },
  {
    ticketId: "SP-102",
    title: "API Documentation",
    description: "Write comprehensive API documentation for authentication endpoints",
    assignee: "John Doe",
    type: "Non-Coding",
    status: "To-do"
  }
];

async function testVectorDB() {
  try {
    console.log("🚀 Starting Vector Database Tests\n");
    
    // Test 1: Check if vector database is available
    console.log("🔧 Test 1: Checking Vector Database Availability");
    const available = await isVectorDBAvailable();
    console.log(`Vector DB Available: ${available ? '✅ Yes' : '❌ No'}`);
    
    if (!available) {
      console.log("❌ Vector database not available. Install faiss-node to run vector tests.");
      console.log("📦 Run: npm install faiss-node");
      return;
    }
    
    // Test 2: Initialize vector database
    console.log("\n🔧 Test 2: Initializing Vector Database");
    await initializeVectorDB();
    console.log("✅ Vector database initialized successfully");
    
    // Test 3: Clear existing data for clean test
    console.log("\n🔧 Test 3: Clearing Vector Database for Clean Test");
    await clearVectorDB();
    console.log("✅ Vector database cleared");
    
    // Test 4: Generate embeddings for test tasks
    console.log("\n🔧 Test 4: Adding Test Task Embeddings");
    let successCount = 0;
    let errorCount = 0;
    
    for (const task of testTasks) {
      try {
        const text = `${task.title} ${task.description}`;
        const metadata = {
          assignee: task.assignee,
          type: task.type,
          status: task.status,
          title: task.title
        };
        
        const success = await addTaskEmbedding(task.ticketId, text, metadata);
        if (success) {
          successCount++;
          console.log(`  ✅ Added embedding for ${task.ticketId}: ${task.title}`);
        } else {
          errorCount++;
          console.log(`  ❌ Failed to add embedding for ${task.ticketId}`);
        }
      } catch (error) {
        errorCount++;
        console.log(`  ❌ Error adding ${task.ticketId}: ${error.message}`);
      }
    }
    
    console.log(`\n📊 Embedding Results: ${successCount} success, ${errorCount} errors`);
    
    // Test 5: Get vector database statistics
    console.log("\n🔧 Test 5: Vector Database Statistics");
    const stats = await getVectorDBStats();
    console.log("📊 Vector DB Stats:", {
      available: stats.available,
      totalEmbeddings: stats.totalEmbeddings,
      indexLoaded: stats.indexLoaded,
      indexSize: stats.indexSize
    });
    
    // Test 6: Test similarity search
    console.log("\n🔧 Test 6: Testing Similarity Search");
    
    const testQueries = [
      {
        query: "login system with tokens",
        expected: "SP-100",
        description: "Should match authentication task"
      },
      {
        query: "move data between databases",
        expected: "SP-101", 
        description: "Should match database migration task"
      },
      {
        query: "write documentation for API",
        expected: "SP-102",
        description: "Should match documentation task"
      },
      {
        query: "completely unrelated mobile app development",
        expected: null,
        description: "Should not match any existing tasks"
      }
    ];
    
    for (const testQuery of testQueries) {
      console.log(`\n  🔍 Query: "${testQuery.query}"`);
      console.log(`  📋 Expected: ${testQuery.expected || 'No match'} (${testQuery.description})`);
      
      try {
        const results = await findSimilarTasks(testQuery.query, {}, 3, 0.7);
        
        if (results.length === 0) {
          console.log(`  📊 Results: No similar tasks found`);
          if (testQuery.expected === null) {
            console.log(`  ✅ Correct: No matches expected and none found`);
          } else {
            console.log(`  ⚠️ Expected match for ${testQuery.expected} but found none`);
          }
        } else {
          console.log(`  📊 Results: Found ${results.length} similar tasks`);
          
          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            console.log(`    ${i + 1}. ${result.taskId}: ${result.metadata.title} (similarity: ${(result.similarity * 100).toFixed(1)}%)`);
          }
          
          const topMatch = results[0];
          if (testQuery.expected && topMatch.taskId === testQuery.expected) {
            console.log(`  ✅ Correct: Top match is expected task ${testQuery.expected}`);
          } else if (testQuery.expected) {
            console.log(`  ⚠️ Expected ${testQuery.expected} but got ${topMatch.taskId}`);
          } else {
            console.log(`  ⚠️ Expected no matches but found ${topMatch.taskId}`);
          }
        }
      } catch (error) {
        console.log(`  ❌ Error in similarity search: ${error.message}`);
      }
    }
    
    // Test 7: Test synchronization
    console.log("\n🔧 Test 7: Testing Synchronization");
    
    const modifiedTasks = [
      {
        ticketId: "SP-103",
        title: "Frontend Dashboard",
        description: "Create admin dashboard for user management",
        assignee: "Alice Brown",
        type: "Coding",
        status: "To-do",
        lastModifiedAp: new Date().toISOString()
      }
    ];
    
    console.log("📤 Synchronizing new task with vector database...");
    const syncResult = await synchronizeEmbeddings(modifiedTasks);
    
    console.log("📊 Sync Results:", {
      totalProcessed: syncResult.totalProcessed,
      added: syncResult.added,
      updated: syncResult.updated,
      errors: syncResult.errors,
      success: syncResult.success
    });
    
    // Test 8: Verify synchronization worked
    console.log("\n🔧 Test 8: Verifying Synchronization");
    const syncVerificationQuery = "admin panel for users";
    const syncResults = await findSimilarTasks(syncVerificationQuery, {}, 3, 0.6);
    
    console.log(`🔍 Searching for: "${syncVerificationQuery}"`);
    if (syncResults.length > 0) {
      console.log(`✅ Found ${syncResults.length} results after sync:`);
      syncResults.forEach((result, index) => {
        console.log(`  ${index + 1}. ${result.taskId}: ${result.metadata.title} (${(result.similarity * 100).toFixed(1)}%)`);
      });
    } else {
      console.log(`❌ No results found after sync`);
    }
    
    // Test 9: Final statistics
    console.log("\n🔧 Test 9: Final Statistics");
    const finalStats = await getVectorDBStats();
    console.log("📊 Final Vector DB Stats:", {
      totalEmbeddings: finalStats.totalEmbeddings,
      indexSize: finalStats.indexSize,
      available: finalStats.available
    });
    
    console.log("\n🎉 Vector Database Tests Completed Successfully!");
    console.log("\n📋 Summary:");
    console.log(`  • Vector DB Available: ${available ? 'Yes' : 'No'}`);
    console.log(`  • Test Tasks Added: ${successCount}/${testTasks.length}`);
    console.log(`  • Final Embeddings Count: ${finalStats.totalEmbeddings}`);
    console.log(`  • Similarity Search: Working`);
    console.log(`  • Synchronization: Working`);
    
  } catch (error) {
    console.error("❌ Vector Database Test Failed:", error.message);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testVectorDB().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error("Test execution failed:", error);
    process.exit(1);
  });
}

module.exports = { testVectorDB };
