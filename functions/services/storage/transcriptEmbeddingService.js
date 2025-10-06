/**
 * Transcript Embedding Service for Standup Tickets SP
 * 
 * This service handles:
 * 1. Generating embeddings for transcripts after saving them
 * 2. Storing embeddings in transcript_embeddings collection using MongoDB Atlas Vector Search
 * 3. Providing RAG functionality for task creation and updates
 * 
 * Based on the proven architecture from transcript-chat system
 */

const { MongoClient } = require("mongodb");
const crypto = require("crypto");
const { OpenAIEmbeddings } = require("@langchain/openai");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { MongoDBAtlasVectorSearch } = require("@langchain/mongodb");
const { logger } = require("firebase-functions");

// Load environment variables
require("dotenv").config();

// Environment variables
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = "standuptickets";
const EMBEDDINGS_COLLECTION = "transcript_embeddings";

const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
  apiKey: process.env.OPENAI_API_KEY,
});

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

let client = null;
let db = null;

/**
 * Get MongoDB database connection
 */
async function getDatabase() {
  if (!db) {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DATABASE_NAME);
  }
  return db;
}

/**
 * Initialize Vector Store for MongoDB Atlas Vector Search
 */
async function getVectorStore() {
  const database = await getDatabase();
  
  return new MongoDBAtlasVectorSearch(embeddings, {
    collection: database.collection(EMBEDDINGS_COLLECTION),
    indexName: "vector_index", // Vector search index name in MongoDB Atlas
    textKey: "text",
    embeddingKey: "embedding",
  });
}

/**
 * Generate hash for transcript content to detect changes
 */
function generateContentHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex").substring(0, 16);
}

/**
 * Check if transcript already has embeddings in vector store
 */
async function checkExistingEmbeddings(transcriptId) {
  try {
    const database = await getDatabase();
    const embeddingsCollection = database.collection(EMBEDDINGS_COLLECTION);
    
    const existingEmbeddings = await embeddingsCollection.findOne({
      "transcriptId": transcriptId
    });
    
    return !!existingEmbeddings;
  } catch (error) {
    logger.error("Error checking existing embeddings:", { error: error.message, transcriptId });
    return false;
  }
}

/**
 * Remove existing embeddings for a transcript
 */
async function removeExistingEmbeddings(transcriptId) {
  try {
    const database = await getDatabase();
    const embeddingsCollection = database.collection(EMBEDDINGS_COLLECTION);
    
    const result = await embeddingsCollection.deleteMany({
      "transcriptId": transcriptId
    });
    
    logger.info(`Removed ${result.deletedCount} existing embeddings for transcript ${transcriptId}`);
  } catch (error) {
    logger.error("Error removing existing embeddings:", { error: error.message, transcriptId });
  }
}

/**
 * Process and store transcript chunks in vector database
 */
async function processTranscriptToVectorStore(transcriptId, transcriptContent, meetingId, date) {
  try {
    const { storeLocalEmbeddings } = require("./localEmbeddingCache");
    const vectorStore = await getVectorStore();
    
    // Split text into chunks using LangChain
    const chunks = await textSplitter.splitText(transcriptContent);
    logger.info(`Split transcript into ${chunks.length} chunks`, { transcriptId });
    
    // Prepare documents for vector store
    const documents = chunks.map((chunk, index) => ({
      pageContent: chunk,
      metadata: {
        transcriptId: transcriptId,
        meetingId: meetingId || "unknown",
        date: date || new Date().toISOString().split("T")[0],
        chunkIndex: index,
        chunkTotal: chunks.length,
        contentHash: generateContentHash(transcriptContent),
        createdAt: new Date().toISOString()
      }
    }));
    
    // Store in vector database
    await vectorStore.addDocuments(documents);
    
    // IMPORTANT: Also store locally for scoped RAG searches during processing
    try {
      await storeLocalEmbeddings(transcriptId, documents);
      logger.info("Transcript embeddings stored locally for scoped RAG", { 
        transcriptId, 
        chunksStored: documents.length 
      });
    } catch (localStoreError) {
      logger.warn("Failed to store embeddings locally, RAG will use global search", {
        transcriptId,
        error: localStoreError.message
      });
    }
    
    logger.info(`Stored ${documents.length} chunks in vector database for transcript ${transcriptId}`);
    return {
      success: true,
      chunksStored: documents.length,
      model: "text-embedding-3-small",
      locallyStored: true
    };
    
  } catch (error) {
    logger.error("Error processing transcript to vector store:", { error: error.message, transcriptId });
    throw error;
  }
}

/**
 * Generate transcript embeddings after storing transcript
 * This function should be called right after storeTranscript in mongoService
 */
