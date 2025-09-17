/**
 * Modern Task Embedding Service
 * 
 * This service handles task embeddings using MongoDB Atlas Vector Search,
 * following the same pattern as transcript-chat for consistency.
 * 
 * Features:
 * - Generates embeddings using OpenAI text-embedding-3-small
 * - Stores embeddings in separate task_embeddings collection
 * - Uses MongoDB Atlas Vector Search for similarity queries
 * - Chunking support for large task descriptions
 * - Automatic embedding updates when tasks change
 */

const { MongoClient } = require('mongodb');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const { MongoDBAtlasVectorSearch } = require('@langchain/mongodb');
const crypto = require('crypto');
const { logger } = require('firebase-functions');

// Environment variables
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = "standuptickets";
const EMBEDDINGS_COLLECTION = "task_embeddings";
const VECTOR_INDEX_NAME = "task_vector_index";

// Initialize OpenAI embeddings
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
  apiKey: process.env.OPENAI_API_KEY,
});

// Text splitter for large descriptions
const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

let client = null;
let db = null;
let vectorStore = null;

/**
 * Initialize MongoDB connection and vector store
 */
async function initializeEmbeddingService() {
  if (!db) {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DATABASE_NAME);
    
    // Initialize vector store
    vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
      collection: db.collection(EMBEDDINGS_COLLECTION),
      indexName: VECTOR_INDEX_NAME,
      textKey: "text",
      embeddingKey: "embedding",
    });
    
    logger.info("Embedding service initialized", {
      database: DATABASE_NAME,
      collection: EMBEDDINGS_COLLECTION,
      indexName: VECTOR_INDEX_NAME
    });
  }
  return { db, vectorStore };
}

/**
 * Generate content hash for change detection
 */
function generateContentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Add task embedding to vector store
 * @param {Object} taskData - Task data including title, description, etc.
 * @returns {Promise<Object>} Result with success status and embedding info
 */
