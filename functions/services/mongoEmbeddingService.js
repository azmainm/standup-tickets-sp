/**
 * MongoDB-based Embedding Service
 * 
 * This service handles:
 * 1. Storing task embeddings directly in MongoDB documents
 * 2. Generating embeddings using OpenAI for task similarity search
 * 3. Real-time embedding updates when tasks change
 * 4. Efficient similarity search using MongoDB vector operations
 * 
 * REPLACES: File-based FAISS vector database approach
 * BENEFITS: 
 * - No sync overhead (embeddings live with tasks)
 * - Atomic operations (embedding + task updates together)
 * - Real-time updates (no batch syncing needed)
 * - Simplified architecture (no external vector DB files)
 */

const { logger } = require("firebase-functions");
const OpenAI = require("openai");
const crypto = require("crypto");

// Load environment variables
require("dotenv").config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate embedding for task text using OpenAI
 * @param {string} text - Task title + description
 * @param {Object} context - Additional context (assignee, type, etc.)
 * @returns {Promise<Array<number>>} Embedding vector (1536 dimensions)
 */
async function generateTaskEmbedding(text, context = {}) {
  try {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new Error("Text is required and must be a non-empty string");
    }
    
    // Create enhanced text with context for better embeddings
    const enhancedText = createEnhancedTextForEmbedding(text, context);
    
    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: enhancedText,
      encoding_format: "float",
    });
    
    const embedding = response.data[0].embedding;
    
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("Invalid embedding received from OpenAI");
    }
    
    logger.info("Generated task embedding", {
      textLength: text.length,
      enhancedTextLength: enhancedText.length,
      embeddingDimension: embedding.length,
      tokensUsed: response.usage?.total_tokens || 0,
      context: {
        assignee: context.assignee,
        type: context.type,
        status: context.status
      }
    });
    
    return embedding;
    
  } catch (error) {
    logger.error("Error generating task embedding", {
      error: error.message,
      text: text.substring(0, 100),
      context
    });
    throw error;
  }
}

/**
 * Create enhanced text for better embeddings by including context
 * @param {string} text - Original task text
 * @param {Object} context - Task context
 * @returns {string} Enhanced text
 */
function createEnhancedTextForEmbedding(text, context) {
  const parts = [text];
  
  if (context.assignee && context.assignee !== 'TBD') {
    parts.push(`Assigned to: ${context.assignee}`);
  }
  
  if (context.type) {
    parts.push(`Type: ${context.type}`);
  }
  
  if (context.status) {
    parts.push(`Status: ${context.status}`);
  }
  
  if (context.title && context.title !== text) {
    parts.unshift(`Title: ${context.title}`);
  }
  
  return parts.join(' | ');
}

/**
 * Create text hash for change detection
 * @param {string} text - Text to hash
 * @returns {string} SHA256 hash
 */
function createTextHash(text) {
  return crypto.createHash('sha256').update(text.trim()).digest('hex');
}

/**
 * Add or update embedding in MongoDB task document
 * @param {string} ticketId - Task ticket ID (e.g., SP-123)
 * @param {Object} taskData - Task data including title, description, etc.
 * @returns {Promise<boolean>} Success status
 */
