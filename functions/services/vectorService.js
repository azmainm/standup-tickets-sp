/**
 * Vector Database Service for Task Similarity Search
 * 
 * This service handles:
 * 1. Storing and retrieving task embeddings using FAISS
 * 2. Generating embeddings using OpenAI
 * 3. Fast similarity search for task matching
 * 4. Synchronization with database timestamps
 */

const { logger } = require("firebase-functions");
const OpenAI = require("openai");
const path = require("path");
const fs = require("fs").promises;

// Lazy load FAISS to avoid import issues
let faiss = null;
function getFaiss() {
  if (!faiss) {
    try {
      faiss = require('faiss-node');
    } catch (error) {
      logger.warn("FAISS not available, falling back to non-vector similarity", {
        error: error.message
      });
      return null;
    }
  }
  return faiss;
}

// Load environment variables
require("dotenv").config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Vector database configuration
const VECTOR_DB_PATH = path.join(__dirname, "../output/vector_db");
const EMBEDDINGS_FILE = path.join(VECTOR_DB_PATH, "task_embeddings.json");
const FAISS_INDEX_FILE = path.join(VECTOR_DB_PATH, "faiss_index.index");
const METADATA_FILE = path.join(VECTOR_DB_PATH, "metadata.json");

// In-memory cache for performance
let vectorCache = {
  index: null,
  embeddings: new Map(),
  metadata: new Map(),
  lastLoaded: null,
  isLoaded: false
};

/**
 * Initialize vector database directory and files
 * @returns {Promise<void>}
 */
