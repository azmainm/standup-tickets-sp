/**
 * Enhanced Task Matching Service - Matches new tasks from transcripts with existing tasks
 * 
 * This service handles:
 * 1. Vector-based similarity search (primary method)
 * 2. GPT-based similarity analysis (fallback method)
 * 3. Synchronization with admin panel changes
 * 4. Determining whether to create new tasks or update existing ones
 * 
 * ARCHIVED FUNCTIONS:
 * - Original GPT-only similarity functions are preserved for fallback
 * - Vector database provides 10-100x faster similarity search
 * - Smart synchronization handles manual admin panel updates
 */

// Note: getActiveTasks is imported within functions to avoid circular dependency issues
const { logger } = require("firebase-functions");
const OpenAI = require("openai");

// Import vector database service
const {
  findSimilarTasks,
  synchronizeEmbeddings,
  addTaskEmbedding,
  isVectorDBAvailable,
  getVectorDBStats
} = require("./vectorService");

// Load environment variables
require("dotenv").config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Enhanced GPT-based task similarity detection with improved context analysis
 * @param {string} newTaskDescription - New task description
 * @param {string} existingTaskDescription - Existing task description
 * @param {Object} context - Additional context for better matching
 * @returns {Promise<Object>} Object with isMatch boolean and enhanced analysis
 */
