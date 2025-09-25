/**
 * Local Embedding Cache Service for Standup Tickets SP
 * 
 * This service provides local caching of transcript embeddings during processing
 * to enable scoped RAG searches that only consider the current meeting's context.
 * 
 * Key Features:
 * - Store embeddings locally during transcript processing
 * - Provide scoped search functionality for current meeting only
 * - Automatic cleanup after processing completion
 * - Memory-efficient temporary storage
 */

const { logger } = require("firebase-functions");
const { OpenAIEmbeddings } = require("@langchain/openai");

// Load environment variables
require("dotenv").config();

// In-memory cache for current processing session
let localEmbeddingCache = new Map();
let currentTranscriptId = null;

// Initialize OpenAI embeddings
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Store embeddings locally for the current transcript being processed
 * @param {string} transcriptId - Unique identifier for the transcript
 * @param {Array} embeddingDocuments - Array of embedding documents from vector store
 * @returns {Promise<Object>} Result of local storage operation
 */
async function storeLocalEmbeddings(transcriptId, embeddingDocuments) {
  try {
    if (!transcriptId || !embeddingDocuments || !Array.isArray(embeddingDocuments)) {
      throw new Error("Invalid parameters: transcriptId and embeddingDocuments array required");
    }

    // Clear any existing cache and set current transcript
    clearLocalEmbeddings();
    currentTranscriptId = transcriptId;

    // Store embeddings in local cache with metadata
    const cacheEntry = {
      transcriptId,
      embeddings: embeddingDocuments.map(doc => ({
        content: doc.pageContent,
        metadata: doc.metadata,
        embedding: null // We'll generate this on-demand for searches
      })),
      createdAt: new Date().toISOString(),
      totalChunks: embeddingDocuments.length
    };

    localEmbeddingCache.set(transcriptId, cacheEntry);

    logger.info("Local embeddings stored for transcript", {
      transcriptId,
      chunksStored: embeddingDocuments.length,
      memoryUsage: `${Math.round(JSON.stringify(cacheEntry).length / 1024)}KB`
    });

    return {
      success: true,
      transcriptId,
      chunksStored: embeddingDocuments.length,
      cacheSize: localEmbeddingCache.size
    };

  } catch (error) {
    logger.error("Error storing local embeddings", {
      error: error.message,
      transcriptId,
      documentsCount: embeddingDocuments ? embeddingDocuments.length : 0
    });
    throw error;
  }
}

/**
 * Search local embeddings for the current transcript only
 * @param {string} query - Search query text
 * @param {Object} options - Search options
 * @returns {Promise<Object>} Search results from local embeddings only
 */
async function searchLocalEmbeddings(query, options = {}) {
  try {
    const {
      topK = 5,
      scoreThreshold = 0.7,
      transcriptId = currentTranscriptId
    } = options;

    if (!transcriptId) {
      throw new Error("No current transcript ID set for local search");
    }

    const cacheEntry = localEmbeddingCache.get(transcriptId);
    if (!cacheEntry) {
      logger.warn("No local embeddings found for transcript", { transcriptId });
      return {
        success: true,
        results: [],
        searchMetadata: {
          totalResults: 0,
          filteredResults: 0,
          scoreThreshold,
          topK,
          source: "local_cache_empty"
        }
      };
    }

    // Generate embedding for the query
    const queryEmbedding = await embeddings.embedQuery(query);

    // Calculate similarity scores for all cached embeddings
    const similarities = [];
    
    for (let i = 0; i < cacheEntry.embeddings.length; i++) {
      const doc = cacheEntry.embeddings[i];
      
      // Generate embedding for document if not cached
      if (!doc.embedding) {
        doc.embedding = await embeddings.embedQuery(doc.content);
      }

      // Calculate cosine similarity
      const similarity = calculateCosineSimilarity(queryEmbedding, doc.embedding);
      
      if (similarity >= scoreThreshold) {
        similarities.push({
          content: doc.content,
          similarity,
          transcriptId: doc.metadata.transcriptId,
          meetingId: doc.metadata.meetingId,
          date: doc.metadata.date,
          chunkIndex: doc.metadata.chunkIndex,
          metadata: doc.metadata
        });
      }
    }

    // Sort by similarity and limit results
    const sortedResults = similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    logger.info("Local embedding search completed", {
      transcriptId,
      query: query.substring(0, 100),
      totalChunks: cacheEntry.embeddings.length,
      filteredResults: sortedResults.length,
      scoreThreshold,
      topSimilarity: sortedResults.length > 0 ? sortedResults[0].similarity.toFixed(3) : 0
    });

    return {
      success: true,
      results: sortedResults,
      searchMetadata: {
        totalResults: similarities.length,
        filteredResults: sortedResults.length,
        scoreThreshold,
        topK,
        source: "local_cache",
        transcriptId
      }
    };

  } catch (error) {
    logger.error("Error searching local embeddings", {
      error: error.message,
      query: query.substring(0, 100),
      transcriptId: currentTranscriptId
    });
    throw error;
  }
}

/**
 * Calculate cosine similarity between two vectors
 * @param {Array} vecA - First vector
 * @param {Array} vecB - Second vector
 * @returns {number} Cosine similarity score (0-1)
 */
function calculateCosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * Get RAG context using local embeddings only (scoped to current meeting)
 * @param {string} taskDescription - Task description to search for
 * @param {Object} options - Search options
 * @returns {Promise<Object>} RAG context from local embeddings
 */
