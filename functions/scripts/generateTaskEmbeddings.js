/**
 * Script to Generate Task Embeddings for MongoDB Atlas Vector Search
 * 
 * This script processes all existing tasks in the sptasks collection and creates
 * embeddings in a new task_embeddings collection for MongoDB Atlas Vector Search.
 * 
 * Prerequisites:
 * 1. MongoDB Atlas cluster (not just MongoDB)
 * 2. Vector search index created on task_embeddings collection
 * 3. OpenAI API key configured
 * 4. removeEmbeddingsFromTasks.js should be run first
 * 
 * Usage: node scripts/generateTaskEmbeddings.js
 */

const { MongoClient } = require('mongodb');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const { MongoDBAtlasVectorSearch } = require('@langchain/mongodb');
require('dotenv').config();

// MongoDB configuration
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = "standuptickets";
const TASKS_COLLECTION = "sptasks";
const EMBEDDINGS_COLLECTION = "task_embeddings";
const VECTOR_INDEX_NAME = "task_vector_index";

// Initialize OpenAI embeddings
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
  apiKey: process.env.OPENAI_API_KEY,
});

// Text splitter for large task descriptions
const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 2000,
  chunkOverlap: 200,
});

async function generateTaskEmbeddings() {
  console.log("🚀 Starting task embedding generation for MongoDB Atlas Vector Search...");
  console.log("=" .repeat(70));
  
  // Validate environment
  if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI environment variable is not set");
    process.exit(1);
  }
  
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY environment variable is not set");
    process.exit(1);
  }

  let client;
  try {
    // Connect to MongoDB
    console.log("🔌 Connecting to MongoDB Atlas...");
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas successfully");

    const db = client.db(DATABASE_NAME);
    const tasksCollection = db.collection(TASKS_COLLECTION);
    const embeddingsCollection = db.collection(EMBEDDINGS_COLLECTION);

    // Initialize vector store
    console.log("🔧 Initializing MongoDB Atlas Vector Search...");
    const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
      collection: embeddingsCollection,
      indexName: VECTOR_INDEX_NAME,
      textKey: "text",
      embeddingKey: "embedding",
    });
    console.log("✅ Vector store initialized");

    // Check existing embeddings
    const existingEmbeddings = await embeddingsCollection.countDocuments();
    if (existingEmbeddings > 0) {
      console.log(`⚠️  Found ${existingEmbeddings} existing embeddings. Clearing collection...`);
      await embeddingsCollection.deleteMany({});
      console.log("✅ Cleared existing embeddings");
    }

    // Get all tasks
    console.log("📋 Fetching all tasks from sptasks collection...");
    const tasks = await tasksCollection.find({}).toArray();
    console.log(`📊 Found ${tasks.length} total task documents`);

    if (tasks.length === 0) {
      console.log("ℹ️  No tasks found. Nothing to process.");
      return;
    }

    // Process each task document
    let processedTasks = 0;
    let skippedTasks = 0;
    let totalEmbeddings = 0;
    let errors = 0;

    console.log("\n🔄 Processing tasks...");
    
    for (const taskDoc of tasks) {
      try {
        console.log(`\n📝 Processing document: ${taskDoc._id}`);
        
        // Extract all tasks from the document
        const participants = Object.keys(taskDoc).filter(key => 
          typeof taskDoc[key] === 'object' && 
          taskDoc[key] !== null &&
          (taskDoc[key].Coding || taskDoc[key]['Non-Coding']) &&
          !['_id', 'metadata', 'timestamp', 'date'].includes(key)
        );

        console.log(`   👥 Found participants: ${participants.join(', ')}`);

        // Process each participant's tasks
        for (const participantName of participants) {
          const participantTasks = taskDoc[participantName];
          
          // Process Coding tasks
          if (participantTasks.Coding && Array.isArray(participantTasks.Coding)) {
            for (let i = 0; i < participantTasks.Coding.length; i++) {
              const task = participantTasks.Coding[i];
              await processTask(task, {
                taskDocId: taskDoc._id,
                participantName,
                taskType: 'Coding',
                taskIndex: i,
                documentDate: taskDoc.date || taskDoc.timestamp || new Date(),
                vectorStore
              });
              totalEmbeddings++;
            }
          }

          // Process Non-Coding tasks
          if (participantTasks['Non-Coding'] && Array.isArray(participantTasks['Non-Coding'])) {
            for (let i = 0; i < participantTasks['Non-Coding'].length; i++) {
              const task = participantTasks['Non-Coding'][i];
              await processTask(task, {
                taskDocId: taskDoc._id,
                participantName,
                taskType: 'Non-Coding',
                taskIndex: i,
                documentDate: taskDoc.date || taskDoc.timestamp || new Date(),
                vectorStore
              });
              totalEmbeddings++;
            }
          }
        }

        processedTasks++;
        console.log(`   ✅ Processed document ${taskDoc._id} successfully`);

      } catch (error) {
        console.error(`   ❌ Error processing document ${taskDoc._id}:`, error.message);
        errors++;
      }
    }

    // Final statistics
    console.log("\n" + "=".repeat(70));
    console.log("📊 Processing completed!");
    console.log(`✅ Successfully processed documents: ${processedTasks}`);
    console.log(`⚠️  Errors encountered: ${errors}`);
    console.log(`📈 Total embeddings created: ${totalEmbeddings}`);

    // Verify embeddings collection
    const finalEmbeddingCount = await embeddingsCollection.countDocuments();
    console.log(`🔍 Verification: ${finalEmbeddingCount} embeddings in collection`);

    // Show sample embedding
    const sampleEmbedding = await embeddingsCollection.findOne({});
    if (sampleEmbedding) {
      console.log("\n📋 Sample embedding document:");
      console.log({
        text: sampleEmbedding.text?.substring(0, 100) + "...",
        taskId: sampleEmbedding.taskId,
        participantName: sampleEmbedding.participantName,
        taskType: sampleEmbedding.taskType,
        embeddingDimensions: sampleEmbedding.embedding?.length,
        createdAt: sampleEmbedding.createdAt
      });
    }

    console.log("\n🎉 Task embedding generation completed successfully!");
    console.log("\nNext steps:");
    console.log("1. Verify the vector search index is working in MongoDB Atlas");
    console.log("2. Update services to use the new vector search approach");
    console.log("3. Test vector similarity search functionality");

  } catch (error) {
    console.error("❌ Error during embedding generation:", error.message);
    console.error("Stack trace:", error.stack);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log("\n🔌 MongoDB connection closed");
    }
  }
}