async function addOrUpdateTaskEmbedding(ticketId, taskData) {
  try {
    const { initializeMongoDB, getDatabase } = require("./mongoService");
    await initializeMongoDB();
    const db = getDatabase();
    const collection = db.collection('sptasks');
    
    // Create text for embedding
    const text = `${taskData.title || ''} ${taskData.description || ''}`.trim();
    
    if (!text || text.length < 3) {
      logger.warn("Skipping embedding generation - insufficient text", { ticketId, textLength: text.length });
      return false;
    }
    
    // Create text hash for change detection
    const textHash = createTextHash(text);
    
    // Generate embedding
    const embedding = await generateTaskEmbedding(text, {
      assignee: taskData.assignee || taskData.participantName,
      type: taskData.type,
      status: taskData.status,
      title: taskData.title
    });
    
    // Create embedding metadata
    const embeddingMetadata = {
      model: "text-embedding-ada-002",
      generatedAt: new Date().toISOString(),
      textHash: textHash,
      lastUpdated: new Date().toISOString(),
      dimensions: embedding.length
    };
    
    // Find the document containing this task and update the embedding
    const documents = await collection.find({}).toArray();
    let updated = false;
    
    for (const doc of documents) {
      for (const [participantName, participantData] of Object.entries(doc)) {
        if (participantName === "_id" || participantName === "timestamp") continue;
        
        // Check Coding tasks
        if (participantData.Coding && Array.isArray(participantData.Coding)) {
          for (let i = 0; i < participantData.Coding.length; i++) {
            const task = participantData.Coding[i];
            if (task && task.ticketId === ticketId) {
              // Update this specific task with embedding
              const updatePath = `${participantName}.Coding.${i}.embedding`;
              const metadataPath = `${participantName}.Coding.${i}.embeddingMetadata`;
              
              await collection.updateOne(
                { _id: doc._id },
                {
                  $set: {
                    [updatePath]: embedding,
                    [metadataPath]: embeddingMetadata
                  }
                }
              );
              
              logger.info("Updated task embedding in MongoDB", {
                ticketId,
                participantName,
                type: "Coding",
                embeddingDimension: embedding.length,
                textHash: textHash.substring(0, 8)
              });
              
              updated = true;
              break;
            }
          }
        }
        
        // Check Non-Coding tasks
        if (participantData["Non-Coding"] && Array.isArray(participantData["Non-Coding"])) {
          for (let i = 0; i < participantData["Non-Coding"].length; i++) {
            const task = participantData["Non-Coding"][i];
            if (task && task.ticketId === ticketId) {
              // Update this specific task with embedding
              const updatePath = `${participantName}.Non-Coding.${i}.embedding`;
              const metadataPath = `${participantName}.Non-Coding.${i}.embeddingMetadata`;
              
              await collection.updateOne(
                { _id: doc._id },
                {
                  $set: {
                    [updatePath]: embedding,
                    [metadataPath]: embeddingMetadata
                  }
                }
              );
              
              logger.info("Updated task embedding in MongoDB", {
                ticketId,
                participantName,
                type: "Non-Coding",
                embeddingDimension: embedding.length,
                textHash: textHash.substring(0, 8)
              });
              
              updated = true;
              break;
            }
          }
        }
        
        if (updated) break;
      }
      if (updated) break;
    }
    
    if (!updated) {
      logger.warn("Task not found for embedding update", { ticketId });
      return false;
    }
    
    return true;
    
  } catch (error) {
    logger.error("Error adding/updating task embedding", {
      error: error.message,
      ticketId,
      taskData: {
        title: taskData.title?.substring(0, 50),
        assignee: taskData.assignee
      }
    });
    return false;
  }
}

/**
 * Check if task content has changed (requires embedding update)
 * @param {string} currentText - Current task text
 * @param {Object} existingMetadata - Existing embedding metadata
 * @returns {boolean} True if embedding needs update
 */
function needsEmbeddingUpdate(currentText, existingMetadata) {
  if (!existingMetadata || !existingMetadata.textHash) {
    return true; // No existing embedding
  }
  
  const currentHash = createTextHash(currentText);
  return currentHash !== existingMetadata.textHash;
}

/**
 * Find similar tasks using MongoDB-stored embeddings
 * @param {string} queryText - Text to search for
 * @param {Object} context - Query context
 * @param {number} topK - Number of results to return
 * @param {number} threshold - Similarity threshold (0-1)
 * @returns {Promise<Array>} Array of similar tasks with scores
 */