async function checkTaskSimilarityWithGPT(newTaskDescription, existingTaskDescription, context = {}) {
  try {
    const contextInfo = context.assignee ? `Both tasks are assigned to: ${context.assignee}\n` : "";
    const existingTaskInfo = context.existingTask ? 
      `Existing task details: Status: ${context.existingTask.status}, Type: ${context.existingTask.type}\n` : "";
    
    const prompt = `
You are an expert task management analyst with deep understanding of software development workflows. Analyze whether these task descriptions refer to the same work item.

${contextInfo}${existingTaskInfo}
Task 1 (New from transcript): "${newTaskDescription}"
Task 2 (Existing in database): "${existingTaskDescription}"

**Analysis Framework:**
1. **Feature/Component Match**: Do they target the same feature, component, or system?
2. **Work Continuation**: Could the new task be an update, extension, or continuation of existing work?
3. **Semantic Similarity**: Are they describing the same work using different terminology?
4. **Scope Overlap**: Is there significant overlap in what needs to be accomplished?
5. **Context Clues**: Do they reference the same technical concepts, tools, or requirements?

**Enhanced Matching Criteria:**
- Same feature with different phrasing ("user login" vs "authentication system")
- Progress updates ("fix authentication bug" matches "implement authentication")
- Refinements ("improve dashboard UI" matches "create admin dashboard")
- Different abstraction levels ("database optimization" vs "fix slow queries")
- Related sub-tasks ("API integration" vs "connect payment gateway")

**Return ONLY this JSON format:**
{
  "isMatch": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "detailed explanation of analysis",
  "similarities": ["list", "of", "key", "similarities"],
  "differences": ["list", "of", "key", "differences"],
  "recommendation": "UPDATE_EXISTING|CREATE_NEW|NEEDS_CLARIFICATION"
}

**Confidence Guidelines:**
- 0.9-1.0: Virtually identical or clear continuation
- 0.7-0.89: Strong match with minor differences
- 0.5-0.69: Moderate match, likely related work
- 0.3-0.49: Weak match, possibly related
- 0.0-0.29: Different tasks

**Examples:**
- "Implement user authentication" vs "Fix authentication system login bug" → 0.8 (same system, refinement)
- "Create payment dashboard" vs "Add payment analytics to admin panel" → 0.7 (same feature area)
- "Database optimization" vs "Fix slow user queries" → 0.6 (related performance work)
- "Build mobile app" vs "Fix login bug" → 0.1 (completely different)
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a senior software engineering project manager with expertise in task analysis, requirements management, and development workflow optimization. You excel at identifying semantic relationships between work items and understanding when tasks represent the same or related work. Always respond with valid JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 400,
    });

    let responseText = response.choices[0].message.content.trim();
    
    // Clean the response to handle markdown code blocks
    responseText = responseText.replace(/^```json\s*\n?/, "").replace(/\n?```\s*$/, "");
    
    // Parse the JSON response
    const result = JSON.parse(responseText);
    
    // Validate and enhance the result
    const enhancedResult = {
      isMatch: Boolean(result.isMatch),
      confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
      reasoning: result.reasoning || "No reasoning provided",
      similarities: Array.isArray(result.similarities) ? result.similarities : [],
      differences: Array.isArray(result.differences) ? result.differences : [],
      recommendation: result.recommendation || "CREATE_NEW"
    };
    
    logger.info("Enhanced GPT task similarity check completed", {
      newTask: newTaskDescription.substring(0, 50),
      existingTask: existingTaskDescription.substring(0, 50),
      isMatch: enhancedResult.isMatch,
      confidence: enhancedResult.confidence,
      recommendation: enhancedResult.recommendation,
      similaritiesCount: enhancedResult.similarities.length,
      differencesCount: enhancedResult.differences.length
    });
    
    return enhancedResult;
    
  } catch (error) {
    logger.error("Error in enhanced GPT task similarity check", {
      error: error.message,
      newTask: newTaskDescription.substring(0, 50),
      existingTask: existingTaskDescription.substring(0, 50)
    });
    
    // Enhanced fallback with simple semantic analysis
    const fallbackResult = performFallbackSimilarityCheck(newTaskDescription, existingTaskDescription);
    
    return {
      isMatch: fallbackResult.isMatch,
      confidence: fallbackResult.confidence,
      reasoning: `GPT check failed, using fallback analysis: ${fallbackResult.reasoning}`,
      similarities: fallbackResult.similarities || [],
      differences: fallbackResult.differences || [],
      recommendation: "NEEDS_CLARIFICATION"
    };
  }
}

/**
 * ✨ NEW: Enhanced matching using vector similarity first, GPT as fallback
 * @param {Object} newTask - New task from transcript
 * @param {Array} existingTasks - Array of existing active tasks for the participant
 * @returns {Promise<Object|null>} Enhanced matching task or null if no match found
 */
async function findMatchingTaskEnhanced(newTask, existingTasks) {
  try {
    if (!existingTasks || existingTasks.length === 0) {
      return null;
    }
    
    logger.info("Starting enhanced task matching with vector similarity", {
      newTaskDesc: newTask.description.substring(0, 100),
      newTaskType: newTask.type,
      existingTasksCount: existingTasks.length,
      assignee: newTask.assignee
    });
    
    // Step 1: Try vector similarity search if available
    const vectorAvailable = await isVectorDBAvailable();
    
    if (vectorAvailable) {
      try {
        const vectorResult = await findMatchingTaskWithVector(newTask, existingTasks);
        if (vectorResult) {
          logger.info("Vector similarity found match", {
            taskId: vectorResult.ticketId,
            similarity: vectorResult.vectorSimilarity,
            method: "vector"
          });
          return vectorResult;
        }
      } catch (error) {
        logger.warn("Vector similarity failed, falling back to GPT", {
          error: error.message
        });
      }
    }
    
    // Step 2: Fallback to original GPT-based matching
    logger.info("Using GPT fallback for task matching");
    const gptResult = await findMatchingTaskLegacy(newTask, existingTasks);
    
    if (gptResult) {
      logger.info("GPT similarity found match", {
        taskId: gptResult.ticketId,
        confidence: gptResult.similarityScore,
        method: "gpt_fallback"
      });
    }
    
    return gptResult;
    
  } catch (error) {
    logger.error("Error in enhanced task matching", {
      error: error.message,
      newTask: newTask.description.substring(0, 50)
    });
    
    // Ultimate fallback to legacy method
    return await findMatchingTaskLegacy(newTask, existingTasks);
  }
}

/**
 * Find matching task using vector similarity search
 * @param {Object} newTask - New task from transcript
 * @param {Array} existingTasks - Array of existing active tasks for the participant
 * @returns {Promise<Object|null>} Matching task or null
 */
async function findMatchingTaskWithVector(newTask, existingTasks) {
  try {
    const queryText = `${newTask.description}`;
    const context = {
      assignee: newTask.assignee,
      type: newTask.type,
      status: newTask.status || 'To-do'
    };
    
    // Search for similar tasks using vector similarity
    const similarTasks = await findSimilarTasks(queryText, context, 10, 0.75);
    
    if (similarTasks.length === 0) {
      return null;
    }
    
    // Filter to tasks from the same assignee and check type compatibility
    const candidateTasks = similarTasks.filter(similar => {
      const metadata = similar.metadata;
      
      // Must be same assignee
      if (metadata.assignee !== newTask.assignee) {
        return false;
      }
      
      // Check type compatibility
      const typeCompatibility = checkTypeCompatibility(newTask.type, metadata.type);
      return typeCompatibility.compatible;
    });
    
    if (candidateTasks.length === 0) {
      return null;
    }
    
    // Find the best match among existing tasks
    const bestCandidate = candidateTasks[0]; // Already sorted by similarity
    
    // Find the actual task object in existingTasks
    const matchingTask = existingTasks.find(task => 
      task.ticketId === bestCandidate.taskId ||
      task.ticketId === bestCandidate.metadata.ticketId
    );
    
    if (matchingTask && bestCandidate.similarity >= 0.75) {
      return {
        ...matchingTask,
        vectorSimilarity: bestCandidate.similarity,
        similarityScore: bestCandidate.similarity,
        reasoning: `Vector similarity: ${(bestCandidate.similarity * 100).toFixed(1)}%`,
        matchMethod: 'vector',
        vectorMetadata: bestCandidate.metadata
      };
    }
    
    return null;
    
  } catch (error) {
    logger.error("Error in vector similarity search", {
      error: error.message,
      newTask: newTask.description.substring(0, 50)
    });
    throw error;
  }
}

/**
 * ARCHIVED: Original enhanced matching function (kept for fallback)
 * @param {Object} newTask - New task from transcript
 * @param {Array} existingTasks - Array of existing active tasks for the participant
 * @returns {Promise<Object|null>} Enhanced matching task or null if no match found
 */
async function findMatchingTaskLegacy(newTask, existingTasks) {
  if (!existingTasks || existingTasks.length === 0) {
    return null;
  }
  
  let bestMatch = null;
  let bestConfidence = 0;
  let allAnalyses = [];
  
  // Dynamic confidence threshold based on task type and context
  const BASE_CONFIDENCE_THRESHOLD = 0.6;
  const adjustedThreshold = getAdjustedConfidenceThreshold(newTask, existingTasks);
  
  logger.info("Starting enhanced task matching", {
    newTaskDesc: newTask.description.substring(0, 100),
    newTaskType: newTask.type,
    existingTasksCount: existingTasks.length,
    confidenceThreshold: adjustedThreshold
  });
  
  for (const existingTask of existingTasks) {
    // Enhanced type matching - allow cross-type for related work
    const typeCompatibility = checkTypeCompatibility(newTask.type, existingTask.type);
    if (!typeCompatibility.compatible) {
      continue;
    }
    
    try {
      // Enhanced context for similarity analysis
      const context = {
        assignee: newTask.assignee,
        existingTask: {
          status: existingTask.status,
          type: existingTask.type,
          ticketId: existingTask.ticketId,
          estimatedTime: existingTask.estimatedTime,
          timeTaken: existingTask.timeTaken
        },
        typeCompatibility
      };
      
      const similarityResult = await checkTaskSimilarityWithGPT(
        newTask.description, 
        existingTask.description,
        context
      );
      
      // Adjust confidence based on type compatibility
      const adjustedConfidence = similarityResult.confidence * typeCompatibility.multiplier;
      
      allAnalyses.push({
        task: existingTask,
        analysis: similarityResult,
        adjustedConfidence,
        typeCompatibility
      });
      
      if (similarityResult.isMatch && 
          adjustedConfidence > bestConfidence && 
          adjustedConfidence >= adjustedThreshold) {
        bestConfidence = adjustedConfidence;
        bestMatch = {
          ...existingTask,
          similarityScore: adjustedConfidence,
          originalConfidence: similarityResult.confidence,
          reasoning: similarityResult.reasoning,
          similarities: similarityResult.similarities,
          differences: similarityResult.differences,
          recommendation: similarityResult.recommendation,
          typeCompatibility
        };
      }
    } catch (error) {
      logger.error("Error in enhanced task similarity check", {
        error: error.message,
        newTask: newTask.description.substring(0, 50),
        existingTask: existingTask.description.substring(0, 50)
      });
      
      // Try fallback analysis for this task
      try {
        const fallbackResult = performFallbackSimilarityCheck(
          newTask.description, 
          existingTask.description
        );
        
        if (fallbackResult.confidence >= adjustedThreshold) {
          allAnalyses.push({
            task: existingTask,
            analysis: fallbackResult,
            adjustedConfidence: fallbackResult.confidence,
            typeCompatibility,
            fallback: true
          });
        }
      } catch (fallbackError) {
        logger.error("Fallback similarity check also failed", {
          error: fallbackError.message,
          newTask: newTask.description.substring(0, 50),
          existingTask: existingTask.description.substring(0, 50)
        });
      }
      
      continue;
    }
  }
  
  // Log detailed analysis results
  if (allAnalyses.length > 0) {
    logger.info("Task matching analysis completed", {
      totalAnalyses: allAnalyses.length,
      bestMatch: bestMatch ? {
        taskId: bestMatch.ticketId,
        confidence: bestConfidence,
        recommendation: bestMatch.recommendation
      } : null,
      topAlternatives: allAnalyses
        .sort((a, b) => b.adjustedConfidence - a.adjustedConfidence)
        .slice(0, 3)
        .map(a => ({
          taskId: a.task.ticketId,
          confidence: a.adjustedConfidence,
          fallback: a.fallback || false
        }))
    });
  }
  
  return bestMatch;
}

/**
 * Parse time estimates from task description or separate field
 * @param {string} text - Text that might contain time estimates
 * @returns {number} Estimated time in hours, 0 if not found
 */
function parseTimeEstimate(text) {
  if (!text) return 0;
  
  // Look for patterns like "X hours", "X hrs", "X h", "take X hours", "might take X hours"
  const timePatterns = [
    /(?:take|might take|estimated?|will take|need)\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i,
    /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:estimated?|needed|required)/i,
    /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)/i
  ];
  
  for (const pattern of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      return parseFloat(match[1]) || 0;
    }
  }
  
  return 0;
}

/**
 * Parse time spent from task description
 * @param {string} text - Text that might contain time spent information
 * @returns {number} Time spent in hours, 0 if not found
 */
function parseTimeSpent(text) {
  if (!text) return 0;
  
  // Look for patterns like "spent X hours", "took X hours", "X hours spent", "completed in X hours"
  const timePatterns = [
    /(?:spent|took|completed in|worked for)\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i,
    /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:spent|taken|worked)/i
  ];
  
  for (const pattern of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      return parseFloat(match[1]) || 0;
    }
  }
  
  return 0;
}

/**
 * Normalize ticket ID to handle different formats (SP3, SP 12, SP-13, sp4)
 * @param {string} ticketId - Raw ticket ID from transcript or database
 * @returns {string|null} Normalized ticket ID (e.g., "SP-3") or null if invalid
 */
function normalizeTicketId(ticketId) {
  if (!ticketId) return null;
  
  // Remove spaces, convert to uppercase, ensure dash format
  return ticketId.toString()
    .replace(/\s+/g, "") // Remove all spaces: "SP 12" -> "SP12"
    .toUpperCase()       // Convert to uppercase: "sp4" -> "SP4"
    .replace(/^(SP)(\d+)$/, "$1-$2"); // Add dash if missing: "SP3" -> "SP-3"
}

/**
 * Parse status updates from task description or updates
 * @param {string} text - Text that might contain status information
 * @returns {string|null} Status ('To-do', 'In-progress', 'Completed') or null if not found
 */
function parseStatusUpdate(text) {
  if (!text) return null;
  
  const lowerText = text.toLowerCase();
  
  // Check for completion indicators
  if (lowerText.includes("completed") || 
      lowerText.includes("finished") || 
      lowerText.includes("done with") ||
      lowerText.includes("is done") ||
      lowerText.includes("have completed")) {
    return "Completed";
  }
  
  // Check for in-progress indicators
  if (lowerText.includes("started") || 
      lowerText.includes("working on") || 
      lowerText.includes("begun") ||
      lowerText.includes("in progress") ||
      lowerText.includes("currently") ||
      lowerText.includes("am working")) {
    return "In-progress";
  }
  
  return null;
}

/**
 * Process new tasks against existing tasks to determine actions
 * @param {Array} newTasks - Array of new tasks from transcript processing
 * @param {Array} existingTasks - Array of existing active tasks from database
 * @returns {Promise<Object>} Processing result with actions to take
 */
async function processTaskMatching(newTasks, existingTasks) {
  try {
    logger.info("Starting task matching process", {
      newTasksCount: newTasks.length,
      existingTasksCount: existingTasks.length,
    });
    
    const results = {
      tasksToCreate: [],
      tasksToUpdate: [],
      summary: {
        newTasks: 0,
        updatedTasks: 0,
        totalProcessed: newTasks.length
      }
    };
    
    for (const newTask of newTasks) {
      // Get existing tasks for this participant
      const participantExistingTasks = existingTasks.filter(
        task => task.participantName === newTask.assignee
      );
      
      let matchingTask = null;
      
      // PRIORITY 1: Check if task has explicit task ID (existingTaskId)
      if (newTask.existingTaskId) {
        // Normalize both ticket IDs for comparison (handle SP3, SP 12, SP-13 formats)
        const normalizedSearchId = normalizeTicketId(newTask.existingTaskId);
        
        // Look for existing task with this specific ticket ID
        matchingTask = existingTasks.find(task => 
          task.ticketId && normalizeTicketId(task.ticketId) === normalizedSearchId
        );
        
        if (matchingTask) {
          logger.info("Found task by explicit ticket ID", {
            ticketId: newTask.existingTaskId,
            normalizedId: normalizedSearchId,
            matchedTicketId: matchingTask.ticketId,
            taskDescription: newTask.description.substring(0, 50)
          });
        } else {
          logger.warn("Explicit ticket ID mentioned but not found in database", {
            ticketId: newTask.existingTaskId,
            normalizedId: normalizedSearchId,
            availableTicketIds: existingTasks.filter(t => t.ticketId).map(t => t.ticketId),
            taskDescription: newTask.description.substring(0, 50)
          });
        }
      }
      
      // PRIORITY 2: If no explicit ID match found, try similarity matching
      if (!matchingTask) {
        matchingTask = await findMatchingTask(newTask, participantExistingTasks);
      }
      
      if (matchingTask) {
        // Task match found - prepare update
        const updateData = {
          originalTask: matchingTask,
          newTaskInfo: newTask,
          updates: {}
        };
        
        // Check if we should add new information as update
        // Since GPT already determined they're similar, check if they're not identical
        if (newTask.description.toLowerCase().trim() !== matchingTask.description.toLowerCase().trim()) {
          // Add new information as update
          updateData.updates.description = matchingTask.description + 
            `\n\nUpdate: ${newTask.description}`;
        }
        
        // Parse and apply status updates
        let statusUpdate = parseStatusUpdate(newTask.description);
        
        // If explicit task ID was mentioned and we have a status from AI, prioritize that
        if (newTask.existingTaskId && newTask.status && 
            newTask.status !== "To-do" && newTask.status !== matchingTask.status) {
          statusUpdate = newTask.status;
        }
        
        if (statusUpdate && statusUpdate !== matchingTask.status) {
          updateData.updates.status = statusUpdate;
        }
        
        // Parse and apply time spent updates
        const timeSpent = parseTimeSpent(newTask.description);
        if (timeSpent > 0) {
          updateData.updates.timeTaken = (matchingTask.timeTaken || 0) + timeSpent;
        }
        
        // Parse and apply time estimates (only if not already set)
        if (!matchingTask.estimatedTime || matchingTask.estimatedTime === 0) {
          const timeEstimate = parseTimeEstimate(newTask.description);
          if (timeEstimate > 0) {
            updateData.updates.estimatedTime = timeEstimate;
          }
        }
        
        results.tasksToUpdate.push(updateData);
        results.summary.updatedTasks++;
        
      } else {
        // No match found - create new task
        const newTaskData = {
          participantName: newTask.assignee,
          description: newTask.description,
          status: parseStatusUpdate(newTask.description) || "To-do",
          type: newTask.type,
          estimatedTime: parseTimeEstimate(newTask.description),
          timeTaken: parseTimeSpent(newTask.description)
        };
        
        results.tasksToCreate.push(newTaskData);
        results.summary.newTasks++;
      }
    }
    
    logger.info("Task matching completed", {
      newTasksToCreate: results.summary.newTasks,
      existingTasksToUpdate: results.summary.updatedTasks,
      totalProcessed: results.summary.totalProcessed,
    });
    
    return results;
    
  } catch (error) {
    logger.error("Error in task matching process", {
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`Task matching failed: ${error.message}`);
  }
}

/**
 * ✨ NEW: Enhanced function to sync with admin panel changes before matching
 * @param {Object} extractedTasksData - Structured task data from transcript (by participant)
 * @returns {Promise<Object>} Matching results with actions to take
 */
async function matchTasksWithDatabaseEnhanced(extractedTasksData) {
  try {
    logger.info("Starting enhanced task matching with synchronization", {
      participantsCount: Object.keys(extractedTasksData).length
    });
    
    // Step 1: Synchronize with admin panel changes
    const syncResult = await synchronizeWithAdminPanelChanges();
    
    // Step 2: Get all existing active tasks from database
    const { getActiveTasks } = require("./mongoService");
    const allExistingTasks = await getActiveTasks();
    
    // Step 3: Convert structured task data to flat array for easier processing
    const newTasks = convertStructuredTasksToFlat(extractedTasksData);
    
    // Step 4: Process task matching using enhanced algorithm
    const matchingResult = await processTaskMatchingEnhanced(newTasks, allExistingTasks);
    
    // Step 5: Add new task embeddings for future searches
    await addNewTaskEmbeddings(matchingResult.tasksToCreate);
    
    // Get unique participants from new tasks
    const participantNames = [...new Set(newTasks.map(task => task.assignee))];
    
    const result = {
      success: true,
      ...matchingResult,
      synchronization: syncResult,
      metadata: {
        participantsProcessed: participantNames.length,
        existingTasksChecked: allExistingTasks.length,
        vectorDBStats: await getVectorDBStats(),
        processedAt: new Date().toISOString()
      }
    };
    
    logger.info("Enhanced task matching completed", {
      newTasks: matchingResult.summary.newTasks,
      updatedTasks: matchingResult.summary.updatedTasks,
      syncAdded: syncResult.added,
      syncUpdated: syncResult.updated,
      vectorDBAvailable: result.metadata.vectorDBStats.available
    });
    
    return result;
    
  } catch (error) {
    logger.error("Error in enhanced task matching", {
      error: error.message,
      stack: error.stack,
    });
    
    // Fallback to legacy matching
    logger.warn("Falling back to legacy task matching");
    return await matchTasksWithDatabaseLegacy(extractedTasksData);
  }
}

/**
 * Synchronize embeddings with admin panel changes from last 2 days
 * @returns {Promise<Object>} Synchronization result
 */
async function synchronizeWithAdminPanelChanges() {
  try {
    const vectorAvailable = await isVectorDBAvailable();
    if (!vectorAvailable) {
      logger.info("Vector database not available, skipping synchronization");
      return { available: false, added: 0, updated: 0, errors: 0 };
    }
    
    // Get tasks modified in admin panel from last 2 days
    const { getActiveTasks } = require("./mongoService");
    const allTasks = await getActiveTasks();
    
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    
    // Filter tasks that were modified in admin panel recently
    const recentlyModifiedTasks = allTasks.filter(task => {
      if (!task.lastModifiedAp) return false;
      
      const modifiedDate = new Date(task.lastModifiedAp);
      return modifiedDate >= twoDaysAgo;
    });
    
    if (recentlyModifiedTasks.length === 0) {
      logger.info("No recent admin panel modifications found");
      return { available: true, added: 0, updated: 0, errors: 0 };
    }
    
    logger.info("Synchronizing admin panel changes", {
      tasksToSync: recentlyModifiedTasks.length,
      oldestChange: Math.min(...recentlyModifiedTasks.map(t => new Date(t.lastModifiedAp))),
      newestChange: Math.max(...recentlyModifiedTasks.map(t => new Date(t.lastModifiedAp)))
    });
    
    // Synchronize embeddings for these tasks
    const syncResult = await synchronizeEmbeddings(recentlyModifiedTasks);
    
    return {
      available: true,
      ...syncResult
    };
    
  } catch (error) {
    logger.error("Error synchronizing with admin panel changes", {
      error: error.message
    });
    
    return {
      available: false,
      added: 0,
      updated: 0,
      errors: 1,
      error: error.message
    };
  }
}

/**
 * Convert structured task data to flat array
 * @param {Object} extractedTasksData - Structured task data
 * @returns {Array} Flat array of tasks
 */
function convertStructuredTasksToFlat(extractedTasksData) {
  const newTasks = [];
  
  for (const [participantName, participantTasks] of Object.entries(extractedTasksData)) {
    // Process coding tasks
    if (participantTasks.Coding && Array.isArray(participantTasks.Coding)) {
      for (const task of participantTasks.Coding) {
        newTasks.push({
          assignee: participantName,
          description: typeof task === "string" ? task : task.description,
          type: "Coding",
          estimatedTime: typeof task === "object" ? task.estimatedTime : undefined,
          timeTaken: typeof task === "object" ? task.timeTaken : undefined,
          status: typeof task === "object" ? task.status : undefined,
          existingTaskId: typeof task === "object" ? task.existingTaskId : undefined,
          taskType: typeof task === "object" ? task.taskType : undefined
        });
      }
    }
    
    // Process non-coding tasks
    if (participantTasks["Non-Coding"] && Array.isArray(participantTasks["Non-Coding"])) {
      for (const task of participantTasks["Non-Coding"]) {
        newTasks.push({
          assignee: participantName,
          description: typeof task === "string" ? task : task.description,
          type: "Non-Coding",
          estimatedTime: typeof task === "object" ? task.estimatedTime : undefined,
          timeTaken: typeof task === "object" ? task.timeTaken : undefined,
          status: typeof task === "object" ? task.status : undefined,
          existingTaskId: typeof task === "object" ? task.existingTaskId : undefined,
          taskType: typeof task === "object" ? task.taskType : undefined
        });
      }
    }
  }
  
  return newTasks;
}

/**
 * Enhanced task matching process using vector similarity
 * @param {Array} newTasks - Array of new tasks
 * @param {Array} existingTasks - Array of existing tasks
 * @returns {Promise<Object>} Processing result
 */
async function processTaskMatchingEnhanced(newTasks, existingTasks) {
  try {
    logger.info("Starting enhanced task matching process", {
      newTasksCount: newTasks.length,
      existingTasksCount: existingTasks.length,
    });
    
    const results = {
      tasksToCreate: [],
      tasksToUpdate: [],
      summary: {
        newTasks: 0,
        updatedTasks: 0,
        totalProcessed: newTasks.length,
        vectorMatches: 0,
        gptMatches: 0,
        explicitIdMatches: 0
      }
    };
    
    for (const newTask of newTasks) {
      // Get existing tasks for this participant
      const participantExistingTasks = existingTasks.filter(
        task => task.participantName === newTask.assignee
      );
      
      let matchingTask = null;
      let matchMethod = 'none';
      
      // PRIORITY 1: Check if task has explicit task ID (existingTaskId)
      if (newTask.existingTaskId) {
        matchingTask = findTaskByExplicitId(newTask, existingTasks);
        if (matchingTask) {
          matchMethod = 'explicit_id';
          results.summary.explicitIdMatches++;
        }
      }
      
      // PRIORITY 2: If no explicit ID match found, try enhanced similarity matching
      if (!matchingTask) {
        matchingTask = await findMatchingTaskEnhanced(newTask, participantExistingTasks);
        if (matchingTask) {
          matchMethod = matchingTask.matchMethod === 'vector' ? 'vector' : 'gpt';
          if (matchMethod === 'vector') {
            results.summary.vectorMatches++;
          } else {
            results.summary.gptMatches++;
          }
        }
      }
      
      if (matchingTask) {
        // Task match found - prepare update
        const updateData = prepareTaskUpdate(newTask, matchingTask);
        results.tasksToUpdate.push(updateData);
        results.summary.updatedTasks++;
        
        logger.info("Task match found", {
          newTaskDesc: newTask.description.substring(0, 50),
          matchedTaskId: matchingTask.ticketId,
          matchMethod,
          similarity: matchingTask.similarityScore || matchingTask.vectorSimilarity
        });
        
      } else {
        // No match found - create new task
        const newTaskData = prepareNewTask(newTask);
        results.tasksToCreate.push(newTaskData);
        results.summary.newTasks++;
      }
    }
    
    logger.info("Enhanced task matching process completed", {
      newTasksToCreate: results.summary.newTasks,
      existingTasksToUpdate: results.summary.updatedTasks,
      totalProcessed: results.summary.totalProcessed,
      vectorMatches: results.summary.vectorMatches,
      gptMatches: results.summary.gptMatches,
      explicitIdMatches: results.summary.explicitIdMatches
    });
    
    return results;
    
  } catch (error) {
    logger.error("Error in enhanced task matching process", {
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`Enhanced task matching failed: ${error.message}`);
  }
}

/**
 * Add embeddings for newly created tasks
 * @param {Array} newTasks - Array of new tasks to add embeddings for
 * @returns {Promise<void>}
 */
async function addNewTaskEmbeddings(newTasks) {
  try {
    const vectorAvailable = await isVectorDBAvailable();
    if (!vectorAvailable || newTasks.length === 0) {
      return;
    }
    
    logger.info("Adding embeddings for new tasks", {
      tasksCount: newTasks.length
    });
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const task of newTasks) {
      try {
        // Generate a temporary task ID (will be updated later with actual ticket ID)
        const tempTaskId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const text = `${task.title || ''} ${task.description || ''}`.trim();
        if (!text) continue;
        
        const metadata = {
          assignee: task.participantName,
          type: task.type,
          status: task.status || 'To-do',
          title: task.title,
          lastModified: new Date().toISOString()
        };
        
        const success = await addTaskEmbedding(tempTaskId, text, metadata);
        if (success) {
          successCount++;
        } else {
          errorCount++;
        }
        
      } catch (error) {
        logger.error("Error adding embedding for new task", {
          error: error.message,
          task: task.description?.substring(0, 50)
        });
        errorCount++;
      }
    }
    
    logger.info("New task embeddings completed", {
      successCount,
      errorCount,
      totalTasks: newTasks.length
    });
    
  } catch (error) {
    logger.error("Error adding new task embeddings", {
      error: error.message,
      tasksCount: newTasks.length
    });
  }
}

/**
 * ARCHIVED: Original main function (kept for fallback)
 * @param {Object} extractedTasksData - Structured task data from transcript (by participant)
 * @returns {Promise<Object>} Matching results with actions to take
 */
async function matchTasksWithDatabaseLegacy(extractedTasksData) {
  try {
    // Convert structured task data to flat array for easier processing
    const newTasks = [];
    
    for (const [participantName, participantTasks] of Object.entries(extractedTasksData)) {
      // Process coding tasks
      if (participantTasks.Coding && Array.isArray(participantTasks.Coding)) {
        for (const task of participantTasks.Coding) {
          newTasks.push({
            assignee: participantName,
            description: typeof task === "string" ? task : task.description,
            type: "Coding",
            estimatedTime: typeof task === "object" ? task.estimatedTime : undefined,
            timeTaken: typeof task === "object" ? task.timeTaken : undefined,
            status: typeof task === "object" ? task.status : undefined,
            existingTaskId: typeof task === "object" ? task.existingTaskId : undefined,
            taskType: typeof task === "object" ? task.taskType : undefined
          });
        }
      }
      
      // Process non-coding tasks
      if (participantTasks["Non-Coding"] && Array.isArray(participantTasks["Non-Coding"])) {
        for (const task of participantTasks["Non-Coding"]) {
          newTasks.push({
            assignee: participantName,
            description: typeof task === "string" ? task : task.description,
            type: "Non-Coding",
            estimatedTime: typeof task === "object" ? task.estimatedTime : undefined,
            timeTaken: typeof task === "object" ? task.timeTaken : undefined,
            status: typeof task === "object" ? task.status : undefined,
            existingTaskId: typeof task === "object" ? task.existingTaskId : undefined,
            taskType: typeof task === "object" ? task.taskType : undefined
          });
        }
      }
    }
    
    // Get all existing active tasks from database
    const { getActiveTasks } = require("./mongoService");
    const allExistingTasks = await getActiveTasks();
    
    // Process task matching
    const matchingResult = await processTaskMatching(newTasks, allExistingTasks);
    
    // Get unique participants from new tasks
    const participantNames = [...new Set(newTasks.map(task => task.assignee))];
    
    return {
      success: true,
      ...matchingResult,
      metadata: {
        participantsProcessed: participantNames.length,
        existingTasksChecked: allExistingTasks.length,
        processedAt: new Date().toISOString()
      }
    };
    
  } catch (error) {
    logger.error("Error in matchTasksWithDatabase", {
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`Database task matching failed: ${error.message}`);
  }
}

/**
 * Perform fallback similarity check using simple text analysis
 * @param {string} newDescription - New task description
 * @param {string} existingDescription - Existing task description
 * @returns {Object} Fallback similarity result
 */
function performFallbackSimilarityCheck(newDescription, existingDescription) {
  const newWords = tokenizeDescription(newDescription);
  const existingWords = tokenizeDescription(existingDescription);
  
  // Calculate word overlap
  const commonWords = newWords.filter(word => existingWords.includes(word));
  const wordOverlap = commonWords.length / Math.max(newWords.length, existingWords.length);
  
  // Calculate semantic similarity using simple heuristics
  const semanticScore = calculateSemanticSimilarity(newDescription, existingDescription);
  
  // Combine scores
  const confidence = (wordOverlap * 0.6) + (semanticScore * 0.4);
  
  const similarities = commonWords.slice(0, 5); // Top common words
  const differences = [
    ...newWords.filter(word => !existingWords.includes(word)).slice(0, 3),
    ...existingWords.filter(word => !newWords.includes(word)).slice(0, 3)
  ];
  
  return {
    isMatch: confidence >= 0.5,
    confidence: Math.min(confidence, 0.7), // Cap fallback confidence
    reasoning: `Fallback analysis: ${Math.round(wordOverlap * 100)}% word overlap, ${Math.round(semanticScore * 100)}% semantic similarity`,
    similarities,
    differences: differences.slice(0, 5)
  };
}

/**
 * Tokenize task description into meaningful words
 * @param {string} description - Task description
 * @returns {Array} Array of meaningful words
 */
function tokenizeDescription(description) {
  if (!description) return [];
  
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2)
    .filter(word => !['the', 'and', 'for', 'with', 'from', 'this', 'that', 'will', 'need', 'add', 'fix', 'use'].includes(word));
}

/**
 * Calculate semantic similarity using simple heuristics
 * @param {string} desc1 - First description
 * @param {string} desc2 - Second description
 * @returns {number} Similarity score 0-1
 */
function calculateSemanticSimilarity(desc1, desc2) {
  const lower1 = desc1.toLowerCase();
  const lower2 = desc2.toLowerCase();
  
  // Check for key technical terms and action verbs
  const techTerms = ['api', 'database', 'auth', 'login', 'dashboard', 'ui', 'frontend', 'backend', 'component', 'feature'];
  const actionVerbs = ['implement', 'create', 'build', 'develop', 'design', 'fix', 'update', 'refactor', 'optimize'];
  
  let similarity = 0;
  
  // Check common tech terms
  for (const term of techTerms) {
    if (lower1.includes(term) && lower2.includes(term)) {
      similarity += 0.1;
    }
  }
  
  // Check common action verbs
  for (const verb of actionVerbs) {
    if (lower1.includes(verb) && lower2.includes(verb)) {
      similarity += 0.05;
    }
  }
  
  // Check substring containment
  if (lower1.includes(lower2) || lower2.includes(lower1)) {
    similarity += 0.3;
  }
  
  return Math.min(similarity, 1.0);
}

/**
 * Check type compatibility between tasks
 * @param {string} newType - New task type
 * @param {string} existingType - Existing task type
 * @returns {Object} Compatibility result
 */
function checkTypeCompatibility(newType, existingType) {
  if (newType === existingType) {
    return { compatible: true, multiplier: 1.0 };
  }
  
  // Allow cross-type matching with reduced confidence
  // Some coding tasks can become non-coding (documentation) and vice versa
  return { compatible: true, multiplier: 0.8 };
}

/**
 * Get adjusted confidence threshold based on context
 * @param {Object} newTask - New task
 * @param {Array} existingTasks - Existing tasks
 * @returns {number} Adjusted confidence threshold
 */
function getAdjustedConfidenceThreshold(newTask, existingTasks) {
  let threshold = 0.6; // Base threshold
  
  // Lower threshold if there are few existing tasks (more likely to match)
  if (existingTasks.length <= 3) {
    threshold = 0.5;
  }
  
  // Higher threshold for very specific or detailed descriptions
  if (newTask.description.length > 200) {
    threshold = 0.65;
  }
  
  // Lower threshold for short, generic descriptions
  if (newTask.description.length < 50) {
    threshold = 0.55;
  }
  
  return threshold;
}

/**
 * Find task by explicit ID (handles SP-XX format normalization)
 * @param {Object} newTask - New task with existingTaskId
 * @param {Array} existingTasks - Array of all existing tasks
 * @returns {Object|null} Matching task or null
 */
function findTaskByExplicitId(newTask, existingTasks) {
  const normalizedSearchId = normalizeTicketId(newTask.existingTaskId);
  
  const matchingTask = existingTasks.find(task => 
    task.ticketId && normalizeTicketId(task.ticketId) === normalizedSearchId
  );
  
  if (matchingTask) {
    logger.info("Found task by explicit ticket ID", {
      ticketId: newTask.existingTaskId,
      normalizedId: normalizedSearchId,
      matchedTicketId: matchingTask.ticketId,
      taskDescription: newTask.description.substring(0, 50)
    });
  } else {
    logger.warn("Explicit ticket ID mentioned but not found in database", {
      ticketId: newTask.existingTaskId,
      normalizedId: normalizedSearchId,
      availableTicketIds: existingTasks.filter(t => t.ticketId).map(t => t.ticketId),
      taskDescription: newTask.description.substring(0, 50)
    });
  }
  
  return matchingTask;
}

/**
 * Prepare task update data
 * @param {Object} newTask - New task data
 * @param {Object} matchingTask - Existing matching task
 * @returns {Object} Update data structure
 */
function prepareTaskUpdate(newTask, matchingTask) {
  const updateData = {
    originalTask: matchingTask,
    newTaskInfo: newTask,
    updates: {}
  };
  
  // Check if we should add new information as update
  if (newTask.description.toLowerCase().trim() !== matchingTask.description.toLowerCase().trim()) {
    updateData.updates.description = matchingTask.description + 
      `\n\nUpdate: ${newTask.description}`;
  }
  
  // Parse and apply status updates
  let statusUpdate = parseStatusUpdate(newTask.description);
  
  if (newTask.existingTaskId && newTask.status && 
      newTask.status !== "To-do" && newTask.status !== matchingTask.status) {
    statusUpdate = newTask.status;
  }
  
  if (statusUpdate && statusUpdate !== matchingTask.status) {
    updateData.updates.status = statusUpdate;
  }
  
  // Parse and apply time spent updates
  const timeSpent = parseTimeSpent(newTask.description);
  if (timeSpent > 0) {
    updateData.updates.timeTaken = (matchingTask.timeTaken || 0) + timeSpent;
  }
  
  // Parse and apply time estimates (only if not already set)
  if (!matchingTask.estimatedTime || matchingTask.estimatedTime === 0) {
    const timeEstimate = parseTimeEstimate(newTask.description);
    if (timeEstimate > 0) {
      updateData.updates.estimatedTime = timeEstimate;
    }
  }
  
  return updateData;
}

/**
 * Prepare new task data
 * @param {Object} newTask - New task from transcript
 * @returns {Object} New task data structure
 */
function prepareNewTask(newTask) {
  return {
    participantName: newTask.assignee,
    description: newTask.description,
    status: parseStatusUpdate(newTask.description) || "To-do",
    type: newTask.type,
    estimatedTime: parseTimeEstimate(newTask.description),
    timeTaken: parseTimeSpent(newTask.description)
  };
}

module.exports = {
  // ✨ NEW Enhanced Functions
  matchTasksWithDatabaseEnhanced,
  findMatchingTaskEnhanced,
  findMatchingTaskWithVector,
  synchronizeWithAdminPanelChanges,
  processTaskMatchingEnhanced,
  addNewTaskEmbeddings,
  convertStructuredTasksToFlat,
  findTaskByExplicitId,
  prepareTaskUpdate,
  prepareNewTask,
  
  // 📦 ARCHIVED Legacy Functions (kept for fallback)
  matchTasksWithDatabase: matchTasksWithDatabaseLegacy,
  findMatchingTask: findMatchingTaskLegacy,
  checkTaskSimilarityWithGPT,
  parseTimeEstimate,
  parseTimeSpent,
  parseStatusUpdate,
  processTaskMatching,
  performFallbackSimilarityCheck,
  tokenizeDescription,
  calculateSemanticSimilarity,
  checkTypeCompatibility,
  getAdjustedConfidenceThreshold
};