/**
 * Process individual task and create embedding
 */
async function processTask(task, context) {
  try {
    // Extract task text
    const title = task.title || task.description?.substring(0, 50) || '';
    const description = task.description || '';
    const text = `${title} ${description}`.trim();

    if (!text || text.length < 5) {
      console.log(`     ⚠️  Skipping task with insufficient text: "${text}"`);
      return;
    }

    // Generate unique task ID if not present
    const taskId = task.ticketId || `${context.taskDocId}-${context.participantName}-${context.taskType}-${context.taskIndex}`;

    // Create metadata
    const metadata = {
      taskId: taskId,
      participantName: context.participantName,
      taskType: context.taskType,
      status: task.status || 'To-do',
      isFuturePlan: Boolean(task.isFuturePlan),
      estimatedTime: task.estimatedTime || 0,
      timeTaken: task.timeTaken || 0,
      createdAt: new Date().toISOString(),
      sourceDocumentId: context.taskDocId.toString(),
      documentDate: context.documentDate
    };

    // Split text if too large
    const chunks = await textSplitter.splitText(text);
    
    // Create documents for vector store
    const documents = chunks.map((chunk, index) => ({
      pageContent: chunk,
      metadata: {
        ...metadata,
        chunkIndex: index,
        chunkTotal: chunks.length,
        fullText: text
      }
    }));

    // Store in vector database
    await context.vectorStore.addDocuments(documents);
    
    console.log(`     ✅ Created ${chunks.length} embedding(s) for task: ${taskId}`);
    
    // Add small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 100));

  } catch (error) {
    console.error(`     ❌ Error processing task:`, error.message);
    throw error;
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

// Run the script
if (require.main === module) {
  generateTaskEmbeddings().catch(error => {
    console.error("Script failed:", error);
    process.exit(1);
  });
}

module.exports = { generateTaskEmbeddings };