async function findSimilarTasksInMongoDB(queryText, context = {}, topK = 5, threshold = 0.7) {
  try {
    const { initializeMongoDB, getDatabase } = require("./mongoService");
    await initializeMongoDB();
    const db = getDatabase();
    const collection = db.collection('sptasks');
    
    // Generate embedding for query
    const queryEmbedding = await generateTaskEmbedding(queryText, context);
    
    // Get all tasks with embeddings
    const documents = await collection.find({}).toArray();
    const taskCandidates = [];
    
    for (const doc of documents) {
      for (const [participantName, participantData] of Object.entries(doc)) {
        if (participantName === "_id" || participantName === "timestamp") continue;
        
        // Process Coding tasks
        if (participantData.Coding && Array.isArray(participantData.Coding)) {
          for (const task of participantData.Coding) {
            if (task && task.embedding && task.ticketId) {
              taskCandidates.push({
                ticketId: task.ticketId,
                title: task.title,
                description: task.description,
                assignee: participantName,
                type: "Coding",
                status: task.status,
                embedding: task.embedding,
                embeddingMetadata: task.embeddingMetadata
              });
            }
          }
        }
        
        // Process Non-Coding tasks
        if (participantData["Non-Coding"] && Array.isArray(participantData["Non-Coding"])) {
          for (const task of participantData["Non-Coding"]) {
            if (task && task.embedding && task.ticketId) {
              taskCandidates.push({
                ticketId: task.ticketId,
                title: task.title,
                description: task.description,
                assignee: participantName,
                type: "Non-Coding",
                status: task.status,
                embedding: task.embedding,
                embeddingMetadata: task.embeddingMetadata
              });
            }
          }
        }
      }
    }
    
    // Calculate similarities
    const similarTasks = [];
    
    for (const candidate of taskCandidates) {
      const similarity = calculateCosineSimilarity(queryEmbedding, candidate.embedding);
      
      if (similarity >= threshold) {
        similarTasks.push({
          ticketId: candidate.ticketId,
          title: candidate.title,
          description: candidate.description,
          assignee: candidate.assignee,
          type: candidate.type,
          status: candidate.status,
          similarity: similarity,
          embeddingMetadata: candidate.embeddingMetadata
        });
      }
    }
    
    // Sort by similarity (highest first) and limit results
    similarTasks.sort((a, b) => b.similarity - a.similarity);
    const results = similarTasks.slice(0, topK);
    
    logger.info("MongoDB similarity search completed", {
      queryTextLength: queryText.length,
      totalCandidates: taskCandidates.length,
      candidatesWithEmbeddings: taskCandidates.filter(t => t.embedding).length,
      resultsAboveThreshold: similarTasks.length,
      topK,
      threshold,
      topSimilarity: results.length > 0 ? results[0].similarity : 0
    });
    
    return results;
    
  } catch (error) {
    logger.error("Error in MongoDB similarity search", {
      error: error.message,
      queryText: queryText.substring(0, 100),
      topK,
      threshold
    });
    return [];
  }
}

/**
 * Calculate cosine similarity between two vectors
 * @param {Array<number>} vectorA 
 * @param {Array<number>} vectorB 
 * @returns {number} Similarity score (0-1)
 */
