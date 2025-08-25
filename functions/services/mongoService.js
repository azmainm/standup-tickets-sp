/**
 * MongoDB Service for storing processed standup tasks
 * 
 * This service handles:
 * 1. Connection to MongoDB
 * 2. Storing task data in the 'sptasks' collection
 * 3. Retrieving task data for analysis
 */

const { MongoClient } = require('mongodb');
const {logger} = require("firebase-functions");

// Load environment variables
require('dotenv').config();

// MongoDB configuration
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = 'standuptickets';
const COLLECTION_NAME = 'sptasks';

let client = null;
let db = null;

/**
 * Initialize MongoDB connection
 * @returns {Promise<void>}
 */
async function initializeMongoDB() {
  try {
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    if (!client) {
      client = new MongoClient(MONGODB_URI);
      await client.connect();
      db = client.db(DATABASE_NAME);
      
      logger.info('MongoDB connection established', {
        database: DATABASE_NAME,
        collection: COLLECTION_NAME,
      });
    }
  } catch (error) {
    logger.error('Failed to initialize MongoDB connection', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Store processed tasks in MongoDB
 * @param {Object} tasksData - Structured task data organized by participant
 * @param {Object} metadata - Additional metadata about the processing
 * @returns {Promise<Object>} MongoDB insert result with document ID
 */
async function storeTasks(tasksData, metadata = {}) {
  try {
    await initializeMongoDB();
    
    const collection = db.collection(COLLECTION_NAME);
    
    // Create document structure according to requirements
    const document = {
      timestamp: new Date(),
      ...tasksData, // This will include participant data like: Azmain: {Coding: [...], Non-Coding: [...]}
    };
    
    const result = await collection.insertOne(document);
    
    logger.info('Tasks stored successfully in MongoDB', {
      documentId: result.insertedId,
      participantCount: Object.keys(tasksData).length,
      timestamp: document.timestamp,
    });
    
    return {
      success: true,
      documentId: result.insertedId,
      timestamp: document.timestamp,
      participantCount: Object.keys(tasksData).length,
    };
    
  } catch (error) {
    logger.error('Error storing tasks in MongoDB', {
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`MongoDB storage failed: ${error.message}`);
  }
}

/**
 * Retrieve tasks from MongoDB
 * @param {Object} query - MongoDB query object (optional)
 * @param {Object} options - Query options like limit, sort (optional)
 * @returns {Promise<Array>} Array of task documents
 */
async function getTasks(query = {}, options = {}) {
  try {
    await initializeMongoDB();
    
    const collection = db.collection(COLLECTION_NAME);
    
    // Default options
    const queryOptions = {
      sort: { timestamp: -1 }, // Most recent first
      limit: 50, // Limit to 50 documents by default
      ...options
    };
    
    const tasks = await collection.find(query, queryOptions).toArray();
    
    logger.info('Tasks retrieved from MongoDB', {
      documentCount: tasks.length,
      query: JSON.stringify(query),
    });
    
    return tasks;
    
  } catch (error) {
    logger.error('Error retrieving tasks from MongoDB', {
      error: error.message,
      stack: error.stack,
      query: JSON.stringify(query),
    });
    throw new Error(`MongoDB retrieval failed: ${error.message}`);
  }
}

/**
 * Get tasks for a specific date range
 * @param {Date} startDate - Start date for the range
 * @param {Date} endDate - End date for the range
 * @returns {Promise<Array>} Array of task documents within the date range
 */
async function getTasksByDateRange(startDate, endDate) {
  const query = {
    timestamp: {
      $gte: startDate,
      $lte: endDate
    }
  };
  
  return await getTasks(query);
}

/**
 * Get the most recent task document
 * @returns {Promise<Object|null>} Most recent task document or null if none found
 */
async function getLatestTasks() {
  const tasks = await getTasks({}, { limit: 1 });
  return tasks.length > 0 ? tasks[0] : null;
}

/**
 * Get tasks for a specific participant across all meetings
 * @param {string} participantName - Name of the participant
 * @param {number} limit - Maximum number of documents to return
 * @returns {Promise<Array>} Array of documents containing tasks for the participant
 */
async function getTasksByParticipant(participantName, limit = 10) {
  const query = {};
  query[participantName] = { $exists: true };
  
  return await getTasks(query, { limit });
}

/**
 * Test MongoDB connection
 * @returns {Promise<boolean>} True if connection successful
 */
async function testMongoConnection() {
  try {
    await initializeMongoDB();
    
    // Test with a simple ping
    await db.admin().ping();
    
    logger.info('MongoDB connection test successful');
    return true;
    
  } catch (error) {
    logger.error('MongoDB connection test failed', {
      error: error.message,
    });
    return false;
  }
}

/**
 * Get collection statistics
 * @returns {Promise<Object>} Collection statistics including document count
 */
async function getCollectionStats() {
  try {
    await initializeMongoDB();
    
    const collection = db.collection(COLLECTION_NAME);
    const documentCount = await collection.countDocuments();
    
    return {
      documentCount,
      collectionName: COLLECTION_NAME,
    };
    
  } catch (error) {
    logger.error('Error getting collection stats', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Close MongoDB connection
 * @returns {Promise<void>}
 */
async function closeMongoDB() {
  try {
    if (client) {
      await client.close();
      client = null;
      db = null;
      logger.info('MongoDB connection closed');
    }
  } catch (error) {
    logger.error('Error closing MongoDB connection', {
      error: error.message,
    });
  }
}

module.exports = {
  initializeMongoDB,
  storeTasks,
  getTasks,
  getTasksByDateRange,
  getLatestTasks,
  getTasksByParticipant,
  testMongoConnection,
  getCollectionStats,
  closeMongoDB,
};