async function initializeVectorDB() {
  try {
    // Ensure directory exists
    await fs.mkdir(VECTOR_DB_PATH, { recursive: true });
    
    // Initialize files if they don't exist
    const files = [EMBEDDINGS_FILE, METADATA_FILE];
    for (const file of files) {
      try {
        await fs.access(file);
      } catch {
        await fs.writeFile(file, JSON.stringify({}));
        logger.info("Created vector DB file", { file });
      }
    }
    
    logger.info("Vector database initialized", {
      path: VECTOR_DB_PATH,
      files: files.length
    });
    
  } catch (error) {
    logger.error("Error initializing vector database", {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Generate embedding for task description using OpenAI
 * @param {string} text - Task description or title
 * @param {Object} context - Additional context (assignee, type, etc.)
 * @returns {Promise<Array<number>>} Embedding vector
 */
async function generateEmbedding(text, context = {}) {
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
    
    logger.info("Generated embedding", {
      textLength: text.length,
      enhancedTextLength: enhancedText.length,
      embeddingDimension: embedding.length,
      tokensUsed: response.usage.total_tokens
    });
    
    return embedding;
    
  } catch (error) {
    logger.error("Error generating embedding", {
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
 * Add or update task embedding in vector database
 * @param {string} taskId - Unique task identifier (ticketId or composite ID)
 * @param {string} text - Task description
 * @param {Object} metadata - Task metadata
 * @returns {Promise<boolean>} Success status
 */
async function addTaskEmbedding(taskId, text, metadata = {}) {
  try {
    await initializeVectorDB();
    
    // Generate embedding
    const embedding = await generateEmbedding(text, metadata);
    
    // Load current embeddings and metadata
    await loadVectorCache();
    
    // Add/update embedding
    vectorCache.embeddings.set(taskId, embedding);
    vectorCache.metadata.set(taskId, {
      ...metadata,
      text: text,
      taskId: taskId,
      lastModified: new Date().toISOString(),
      embeddingGenerated: new Date().toISOString()
    });
    
    // Save to files
    await saveVectorCache();
    
    // Rebuild FAISS index
    await rebuildFaissIndex();
    
    logger.info("Added task embedding", {
      taskId,
      textLength: text.length,
      embeddingDimension: embedding.length,
      totalEmbeddings: vectorCache.embeddings.size
    });
    
    return true;
    
  } catch (error) {
    logger.error("Error adding task embedding", {
      error: error.message,
      taskId,
      text: text.substring(0, 100)
    });
    return false;
  }
}

/**
 * Remove task embedding from vector database
 * @param {string} taskId - Task identifier to remove
 * @returns {Promise<boolean>} Success status
 */
async function removeTaskEmbedding(taskId) {
  try {
    await loadVectorCache();
    
    const existed = vectorCache.embeddings.has(taskId);
    
    vectorCache.embeddings.delete(taskId);
    vectorCache.metadata.delete(taskId);
    
    if (existed) {
      await saveVectorCache();
      await rebuildFaissIndex();
      
      logger.info("Removed task embedding", {
        taskId,
        totalEmbeddings: vectorCache.embeddings.size
      });
    }
    
    return existed;
    
  } catch (error) {
    logger.error("Error removing task embedding", {
      error: error.message,
      taskId
    });
    return false;
  }
}

/**
 * Find similar tasks using vector similarity search
 * @param {string} queryText - Text to search for
 * @param {Object} context - Query context
 * @param {number} topK - Number of results to return
 * @param {number} threshold - Similarity threshold (0-1)
 * @returns {Promise<Array>} Array of similar tasks with scores
 */
async function findSimilarTasks(queryText, context = {}, topK = 5, threshold = 0.7) {
  try {
    const faissLib = getFaiss();
    if (!faissLib || !vectorCache.index) {
      logger.warn("FAISS not available or index not loaded, returning empty results");
      return [];
    }
    
    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(queryText, context);
    
    // Search using FAISS
    const results = vectorCache.index.search(queryEmbedding, topK);
    
    const similarTasks = [];
    
    for (let i = 0; i < results.labels.length; i++) {
      const score = results.distances[i];
      const taskIndex = results.labels[i];
      
      // Convert distance to similarity (FAISS returns L2 distance)
      const similarity = 1 / (1 + score);
      
      if (similarity >= threshold && taskIndex >= 0) {
        const taskIds = Array.from(vectorCache.embeddings.keys());
        const taskId = taskIds[taskIndex];
        const metadata = vectorCache.metadata.get(taskId);
        
        if (metadata) {
          similarTasks.push({
            taskId,
            similarity,
            score,
            metadata,
            text: metadata.text
          });
        }
      }
    }
    
    // Sort by similarity (highest first)
    similarTasks.sort((a, b) => b.similarity - a.similarity);
    
    logger.info("Vector similarity search completed", {
      queryTextLength: queryText.length,
      topK,
      threshold,
      resultsFound: similarTasks.length,
      topSimilarity: similarTasks.length > 0 ? similarTasks[0].similarity : 0
    });
    
    return similarTasks;
    
  } catch (error) {
    logger.error("Error in vector similarity search", {
      error: error.message,
      queryText: queryText.substring(0, 100),
      topK,
      threshold
    });
    return [];
  }
}

/**
 * Synchronize embeddings with database tasks that were modified recently
 * @param {Array} modifiedTasks - Tasks modified in database
 * @returns {Promise<Object>} Synchronization result
 */
async function synchronizeEmbeddings(modifiedTasks) {
  try {
    await loadVectorCache();
    
    let added = 0;
    let updated = 0;
    let errors = 0;
    
    for (const task of modifiedTasks) {
      try {
        const taskId = task.ticketId || task._id;
        const text = `${task.title || ''} ${task.description || ''}`.trim();
        
        if (!text) {
          logger.warn("Skipping task with no text content", { taskId });
          continue;
        }
        
        const metadata = {
          assignee: task.participantName || task.assignee,
          type: task.type,
          status: task.status,
          title: task.title,
          lastModified: task.lastModified || task.timestamp,
          lastModifiedAp: task.lastModifiedAp
        };
        
        const wasExisting = vectorCache.embeddings.has(taskId);
        
        const success = await addTaskEmbedding(taskId, text, metadata);
        
        if (success) {
          if (wasExisting) {
            updated++;
          } else {
            added++;
          }
        } else {
          errors++;
        }
        
      } catch (error) {
        logger.error("Error synchronizing task embedding", {
          error: error.message,
          taskId: task.ticketId || task._id
        });
        errors++;
      }
    }
    
    const result = {
      totalProcessed: modifiedTasks.length,
      added,
      updated,
      errors,
      success: errors === 0
    };
    
    logger.info("Embedding synchronization completed", result);
    
    return result;
    
  } catch (error) {
    logger.error("Error in embedding synchronization", {
      error: error.message,
      tasksCount: modifiedTasks.length
    });
    
    return {
      totalProcessed: modifiedTasks.length,
      added: 0,
      updated: 0,
      errors: modifiedTasks.length,
      success: false,
      error: error.message
    };
  }
}

/**
 * Load vector cache from files
 * @returns {Promise<void>}
 */
async function loadVectorCache() {
  try {
    if (vectorCache.isLoaded && 
        vectorCache.lastLoaded && 
        (Date.now() - vectorCache.lastLoaded) < 30000) { // 30 second cache
      return;
    }
    
    // Load embeddings
    try {
      const embeddingsData = await fs.readFile(EMBEDDINGS_FILE, 'utf8');
      const embeddings = JSON.parse(embeddingsData);
      vectorCache.embeddings = new Map(Object.entries(embeddings));
    } catch (error) {
      logger.warn("Could not load embeddings file", { error: error.message });
      vectorCache.embeddings = new Map();
    }
    
    // Load metadata
    try {
      const metadataData = await fs.readFile(METADATA_FILE, 'utf8');
      const metadata = JSON.parse(metadataData);
      vectorCache.metadata = new Map(Object.entries(metadata));
    } catch (error) {
      logger.warn("Could not load metadata file", { error: error.message });
      vectorCache.metadata = new Map();
    }
    
    // Load FAISS index
    await loadFaissIndex();
    
    vectorCache.lastLoaded = Date.now();
    vectorCache.isLoaded = true;
    
    logger.info("Vector cache loaded", {
      embeddings: vectorCache.embeddings.size,
      metadata: vectorCache.metadata.size,
      indexLoaded: !!vectorCache.index
    });
    
  } catch (error) {
    logger.error("Error loading vector cache", {
      error: error.message
    });
    
    // Initialize empty cache on error
    vectorCache.embeddings = new Map();
    vectorCache.metadata = new Map();
    vectorCache.index = null;
    vectorCache.isLoaded = true;
  }
}

/**
 * Save vector cache to files
 * @returns {Promise<void>}
 */
async function saveVectorCache() {
  try {
    // Save embeddings
    const embeddingsObj = Object.fromEntries(vectorCache.embeddings);
    await fs.writeFile(EMBEDDINGS_FILE, JSON.stringify(embeddingsObj, null, 2));
    
    // Save metadata
    const metadataObj = Object.fromEntries(vectorCache.metadata);
    await fs.writeFile(METADATA_FILE, JSON.stringify(metadataObj, null, 2));
    
    logger.info("Vector cache saved", {
      embeddings: vectorCache.embeddings.size,
      metadata: vectorCache.metadata.size
    });
    
  } catch (error) {
    logger.error("Error saving vector cache", {
      error: error.message
    });
    throw error;
  }
}

/**
 * Load FAISS index from file
 * @returns {Promise<void>}
 */
async function loadFaissIndex() {
  try {
    const faissLib = getFaiss();
    if (!faissLib) {
      return;
    }
    
    try {
      await fs.access(FAISS_INDEX_FILE);
      vectorCache.index = faissLib.IndexFlatL2.read(FAISS_INDEX_FILE);
      logger.info("FAISS index loaded from file");
    } catch {
      // Index file doesn't exist, will be created when needed
      vectorCache.index = null;
    }
    
  } catch (error) {
    logger.error("Error loading FAISS index", {
      error: error.message
    });
    vectorCache.index = null;
  }
}

/**
 * Rebuild FAISS index from current embeddings
 * @returns {Promise<void>}
 */
async function rebuildFaissIndex() {
  try {
    const faissLib = getFaiss();
    if (!faissLib) {
      return;
    }
    
    const embeddings = Array.from(vectorCache.embeddings.values());
    
    if (embeddings.length === 0) {
      vectorCache.index = null;
      return;
    }
    
    const dimension = embeddings[0].length;
    
    // Create new index
    const index = new faissLib.IndexFlatL2(dimension);
    
    // Add all embeddings
    for (const embedding of embeddings) {
      index.add(embedding);
    }
    
    vectorCache.index = index;
    
    // Save to file
    index.write(FAISS_INDEX_FILE);
    
    logger.info("FAISS index rebuilt", {
      totalEmbeddings: embeddings.length,
      dimension,
      indexSize: index.ntotal
    });
    
  } catch (error) {
    logger.error("Error rebuilding FAISS index", {
      error: error.message
    });
    vectorCache.index = null;
  }
}

/**
 * Check if vector database is available and working
 * @returns {Promise<boolean>} Availability status
 */
async function isVectorDBAvailable() {
  try {
    const faissLib = getFaiss();
    return !!faissLib;
  } catch {
    return false;
  }
}

/**
 * Get vector database statistics
 * @returns {Promise<Object>} Statistics object
 */
async function getVectorDBStats() {
  try {
    await loadVectorCache();
    
    return {
      available: await isVectorDBAvailable(),
      totalEmbeddings: vectorCache.embeddings.size,
      totalMetadata: vectorCache.metadata.size,
      indexLoaded: !!vectorCache.index,
      indexSize: vectorCache.index ? vectorCache.index.ntotal : 0,
      lastLoaded: vectorCache.lastLoaded,
      cacheAge: vectorCache.lastLoaded ? Date.now() - vectorCache.lastLoaded : null
    };
    
  } catch (error) {
    return {
      available: false,
      error: error.message,
      totalEmbeddings: 0,
      totalMetadata: 0,
      indexLoaded: false,
      indexSize: 0
    };
  }
}

/**
 * Clear all embeddings and rebuild from scratch
 * @returns {Promise<boolean>} Success status
 */
async function clearVectorDB() {
  try {
    await initializeVectorDB();
    
    vectorCache.embeddings.clear();
    vectorCache.metadata.clear();
    vectorCache.index = null;
    
    // Clear files
    await fs.writeFile(EMBEDDINGS_FILE, JSON.stringify({}));
    await fs.writeFile(METADATA_FILE, JSON.stringify({}));
    
    // Remove index file if it exists
    try {
      await fs.unlink(FAISS_INDEX_FILE);
    } catch {
      // File might not exist
    }
    
    logger.info("Vector database cleared");
    
    return true;
    
  } catch (error) {
    logger.error("Error clearing vector database", {
      error: error.message
    });
    return false;
  }
}

module.exports = {
  initializeVectorDB,
  generateEmbedding,
  addTaskEmbedding,
  removeTaskEmbedding,
  findSimilarTasks,
  synchronizeEmbeddings,
  loadVectorCache,
  saveVectorCache,
  rebuildFaissIndex,
  isVectorDBAvailable,
  getVectorDBStats,
  clearVectorDB,
  createEnhancedTextForEmbedding
};