function calculateCosineSimilarity(vectorA, vectorB) {
  if (!vectorA || !vectorB || vectorA.length !== vectorB.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
    normA += vectorA[i] * vectorA[i];
    normB += vectorB[i] * vectorB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Get embedding statistics from MongoDB
 * @returns {Promise<Object>} Statistics about embeddings
 */
async function getEmbeddingStatistics() {
  try {
    const { initializeMongoDB, getDatabase } = require("./mongoService");
    await initializeMongoDB();
    const db = getDatabase();
    const collection = db.collection('sptasks');
    
    const documents = await collection.find({}).toArray();
    
    let totalTasks = 0;
    let tasksWithEmbeddings = 0;
    let embeddingModels = {};
    let oldestEmbedding = null;
    let newestEmbedding = null;
    
    for (const doc of documents) {
      for (const [participantName, participantData] of Object.entries(doc)) {
        if (participantName === "_id" || participantName === "timestamp") continue;
        
        // Process Coding tasks
        if (participantData.Coding && Array.isArray(participantData.Coding)) {
          for (const task of participantData.Coding) {
            if (task && task.ticketId) {
              totalTasks++;
              if (task.embedding && task.embeddingMetadata) {
                tasksWithEmbeddings++;
                
                // Track embedding models
                const model = task.embeddingMetadata.model || "unknown";
                embeddingModels[model] = (embeddingModels[model] || 0) + 1;
                
                // Track embedding dates
                const embeddingDate = new Date(task.embeddingMetadata.generatedAt);
                if (!oldestEmbedding || embeddingDate < oldestEmbedding) {
                  oldestEmbedding = embeddingDate;
                }
                if (!newestEmbedding || embeddingDate > newestEmbedding) {
                  newestEmbedding = embeddingDate;
                }
              }
            }
          }
        }
        
        // Process Non-Coding tasks
        if (participantData["Non-Coding"] && Array.isArray(participantData["Non-Coding"])) {
          for (const task of participantData["Non-Coding"]) {
            if (task && task.ticketId) {
              totalTasks++;
              if (task.embedding && task.embeddingMetadata) {
                tasksWithEmbeddings++;
                
                // Track embedding models
                const model = task.embeddingMetadata.model || "unknown";
                embeddingModels[model] = (embeddingModels[model] || 0) + 1;
                
                // Track embedding dates
                const embeddingDate = new Date(task.embeddingMetadata.generatedAt);
                if (!oldestEmbedding || embeddingDate < oldestEmbedding) {
                  oldestEmbedding = embeddingDate;
                }
                if (!newestEmbedding || embeddingDate > newestEmbedding) {
                  newestEmbedding = embeddingDate;
                }
              }
            }
          }
        }
      }
    }
    
    return {
      totalTasks,
      tasksWithEmbeddings,
      embeddingCoverage: totalTasks > 0 ? (tasksWithEmbeddings / totalTasks * 100).toFixed(1) + '%' : '0%',
      embeddingModels,
      dateRange: {
        oldest: oldestEmbedding ? oldestEmbedding.toISOString() : null,
        newest: newestEmbedding ? newestEmbedding.toISOString() : null
      }
    };
    
  } catch (error) {
    logger.error("Error getting embedding statistics", {
      error: error.message
    });
    return {
      totalTasks: 0,
      tasksWithEmbeddings: 0,
      embeddingCoverage: '0%',
      embeddingModels: {},
      dateRange: { oldest: null, newest: null },
      error: error.message
    };
  }
}

/**
 * Remove embedding from task (cleanup function)
 * @param {string} ticketId - Task ticket ID
 * @returns {Promise<boolean>} Success status
 */
async function removeTaskEmbedding(ticketId) {
  try {
    const { initializeMongoDB, getDatabase } = require("./mongoService");
    await initializeMongoDB();
    const db = getDatabase();
    const collection = db.collection('sptasks');
    
    // Find and remove embedding from the task
    const documents = await collection.find({}).toArray();
    let removed = false;
    
    for (const doc of documents) {
      for (const [participantName, participantData] of Object.entries(doc)) {
        if (participantName === "_id" || participantName === "timestamp") continue;
        
        // Check Coding tasks
        if (participantData.Coding && Array.isArray(participantData.Coding)) {
          for (let i = 0; i < participantData.Coding.length; i++) {
            const task = participantData.Coding[i];
            if (task && task.ticketId === ticketId && task.embedding) {
              await collection.updateOne(
                { _id: doc._id },
                {
                  $unset: {
                    [`${participantName}.Coding.${i}.embedding`]: "",
                    [`${participantName}.Coding.${i}.embeddingMetadata`]: ""
                  }
                }
              );
              removed = true;
              break;
            }
          }
        }
        
        // Check Non-Coding tasks
        if (participantData["Non-Coding"] && Array.isArray(participantData["Non-Coding"])) {
          for (let i = 0; i < participantData["Non-Coding"].length; i++) {
            const task = participantData["Non-Coding"][i];
            if (task && task.ticketId === ticketId && task.embedding) {
              await collection.updateOne(
                { _id: doc._id },
                {
                  $unset: {
                    [`${participantName}.Non-Coding.${i}.embedding`]: "",
                    [`${participantName}.Non-Coding.${i}.embeddingMetadata`]: ""
                  }
                }
              );
              removed = true;
              break;
            }
          }
        }
        
        if (removed) break;
      }
      if (removed) break;
    }
    
    if (removed) {
      logger.info("Removed task embedding from MongoDB", { ticketId });
    } else {
      logger.warn("Task embedding not found for removal", { ticketId });
    }
    
    return removed;
    
  } catch (error) {
    logger.error("Error removing task embedding", {
      error: error.message,
      ticketId
    });
    return false;
  }
}

module.exports = {
  generateTaskEmbedding,
  addOrUpdateTaskEmbedding,
  findSimilarTasksInMongoDB,
  needsEmbeddingUpdate,
  getEmbeddingStatistics,
  removeTaskEmbedding,
  createEnhancedTextForEmbedding,
  createTextHash,
  calculateCosineSimilarity
};
