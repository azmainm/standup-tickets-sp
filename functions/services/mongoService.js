/**
 * MongoDB Service for storing processed standup tasks
 * 
 * This service handles:
 * 1. Connection to MongoDB
 * 2. Storing task data in the 'sptasks' collection
 * 3. Retrieving task data for analysis
 */

const { MongoClient } = require("mongodb");
const {logger} = require("firebase-functions");

// Load environment variables
require("dotenv").config();

// MongoDB configuration
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = "standuptickets";
const COLLECTION_NAME = "sptasks";
const TRANSCRIPTS_COLLECTION = "transcripts";
const COUNTERS_COLLECTION = "counters";

let client = null;
let db = null;

/**
 * Initialize MongoDB connection
 * @returns {Promise<void>}
 */
async function initializeMongoDB() {
  try {
    if (!MONGODB_URI) {
      throw new Error("MONGODB_URI environment variable is not set");
    }

    if (!client) {
      client = new MongoClient(MONGODB_URI);
      await client.connect();
      db = client.db(DATABASE_NAME);
      
      logger.info("MongoDB connection established", {
        database: DATABASE_NAME,
        collection: COLLECTION_NAME,
      });
    }
  } catch (error) {
    logger.error("Failed to initialize MongoDB connection", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Store processed tasks in MongoDB with unique ticket IDs and titles for each task
 * @param {Object} tasksData - Structured task data organized by participant
 * @param {Object} metadata - Additional metadata about the processing
 * @returns {Promise<Object>} MongoDB insert result with document ID and ticket IDs
 */
async function storeTasks(tasksData, metadata = {}) {
  try {
    await initializeMongoDB();
    
    const collection = db.collection(COLLECTION_NAME);
    
    // Ensure ticket counter is initialized
    await initializeTicketCounter();
    
    // Import title generation function
    const { generateTaskTitlesInBatch } = require("./openaiService");
    
    // Process tasks and assign ticket IDs and titles
    const processedTasksData = {};
    const assignedTicketIds = [];
    let totalTasksWithIds = 0;
    
    for (const [participantName, participantTasks] of Object.entries(tasksData)) {
      processedTasksData[participantName] = {
        "Coding": [],
        "Non-Coding": []
      };
      
      // Process Coding tasks
      if (participantTasks.Coding && Array.isArray(participantTasks.Coding)) {
        // Generate titles for all coding tasks in batch
        const tasksWithTitles = await generateTaskTitlesInBatch(participantTasks.Coding);
        
        for (const task of tasksWithTitles) {
          const ticketId = await getNextTicketId();
          const taskWithId = {
            ticketId,
            title: task.title,
            description: task.description,
            status: task.status || "To-do",
            estimatedTime: task.estimatedTime || 0,
            timeTaken: task.timeTaken || 0,
            isFuturePlan: task.isFuturePlan || false
          };
          
          processedTasksData[participantName]["Coding"].push(taskWithId);
          assignedTicketIds.push(ticketId);
          totalTasksWithIds++;
        }
      }
      
      // Process Non-Coding tasks
      if (participantTasks["Non-Coding"] && Array.isArray(participantTasks["Non-Coding"])) {
        // Generate titles for all non-coding tasks in batch
        const tasksWithTitles = await generateTaskTitlesInBatch(participantTasks["Non-Coding"]);
        
        for (const task of tasksWithTitles) {
          const ticketId = await getNextTicketId();
          const taskWithId = {
            ticketId,
            title: task.title,
            description: task.description,
            status: task.status || "To-do",
            estimatedTime: task.estimatedTime || 0,
            timeTaken: task.timeTaken || 0,
            isFuturePlan: task.isFuturePlan || false
          };
          
          processedTasksData[participantName]["Non-Coding"].push(taskWithId);
          assignedTicketIds.push(ticketId);
          totalTasksWithIds++;
        }
      }
    }
    
    // Create document structure according to requirements
    const document = {
      timestamp: new Date(),
      ...processedTasksData, // This will include participant data with ticket IDs
    };
    
    const result = await collection.insertOne(document);
    
    logger.info("Tasks stored successfully in MongoDB with ticket IDs", {
      documentId: result.insertedId,
      participantCount: Object.keys(tasksData).length,
      totalTasksWithIds,
      assignedTicketIds,
      timestamp: document.timestamp,
    });
    
    return {
      success: true,
      documentId: result.insertedId,
      timestamp: document.timestamp,
      participantCount: Object.keys(tasksData).length,
      totalTasksWithIds,
      assignedTicketIds,
    };
    
  } catch (error) {
    logger.error("Error storing tasks in MongoDB", {
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`MongoDB storage failed: ${error.message}`);
  }
}

/**
 * Store transcript data in MongoDB
 * @param {Array} transcriptData - Raw transcript array
 * @param {Object} metadata - Transcript metadata (meetingId, fetchedAt, etc.)
 * @returns {Promise<Object>} MongoDB insert result with document ID
 */
async function storeTranscript(transcriptData, metadata = {}) {
  try {
    await initializeMongoDB();
    
    const collection = db.collection(TRANSCRIPTS_COLLECTION);
    
    // Get the date from metadata or use current date
    const transcriptDate = metadata.fetchedAt ? new Date(metadata.fetchedAt) : new Date();
    const dateString = transcriptDate.toISOString().split("T")[0]; // YYYY-MM-DD format
    
    // Compress transcript data for storage efficiency
    // Convert to compact JSON string to save space
    const compressedTranscript = JSON.stringify(transcriptData);
    
    // Create document structure
    const document = {
      timestamp: new Date(),
      date: dateString, // The date this transcript is for (YYYY-MM-DD)
      transcript_data: compressedTranscript, // Stored as compressed JSON string
      entry_count: transcriptData.length,
      meeting_id: metadata.meetingId || null,
      transcript_id: metadata.transcriptId || null,
    };
    
    const result = await collection.insertOne(document);
    
    logger.info("Transcript stored successfully in MongoDB", {
      documentId: result.insertedId,
      date: dateString,
      entryCount: transcriptData.length,
      dataSize: compressedTranscript.length,
    });
    
    return {
      success: true,
      documentId: result.insertedId,
      date: dateString,
      timestamp: document.timestamp,
      entryCount: transcriptData.length,
      dataSize: compressedTranscript.length,
    };
    
  } catch (error) {
    logger.error("Error storing transcript in MongoDB", {
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`MongoDB transcript storage failed: ${error.message}`);
  }
}

/**
 * Retrieve transcripts from MongoDB
 * @param {Object} query - MongoDB query object (optional)
 * @param {Object} options - Query options like limit, sort (optional)
 * @returns {Promise<Array>} Array of transcript documents
 */
async function getTranscripts(query = {}, options = {}) {
  try {
    await initializeMongoDB();
    
    const collection = db.collection(TRANSCRIPTS_COLLECTION);
    
    // Default options
    const queryOptions = {
      sort: { timestamp: -1 }, // Most recent first
      limit: 10, // Limit to 10 transcripts by default
      ...options
    };
    
    const transcripts = await collection.find(query, queryOptions).toArray();
    
    // Parse transcript_data back to array for each document
    const processedTranscripts = transcripts.map(doc => ({
      ...doc,
      transcript_data: JSON.parse(doc.transcript_data)
    }));
    
    logger.info("Transcripts retrieved from MongoDB", {
      documentCount: transcripts.length,
      query: JSON.stringify(query),
    });
    
    return processedTranscripts;
    
  } catch (error) {
    logger.error("Error retrieving transcripts from MongoDB", {
      error: error.message,
      stack: error.stack,
      query: JSON.stringify(query),
    });
    throw new Error(`MongoDB transcript retrieval failed: ${error.message}`);
  }
}

/**
 * Get transcript by date
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Promise<Object|null>} Transcript document or null if not found
 */
async function getTranscriptByDate(date) {
  const transcripts = await getTranscripts({ date }, { limit: 1 });
  return transcripts.length > 0 ? transcripts[0] : null;
}

/**
 * Get the most recent transcript
 * @returns {Promise<Object|null>} Most recent transcript document or null if none found
 */
async function getLatestTranscript() {
  const transcripts = await getTranscripts({}, { limit: 1 });
  return transcripts.length > 0 ? transcripts[0] : null;
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
    
    logger.info("Tasks retrieved from MongoDB", {
      documentCount: tasks.length,
      query: JSON.stringify(query),
    });
    
    return tasks;
    
  } catch (error) {
    logger.error("Error retrieving tasks from MongoDB", {
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
 * Get all active tasks (to-do and in-progress) from the database in a simplified format
 * @returns {Promise<Array>} Array of active tasks with participant, description, status, type, etc.
 */
async function getActiveTasks() {
  try {
    await initializeMongoDB();
    
    const collection = db.collection(COLLECTION_NAME);
    
    // Get all documents, sorted by most recent first
    const documents = await collection.find({}, { sort: { timestamp: -1 } }).toArray();
    
    const activeTasks = [];
    
    // Extract active tasks from all documents
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
            
            if (taskObj.status === "To-do" || taskObj.status === "In-progress" || taskObj.status === "In Progress") {
              activeTasks.push({
                participantName,
                ticketId: taskObj.ticketId || null, // Include ticket ID if available
                title: taskObj.title || null, // Include title if available
                description: taskObj.description,
                status: taskObj.status,
                type: "Coding",
                estimatedTime: taskObj.estimatedTime || 0,
                timeTaken: taskObj.timeTaken || 0,
                documentId: docId,
                timestamp,
                taskIndex: i,
                taskPath: `${participantName}.Coding.${i}`
              });
            }
          }
        }
        
        // Process non-coding tasks
        if (participantData["Non-Coding"] && Array.isArray(participantData["Non-Coding"])) {
          for (let i = 0; i < participantData["Non-Coding"].length; i++) {
            const task = participantData["Non-Coding"][i];
            const taskObj = typeof task === "string" ? { description: task, status: "To-do" } : task;
            
            if (taskObj.status === "To-do" || taskObj.status === "In-progress" || taskObj.status === "In Progress") {
              activeTasks.push({
                participantName,
                ticketId: taskObj.ticketId || null, // Include ticket ID if available
                title: taskObj.title || null, // Include title if available
                description: taskObj.description,
                status: taskObj.status,
                type: "Non-Coding",
                estimatedTime: taskObj.estimatedTime || 0,
                timeTaken: taskObj.timeTaken || 0,
                documentId: docId,
                timestamp,
                taskIndex: i,
                taskPath: `${participantName}.Non-Coding.${i}`
              });
            }
          }
        }
      }
    }
    
    logger.info("Active tasks retrieved from MongoDB", {
      totalActiveTasks: activeTasks.length,
      documentsProcessed: documents.length,
    });
    
    return activeTasks;
    
  } catch (error) {
    logger.error("Error retrieving active tasks from MongoDB", {
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`MongoDB active tasks retrieval failed: ${error.message}`);
  }
}

/**
 * Get active tasks for a specific participant
 * @param {string} participantName - Name of the participant
 * @returns {Promise<Array>} Array of active tasks for the participant
 */
async function getActiveTasksByParticipant(participantName) {
  const allActiveTasks = await getActiveTasks();
  return allActiveTasks.filter(task => task.participantName === participantName);
}

/**
 * Update a specific task in the database
 * @param {string} documentId - MongoDB document ID
 * @param {string} taskPath - Path to the task (e.g., "Azmain.Coding.0")
 * @param {Object} updateData - Data to update (description, status, estimatedTime, timeTaken)
 * @returns {Promise<Object>} Update result
 */
async function updateTask(documentId, taskPath, updateData) {
  try {
    await initializeMongoDB();
    
    const collection = db.collection(COLLECTION_NAME);
    
    // Prepare update object
    const updateObj = {};
    
    if (updateData.description !== undefined) {
      updateObj[`${taskPath}.description`] = updateData.description;
    }
    if (updateData.status !== undefined) {
      updateObj[`${taskPath}.status`] = updateData.status;
    }
    if (updateData.estimatedTime !== undefined) {
      updateObj[`${taskPath}.estimatedTime`] = updateData.estimatedTime;
    }
    if (updateData.timeTaken !== undefined) {
      updateObj[`${taskPath}.timeTaken`] = updateData.timeTaken;
    }
    
    const result = await collection.updateOne(
      { _id: documentId },
      { $set: updateObj }
    );
    
    logger.info("Task updated in MongoDB", {
      documentId,
      taskPath,
      updateData,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
    
    return {
      success: result.modifiedCount > 0,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
    
  } catch (error) {
    logger.error("Error updating task in MongoDB", {
      documentId,
      taskPath,
      updateData,
      error: error.message,
    });
    throw new Error(`MongoDB task update failed: ${error.message}`);
  }
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
    
    logger.info("MongoDB connection test successful");
    return true;
    
  } catch (error) {
    logger.error("MongoDB connection test failed", {
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
    logger.error("Error getting collection stats", {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get the next ticket ID (SP-{number}) with atomic increment
 * @returns {Promise<string>} Next ticket ID in format SP-{number}
 */
async function getNextTicketId() {
  try {
    await initializeMongoDB();
    
    const countersCollection = db.collection(COUNTERS_COLLECTION);
    
    // Use atomic findOneAndUpdate to ensure unique IDs even in concurrent environments
    const result = await countersCollection.findOneAndUpdate(
      { _id: "ticket_counter" },
      { $inc: { count: 1 } },
      { 
        upsert: true, // Create the document if it doesn't exist
        returnDocument: "after" // Return the updated document
      }
    );
    
    const ticketNumber = result.count;
    const ticketId = `SP-${ticketNumber}`;
    
    logger.info("Generated new ticket ID", {
      ticketId,
      ticketNumber,
    });
    
    return ticketId;
    
  } catch (error) {
    logger.error("Error generating ticket ID", {
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`Ticket ID generation failed: ${error.message}`);
  }
}

/**
 * Initialize the ticket counter to start from 1 (since database was cleared)
 * This function should only be called once during setup
 * @param {number} startingNumber - The number to start counting from (default: 1)
 * @returns {Promise<boolean>} True if successfully initialized or already exists
 */
async function initializeTicketCounter(startingNumber = 1) {
  try {
    await initializeMongoDB();
    
    const countersCollection = db.collection(COUNTERS_COLLECTION);
    
    // Check if counter already exists
    const existingCounter = await countersCollection.findOne({ _id: "ticket_counter" });
    
    if (existingCounter) {
      logger.info("Ticket counter already exists", {
        currentCount: existingCounter.count,
      });
      return true;
    }
    
    // Initialize the counter
    await countersCollection.insertOne({
      _id: "ticket_counter",
      count: startingNumber - 1, // Set to startingNumber - 1 so next increment gives startingNumber
      createdAt: new Date(),
      description: "Auto-incrementing counter for SP ticket IDs"
    });
    
    logger.info("Ticket counter initialized", {
      startingNumber: startingNumber,
      nextTicketId: `SP-${startingNumber}`,
    });
    
    return true;
    
  } catch (error) {
    logger.error("Error initializing ticket counter", {
      error: error.message,
      startingNumber,
    });
    throw new Error(`Ticket counter initialization failed: ${error.message}`);
  }
}

/**
 * Get current ticket counter value without incrementing
 * @returns {Promise<number>} Current counter value
 */
async function getCurrentTicketCount() {
  try {
    await initializeMongoDB();
    
    const countersCollection = db.collection(COUNTERS_COLLECTION);
    
    const counter = await countersCollection.findOne({ _id: "ticket_counter" });
    
    if (!counter) {
      // Counter doesn't exist, initialize it
      await initializeTicketCounter();
      return 0; // Will be 1 after first increment
    }
    
    return counter.count;
    
  } catch (error) {
    logger.error("Error getting current ticket count", {
      error: error.message,
    });
    throw new Error(`Getting ticket count failed: ${error.message}`);
  }
}

/**
 * Reset ticket counter (for testing purposes only)
 * @param {number} newCount - New counter value
 * @returns {Promise<boolean>} True if successfully reset
 */
async function resetTicketCounter(newCount) {
  try {
    await initializeMongoDB();
    
    const countersCollection = db.collection(COUNTERS_COLLECTION);
    
    await countersCollection.updateOne(
      { _id: "ticket_counter" },
      { 
        $set: { 
          count: newCount,
          lastReset: new Date()
        }
      },
      { upsert: true }
    );
    
    logger.warn("Ticket counter reset", {
      newCount,
      nextTicketId: `SP-${newCount + 1}`,
    });
    
    return true;
    
  } catch (error) {
    logger.error("Error resetting ticket counter", {
      error: error.message,
      newCount,
    });
    throw new Error(`Ticket counter reset failed: ${error.message}`);
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
      logger.info("MongoDB connection closed");
    }
  } catch (error) {
    logger.error("Error closing MongoDB connection", {
      error: error.message,
    });
  }
}

module.exports = {
  initializeMongoDB,
  storeTasks,
  storeTranscript,
  getTasks,
  getTranscripts,
  getTranscriptByDate,
  getLatestTranscript,
  getTasksByDateRange,
  getLatestTasks,
  getTasksByParticipant,
  getActiveTasks,
  getActiveTasksByParticipant,
  updateTask,
  testMongoConnection,
  getCollectionStats,
  getNextTicketId,
  initializeTicketCounter,
  getCurrentTicketCount,
  resetTicketCounter,
  closeMongoDB,
};