async function getLocalRAGContext(taskDescription, options = {}) {
  try {
    const searchResult = await searchLocalEmbeddings(taskDescription, options);
    
    if (!searchResult.success || searchResult.results.length === 0) {
      return {
        success: true,
        context: "No relevant content found in current meeting transcript.",
        sources: [],
        searchMetadata: searchResult.searchMetadata
      };
    }

    // Format context from search results
    const contextSections = searchResult.results.map((result, index) => {
      return `[Source ${index + 1}] (Similarity: ${(result.similarity * 100).toFixed(1)}%, Meeting: ${result.meetingId || "Current"})
${result.content}`;
    });

    const context = contextSections.join("\n\n---\n\n");

    // Extract source information
    const sources = searchResult.results.map(result => ({
      transcriptId: result.transcriptId,
      meetingId: result.meetingId,
      date: result.date,
      similarity: result.similarity,
      chunkIndex: result.chunkIndex
    }));

    logger.info("Local RAG context generated", {
      taskDescription: taskDescription.substring(0, 100),
      sourcesCount: sources.length,
      contextLength: context.length,
      transcriptId: currentTranscriptId,
      searchType: "local_scoped"
    });

    return {
      success: true,
      context,
      sources,
      searchMetadata: searchResult.searchMetadata,
      isScoped: true,
      scopedToTranscript: currentTranscriptId
    };

  } catch (error) {
    logger.error("Error getting local RAG context", {
      error: error.message,
      taskDescription: taskDescription.substring(0, 100),
      transcriptId: currentTranscriptId
    });

    return {
      success: false,
      context: "Error retrieving context from current meeting.",
      sources: [],
      error: error.message,
      isScoped: true
    };
  }
}

/**
 * Clear local embeddings cache
 * @param {string} transcriptId - Optional specific transcript to clear, or all if not provided
 * @returns {Object} Cleanup result
 */
function clearLocalEmbeddings(transcriptId = null) {
  try {
    if (transcriptId) {
      const existed = localEmbeddingCache.has(transcriptId);
      localEmbeddingCache.delete(transcriptId);
      
      if (currentTranscriptId === transcriptId) {
        currentTranscriptId = null;
      }

      logger.info("Local embeddings cleared for transcript", {
        transcriptId,
        existed,
        remainingCacheSize: localEmbeddingCache.size
      });

      return {
        success: true,
        cleared: existed ? 1 : 0,
        remainingCacheSize: localEmbeddingCache.size
      };
    } else {
      // Clear all
      const sizeBefore = localEmbeddingCache.size;
      localEmbeddingCache.clear();
      currentTranscriptId = null;

      logger.info("All local embeddings cleared", {
        clearedCount: sizeBefore,
        currentCacheSize: localEmbeddingCache.size
      });

      return {
        success: true,
        cleared: sizeBefore,
        remainingCacheSize: 0
      };
    }

  } catch (error) {
    logger.error("Error clearing local embeddings", {
      error: error.message,
      transcriptId
    });
    throw error;
  }
}

/**
 * Get current cache status
 * @returns {Object} Cache status information
 */
function getCacheStatus() {
  const cacheEntries = Array.from(localEmbeddingCache.entries()).map(([id, entry]) => ({
    transcriptId: id,
    chunksCount: entry.embeddings.length,
    createdAt: entry.createdAt,
    memoryUsage: `${Math.round(JSON.stringify(entry).length / 1024)}KB`
  }));

  return {
    currentTranscriptId,
    cacheSize: localEmbeddingCache.size,
    entries: cacheEntries,
    totalMemoryUsage: cacheEntries.reduce((total, entry) => {
      return total + parseInt(entry.memoryUsage.replace("KB", ""));
    }, 0) + "KB"
  };
}

/**
 * Test local embedding cache functionality
 * @returns {Promise<boolean>} Test result
 */
async function testLocalEmbeddingCache() {
  try {
    // Create test documents
    const testDocs = [
      {
        pageContent: "Test meeting discussion about authentication",
        metadata: {
          transcriptId: "test-123",
          meetingId: "test-meeting",
          date: "2025-01-01",
          chunkIndex: 0
        }
      },
      {
        pageContent: "Follow up on login system improvements",
        metadata: {
          transcriptId: "test-123",
          meetingId: "test-meeting", 
          date: "2025-01-01",
          chunkIndex: 1
        }
      }
    ];

    // Test storage
    const storeResult = await storeLocalEmbeddings("test-123", testDocs);
    if (!storeResult.success) {
      throw new Error("Failed to store test embeddings");
    }

    // Test search
    const searchResult = await searchLocalEmbeddings("authentication system", {
      topK: 2,
      scoreThreshold: 0.1 // Low threshold for test
    });

    if (!searchResult.success) {
      throw new Error("Failed to search local embeddings");
    }

    // Test RAG context
    const ragResult = await getLocalRAGContext("login authentication");
    if (!ragResult.success) {
      throw new Error("Failed to get local RAG context");
    }

    // Test cleanup
    const cleanupResult = clearLocalEmbeddings("test-123");
    if (!cleanupResult.success) {
      throw new Error("Failed to cleanup test embeddings");
    }

    logger.info("Local embedding cache test completed successfully", {
      storeTest: storeResult.success,
      searchTest: searchResult.success,
      ragTest: ragResult.success,
      cleanupTest: cleanupResult.success
    });

    return true;

  } catch (error) {
    logger.error("Local embedding cache test failed", { error: error.message });
    return false;
  }
}

module.exports = {
  storeLocalEmbeddings,
  searchLocalEmbeddings,
  getLocalRAGContext,
  clearLocalEmbeddings,
  getCacheStatus,
  testLocalEmbeddingCache,
  
  // Getters for current state
  getCurrentTranscriptId: () => currentTranscriptId,
  getCacheSize: () => localEmbeddingCache.size
};
