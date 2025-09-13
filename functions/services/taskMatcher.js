/**
 * Simplified Task Matching Service - Basic Task Processing Without Similarity Search
 * 
 * This service handles:
 * 1. Explicit ticket ID matching only (e.g., "SP-123" mentioned in transcript)
 * 2. Simple task creation for non-matching tasks
 * 3. Basic task updates for explicit matches
 * 4. No similarity search or complex matching logic
 * 
 * REMOVED: All similarity search, vector search, and GPT-based matching
 */

const { logger } = require("firebase-functions");

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
 * Find task by explicit ticket ID only (no similarity search)
 * @param {Object} newTask - New task with existingTaskId
 * @param {Array} existingTasks - Array of all existing tasks
 * @returns {Object|null} Matching task or null
 */
function findTaskByExplicitId(newTask, existingTasks) {
  if (!newTask.existingTaskId) {
    return null;
  }
  
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
 * Simple task matching process - EXPLICIT ID MATCHING ONLY
 * @param {Array} newTasks - Array of new tasks
 * @param {Array} existingTasks - Array of existing tasks
 * @returns {Promise<Object>} Processing result
 */
async function processSimpleTaskMatching(newTasks, existingTasks) {
  try {
    logger.info("Starting simple task matching process (explicit ID only)", {
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
        explicitIdMatches: 0
      }
    };
    
    for (const newTask of newTasks) {
      let matchingTask = null;
      
      // ONLY explicit ticket ID matching (e.g., "SP-123" mentioned in transcript)
      if (newTask.existingTaskId) {
        matchingTask = findTaskByExplicitId(newTask, existingTasks);
        if (matchingTask) {
          results.summary.explicitIdMatches++;
        }
      }
      
      if (matchingTask) {
        // Task match found - prepare update
        const updateData = prepareTaskUpdate(newTask, matchingTask);
        results.tasksToUpdate.push(updateData);
        results.summary.updatedTasks++;
        
        logger.info("Task match found via explicit ID", {
          newTaskDesc: newTask.description.substring(0, 50),
          matchedTaskId: matchingTask.ticketId,
          method: 'explicit_id'
        });
        
      } else {
        // No explicit match found - create new task
        const newTaskData = prepareNewTask(newTask);
        results.tasksToCreate.push(newTaskData);
        results.summary.newTasks++;
      }
    }
    
    logger.info("Simple task matching process completed", {
      newTasksToCreate: results.summary.newTasks,
      existingTasksToUpdate: results.summary.updatedTasks,
      totalProcessed: results.summary.totalProcessed,
      explicitIdMatches: results.summary.explicitIdMatches
    });
    
    return results;
    
  } catch (error) {
    logger.error("Error in simple task matching process", {
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`Simple task matching failed: ${error.message}`);
  }
}

/**
 * Main function to match tasks with database - SIMPLIFIED (no similarity search)
 * @param {Object} extractedTasksData - Structured task data from transcript (by participant)
 * @returns {Promise<Object>} Matching results with actions to take
 */
async function matchTasksWithDatabase(extractedTasksData) {
  try {
    logger.info("Starting simple task matching (no similarity search)", {
      participantsCount: Object.keys(extractedTasksData).length
    });
    
    // Get all existing active tasks from database
    const { getActiveTasks } = require("./mongoService");
    const allExistingTasks = await getActiveTasks();
    
    // Convert structured task data to flat array for easier processing
    const newTasks = convertStructuredTasksToFlat(extractedTasksData);
    
    // Process task matching using simple explicit ID matching only
    const matchingResult = await processSimpleTaskMatching(newTasks, allExistingTasks);
    
    // Get unique participants from new tasks
    const participantNames = [...new Set(newTasks.map(task => task.assignee))];
    
    const result = {
      success: true,
      ...matchingResult,
      metadata: {
        participantsProcessed: participantNames.length,
        existingTasksChecked: allExistingTasks.length,
        processedAt: new Date().toISOString(),
        matchingMethod: 'explicit_id_only'
      }
    };
    
    logger.info("Simple task matching completed", {
      newTasks: matchingResult.summary.newTasks,
      updatedTasks: matchingResult.summary.updatedTasks,
      explicitIdMatches: matchingResult.summary.explicitIdMatches
    });
    
    return result;
    
  } catch (error) {
    logger.error("Error in simple task matching", {
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`Database task matching failed: ${error.message}`);
  }
}

module.exports = {
  // Main functions
  matchTasksWithDatabase,
  processSimpleTaskMatching,
  convertStructuredTasksToFlat,
  findTaskByExplicitId,
  prepareTaskUpdate,
  prepareNewTask,
  
  // Utility functions
  parseTimeEstimate,
  parseTimeSpent,
  parseStatusUpdate,
  normalizeTicketId
};