async function generateTranscriptEmbeddings(transcriptId, transcript, metadata = {}) {
  try {
    // Check if embeddings already exist
    const hasExistingEmbeddings = await checkExistingEmbeddings(transcriptId);
    if (hasExistingEmbeddings) {
        logger.info("Embeddings already exist for transcript", { transcriptId });
      return {
        success: true,
        skipped: true,
          message: "Embeddings already exist"
      };
    }
    
    // Format transcript content
    const transcriptContent = transcript
      .map(entry => {
        // Extract speaker name from the text field using <v ParticipantName> format
        let speaker = "Unknown";
        let text = entry.text || "";
        
        // Look for <v ParticipantName> pattern in the text
        const speakerMatch = text.match(/<v\s*([^>]+)>/);
        if (speakerMatch) {
          speaker = speakerMatch[1].trim();
          // Remove the <v ParticipantName> tag from the text
          text = text.replace(/<v[^>]*>/, "").replace(/<\/v>/, "").trim();
        } else {
          // Fallback: clean up speaker field if no <v> tag found
          speaker = entry.speaker
            .replace(/<[^>]*>/g, "") // Remove HTML tags
            .replace(/^v\s+/, "") // Remove "v " prefix if present
            .trim();
          
          // Clean up text (remove all HTML tags)
          text = text.replace(/<[^>]*>/g, "").trim();
        }
        
        // Only return meaningful entries
        if (text.length > 0) {
          return `${speaker}: ${text}`;
        }
        return "";
      })
      .filter(line => line.trim().length > 0) // Remove empty lines
      .join("\n");
    
    if (!transcriptContent || transcriptContent.trim().length === 0) {
        logger.warn("No transcript content found", { transcriptId });
      return {
        success: false,
          error: "No transcript content found"
      };
    }
    
    // Process transcript and store in vector database
    const result = await processTranscriptToVectorStore(
      transcriptId,
      transcriptContent,
      metadata.meetingId || 'unknown',
      metadata.date || new Date().toISOString().split('T')[0]
    );
    
        logger.info("Transcript embeddings generated successfully", {
      transcriptId,
      chunksStored: result.chunksStored,
      contentLength: transcriptContent.length
    });
    
    return result;
    
  } catch (error) {
    logger.error("Error generating transcript embeddings:", {
      error: error.message,
      stack: error.stack,
      transcriptId
    });
    throw error;
  }
}

/**
 * Search for relevant transcript content using vector similarity
 * Used for RAG functionality in TaskCreator and TaskUpdater
 */
async function searchTranscriptEmbeddings(query, options = {}) {
  try {
    const vectorStore = await getVectorStore();
    
    const {
      topK = 5,
      scoreThreshold = 0.7,
      transcriptIds = null // Optional: filter by specific transcript IDs
    } = options;
    
    // Perform similarity search
    let results;
    if (transcriptIds && transcriptIds.length > 0) {
      // Filter by specific transcript IDs if provided
      results = await vectorStore.similaritySearchWithScore(query, topK, {
        transcriptId: { $in: transcriptIds }
      });
    } else {
      // Search all transcripts
      results = await vectorStore.similaritySearchWithScore(query, topK);
    }
    
    // Filter results by score threshold and format for consistency
    const filteredResults = results
      .filter(([doc, score]) => score >= scoreThreshold)
      .map(([doc, score]) => ({
        content: doc.pageContent,
        similarity: score,
        transcriptId: doc.metadata.transcriptId,
        meetingId: doc.metadata.meetingId,
        date: doc.metadata.date,
        chunkIndex: doc.metadata.chunkIndex,
        metadata: doc.metadata
      }));
    
        logger.info("Transcript embedding search completed", {
      query: query.substring(0, 100),
      totalResults: results.length,
      filteredResults: filteredResults.length,
      scoreThreshold
    });
    
    return {
      success: true,
      results: filteredResults,
      query,
      searchMetadata: {
        totalResults: results.length,
        filteredResults: filteredResults.length,
        scoreThreshold,
        topK
      }
    };
    
  } catch (error) {
    logger.error("Error searching transcript embeddings:", {
      error: error.message,
      query: query.substring(0, 100)
    });
    throw error;
  }
}

/**
 * Get RAG context for a specific task using transcript embeddings
 * This is the main function used by TaskCreator and TaskUpdater
 */
async function getRAGContextForTask(taskDescription, options = {}) {
  try {
    const searchResult = await searchTranscriptEmbeddings(taskDescription, options);
    
    if (!searchResult.success || searchResult.results.length === 0) {
      return {
        success: true,
        context: "No relevant transcript content found for this task.",
        sources: []
      };
    }
    
    // Format context from search results
    const contextSections = searchResult.results.map((result, index) => {
      return `[Source ${index + 1}] (Similarity: ${(result.similarity * 100).toFixed(1)}%, Date: ${result.date})
${result.content}`;
    });
    
    const context = contextSections.join('\n\n---\n\n');
    
    // Extract source information
    const sources = searchResult.results.map(result => ({
      transcriptId: result.transcriptId,
      meetingId: result.meetingId,
      date: result.date,
      similarity: result.similarity
    }));
    
        logger.info("RAG context generated for task", {
      taskDescription: taskDescription.substring(0, 100),
      sourcesCount: sources.length,
      contextLength: context.length
    });
    
    return {
      success: true,
      context,
      sources,
      searchMetadata: searchResult.searchMetadata
    };
    
  } catch (error) {
    logger.error("Error getting RAG context for task:", {
      error: error.message,
      taskDescription: taskDescription.substring(0, 100)
    });
    
    return {
      success: false,
      context: "Error retrieving context for this task.",
      sources: [],
      error: error.message
    };
  }
}

/**
 * Test transcript embedding service connection
 */
async function testTranscriptEmbeddingService() {
  try {
    // Test database connection
    const database = await getDatabase();
    
    // Test vector store connection
    const vectorStore = await getVectorStore();
    
    // Test search functionality with a simple query
    const testQuery = "daily standup tasks";
    const searchResult = await searchTranscriptEmbeddings(testQuery, { topK: 1 });
    
        logger.info("Transcript embedding service test completed successfully", {
      databaseConnected: !!database,
      vectorStoreConnected: !!vectorStore,
      searchTest: searchResult.success
    });
    
    return true;
  } catch (error) {
    logger.error("Transcript embedding service test failed", { error: error.message });
    return false;
  }
}

module.exports = {
  generateTranscriptEmbeddings,
  searchTranscriptEmbeddings,
  getRAGContextForTask,
  processTranscriptToVectorStore,
  checkExistingEmbeddings,
  removeExistingEmbeddings,
  testTranscriptEmbeddingService,
  getDatabase,
  getVectorStore
};