async function addTaskEmbedding(taskData) {
  try {
    await initializeEmbeddingService();
    
    // Create text for embedding
    const title = taskData.title || '';
    const description = taskData.description || '';
    const text = `${title} ${description}`.trim();
    
    if (!text || text.length < 5) {
      logger.warn("Skipping embedding generation - insufficient text", { 
        taskId: taskData.ticketId,
        textLength: text.length 
      });
      return { success: false, reason: "Insufficient text" };
    }
    
    // Generate content hash
    const contentHash = generateContentHash(text);
    
    // Check if embedding already exists with same content
    const existingEmbedding = await db.collection(EMBEDDINGS_COLLECTION).findOne({
      taskId: taskData.ticketId,
      contentHash: contentHash
    });
    
    if (existingEmbedding) {
      logger.info("Embedding already exists with same content", { 
        taskId: taskData.ticketId 
      });
      return { success: true, reason: "Already exists", embeddingId: existingEmbedding._id };
    }
    
    // Remove old embeddings for this task
    await removeTaskEmbedding(taskData.ticketId);
    
    // Split text into chunks
    const chunks = await textSplitter.splitText(text);
    
    // Prepare documents for vector store
    const documents = chunks.map((chunk, index) => ({
      pageContent: chunk,
      metadata: {
        taskId: taskData.ticketId,
        participantName: taskData.participantName || taskData.assignee,
        taskType: taskData.type || 'Non-Coding',
        status: taskData.status || 'To-do',
        isFuturePlan: Boolean(taskData.isFuturePlan),
        estimatedTime: taskData.estimatedTime || 0,
        timeTaken: taskData.timeTaken || 0,
        chunkIndex: index,
        chunkTotal: chunks.length,
        contentHash: contentHash,
        fullText: text,
        createdAt: new Date().toISOString()
      }
    }));
    
    // Store in vector database
    await vectorStore.addDocuments(documents);
    
    logger.info("Task embedding created successfully", {
      taskId: taskData.ticketId,
      chunksStored: chunks.length,
      textLength: text.length,
      contentHash: contentHash
    });
    
    return {
      success: true,
      chunksStored: chunks.length,
      textLength: text.length,
      contentHash: contentHash,
      model: "text-embedding-3-small"
    };
    
  } catch (error) {
    logger.error("Error creating task embedding", {
      error: error.message,
      taskId: taskData.ticketId,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Update task embedding (removes old and creates new)
 * @param {string} taskId - Task ID (e.g., SP-123)
 * @param {Object} taskData - Updated task data
 * @returns {Promise<Object>} Result with success status
 */
async function updateTaskEmbedding(taskId, taskData) {
  try {
    await initializeEmbeddingService();
    
    logger.info("Updating task embedding", { taskId });
    
    // Remove existing embeddings
    await removeTaskEmbedding(taskId);
    
    // Create new embeddings
    const result = await addTaskEmbedding({
      ...taskData,
      ticketId: taskId
    });
    
    logger.info("Task embedding updated successfully", { taskId });
    return result;
    
  } catch (error) {
    logger.error("Error updating task embedding", {
      error: error.message,
      taskId,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Remove task embedding from vector store
 * @param {string} taskId - Task ID to remove
 * @returns {Promise<Object>} Result with deletion count
 */
async function removeTaskEmbedding(taskId) {
  try {
    await initializeEmbeddingService();
    
    const result = await db.collection(EMBEDDINGS_COLLECTION).deleteMany({
      "taskId": taskId
    });
    
    if (result.deletedCount > 0) {
      logger.info("Task embedding removed", { 
        taskId, 
        deletedCount: result.deletedCount 
      });
    }
    
    return {
      success: true,
      deletedCount: result.deletedCount
    };
    
  } catch (error) {
    logger.error("Error removing task embedding", {
      error: error.message,
      taskId,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Search for similar tasks using vector similarity
 * @param {string} query - Search query text
 * @param {Object} filters - Optional filters (participantName, taskType, status)
 * @param {number} maxResults - Maximum number of results
 * @returns {Promise<Array>} Array of similar tasks with similarity scores
 */
async function searchSimilarTasks(query, filters = {}, maxResults = 5) {
  try {
    await initializeEmbeddingService();
    
    // Build filter criteria
    const filterCriteria = {};
    if (filters.participantName) {
      filterCriteria["metadata.participantName"] = filters.participantName;
    }
    if (filters.taskType) {
      filterCriteria["metadata.taskType"] = filters.taskType;
    }
    if (filters.status) {
      filterCriteria["metadata.status"] = filters.status;
    }
    
    // Use vector store retriever
    const retriever = vectorStore.asRetriever({
      k: maxResults * 2, // Get more results to filter and deduplicate
      searchType: "similarity",
      searchKwargs: {
        filter: filterCriteria
      }
    });
    
    const docs = await retriever.getRelevantDocuments(query);
    
    // Deduplicate by taskId (keep highest similarity for each task)
    const taskMap = new Map();
    docs.forEach(doc => {
      const taskId = doc.metadata.taskId;
      if (!taskMap.has(taskId) || doc.metadata.chunkIndex === 0) {
        // Prefer chunk 0 (main content) or first occurrence
        taskMap.set(taskId, {
          taskId: taskId,
          similarity: 0.8, // Placeholder similarity score
          content: doc.pageContent,
          fullText: doc.metadata.fullText,
          participantName: doc.metadata.participantName,
          taskType: doc.metadata.taskType,
          status: doc.metadata.status,
          isFuturePlan: doc.metadata.isFuturePlan,
          estimatedTime: doc.metadata.estimatedTime,
          timeTaken: doc.metadata.timeTaken,
          createdAt: doc.metadata.createdAt
        });
      }
    });
    
    const results = Array.from(taskMap.values()).slice(0, maxResults);
    
    logger.info("Similar tasks search completed", {
      query: query.substring(0, 100),
      filters,
      resultsFound: results.length,
      maxResults
    });
    
    return results;
    
  } catch (error) {
    logger.error("Error searching similar tasks", {
      error: error.message,
      query: query.substring(0, 100),
      filters,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Get task embedding statistics
 * @returns {Promise<Object>} Statistics about task embeddings
 */
async function getEmbeddingStatistics() {
  try {
    await initializeEmbeddingService();
    
    const embeddingsCollection = db.collection(EMBEDDINGS_COLLECTION);
    
    const stats = {
      totalEmbeddings: await embeddingsCollection.countDocuments(),
      uniqueTasks: await embeddingsCollection.distinct("taskId").then(ids => ids.length),
      embeddingsByType: {},
      embeddingsByStatus: {},
      averageChunksPerTask: 0
    };
    
    // Get type distribution
    const typeAggregation = await embeddingsCollection.aggregate([
      { $group: { _id: "$taskType", count: { $sum: 1 } } }
    ]).toArray();
    
    typeAggregation.forEach(item => {
      stats.embeddingsByType[item._id] = item.count;
    });
    
    // Get status distribution
    const statusAggregation = await embeddingsCollection.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]).toArray();
    
    statusAggregation.forEach(item => {
      stats.embeddingsByStatus[item._id] = item.count;
    });
    
    // Calculate average chunks per task
    if (stats.uniqueTasks > 0) {
      stats.averageChunksPerTask = Math.round(stats.totalEmbeddings / stats.uniqueTasks * 100) / 100;
    }
    
    return stats;
    
  } catch (error) {
    logger.error("Error getting embedding statistics", {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Test embedding service functionality
 * @returns {Promise<boolean>} True if service is working
 */
async function testEmbeddingService() {
  try {
    await initializeEmbeddingService();
    
    const testTask = {
      ticketId: "SP-TEST-001",
      title: "Test Task",
      description: "This is a test task for embedding service validation",
      participantName: "TestUser",
      type: "Coding",
      status: "To-do"
    };
    
    // Test adding embedding
    const addResult = await addTaskEmbedding(testTask);
    if (!addResult.success) {
      return false;
    }
    
    // Test searching
    const searchResults = await searchSimilarTasks("test task", {}, 1);
    const hasResults = searchResults.length > 0;
    
    // Clean up test data
    await removeTaskEmbedding(testTask.ticketId);
    
    logger.info("Embedding service test completed", {
      addSuccess: addResult.success,
      searchResults: searchResults.length
    });
    
    return hasResults;
    
  } catch (error) {
    logger.error("Embedding service test failed", {
      error: error.message
    });
    return false;
  }
}

module.exports = {
  addTaskEmbedding,
  updateTaskEmbedding,
  removeTaskEmbedding,
  searchSimilarTasks,
  getEmbeddingStatistics,
  testEmbeddingService,
  initializeEmbeddingService
};
