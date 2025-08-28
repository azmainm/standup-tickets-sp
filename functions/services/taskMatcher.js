/**
 * Task Matching Service - Matches new tasks from transcripts with existing tasks in the database
 * 
 * This service handles:
 * 1. Comparing new tasks with existing active tasks
 * 2. Finding matches based on assignee and task similarity
 * 3. Determining whether to create new tasks or update existing ones
 */

// Note: getActiveTasks is imported within functions to avoid circular dependency issues
const { logger } = require("firebase-functions");
const OpenAI = require('openai');

// Load environment variables
require('dotenv').config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Use GPT to determine if two task descriptions refer to the same task
 * @param {string} newTaskDescription - New task description
 * @param {string} existingTaskDescription - Existing task description
 * @returns {Promise<Object>} Object with isMatch boolean and confidence score
 */
async function checkTaskSimilarityWithGPT(newTaskDescription, existingTaskDescription) {
  try {
    const prompt = `
You are a task management expert. Please analyze whether these two task descriptions refer to the same task or different tasks.

Task 1 (New): "${newTaskDescription}"
Task 2 (Existing): "${existingTaskDescription}"

Consider:
1. Are they describing the same feature/functionality?
2. Are they part of the same project component?
3. Could one be an update/continuation of the other?
4. Are they just different ways of describing the same work?

Respond with ONLY a JSON object in this exact format:
{
  "isMatch": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

Examples:
- "Implement user login" vs "Add authentication system" → isMatch: true, confidence: 0.8
- "Build payment gateway" vs "Fix login bug" → isMatch: false, confidence: 0.9
- "Create admin dashboard" vs "Add user management to admin panel" → isMatch: true, confidence: 0.7
`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a precise task analysis expert. Always respond with valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 200,
    });

    const responseText = response.choices[0].message.content.trim();
    
    // Parse the JSON response
    const result = JSON.parse(responseText);
    
    logger.info('GPT task similarity check completed', {
      newTask: newTaskDescription.substring(0, 50),
      existingTask: existingTaskDescription.substring(0, 50),
      isMatch: result.isMatch,
      confidence: result.confidence,
      reasoning: result.reasoning
    });
    
    return {
      isMatch: result.isMatch,
      confidence: result.confidence,
      reasoning: result.reasoning || 'No reasoning provided'
    };
    
  } catch (error) {
    logger.error('Error in GPT task similarity check', {
      error: error.message,
      newTask: newTaskDescription.substring(0, 50),
      existingTask: existingTaskDescription.substring(0, 50)
    });
    
    // Fallback to simple word-based similarity
    return {
      isMatch: false,
      confidence: 0.0,
      reasoning: 'GPT check failed, defaulting to no match'
    };
  }
}

/**
 * Find matching existing task for a new task using GPT
 * @param {Object} newTask - New task from transcript
 * @param {Array} existingTasks - Array of existing active tasks for the participant
 * @returns {Promise<Object|null>} Matching task or null if no match found
 */
async function findMatchingTask(newTask, existingTasks) {
  if (!existingTasks || existingTasks.length === 0) {
    return null;
  }
  
  let bestMatch = null;
  let bestConfidence = 0;
  
  // Minimum confidence threshold for considering a match
  const CONFIDENCE_THRESHOLD = 0.6;
  
  for (const existingTask of existingTasks) {
    // Only match tasks of the same type (Coding vs Non-Coding)
    if (existingTask.type !== newTask.type) {
      continue;
    }
    
    try {
      const similarityResult = await checkTaskSimilarityWithGPT(
        newTask.description, 
        existingTask.description
      );
      
      if (similarityResult.isMatch && 
          similarityResult.confidence > bestConfidence && 
          similarityResult.confidence >= CONFIDENCE_THRESHOLD) {
        bestConfidence = similarityResult.confidence;
        bestMatch = {
          ...existingTask,
          similarityScore: similarityResult.confidence,
          reasoning: similarityResult.reasoning
        };
      }
    } catch (error) {
      logger.error('Error checking task similarity', {
        error: error.message,
        newTask: newTask.description.substring(0, 50),
        existingTask: existingTask.description.substring(0, 50)
      });
      // Continue with next task if one fails
      continue;
    }
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
    .replace(/\s+/g, '') // Remove all spaces: "SP 12" -> "SP12"
    .toUpperCase()       // Convert to uppercase: "sp4" -> "SP4"
    .replace(/^(SP)(\d+)$/, '$1-$2'); // Add dash if missing: "SP3" -> "SP-3"
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
  if (lowerText.includes('completed') || 
      lowerText.includes('finished') || 
      lowerText.includes('done with') ||
      lowerText.includes('is done') ||
      lowerText.includes('have completed')) {
    return 'Completed';
  }
  
  // Check for in-progress indicators
  if (lowerText.includes('started') || 
      lowerText.includes('working on') || 
      lowerText.includes('begun') ||
      lowerText.includes('in progress') ||
      lowerText.includes('currently') ||
      lowerText.includes('am working')) {
    return 'In-progress';
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
    logger.info('Starting task matching process', {
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
          logger.info('Found task by explicit ticket ID', {
            ticketId: newTask.existingTaskId,
            normalizedId: normalizedSearchId,
            matchedTicketId: matchingTask.ticketId,
            taskDescription: newTask.description.substring(0, 50)
          });
        } else {
          logger.warn('Explicit ticket ID mentioned but not found in database', {
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
            newTask.status !== 'To-do' && newTask.status !== matchingTask.status) {
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
          status: parseStatusUpdate(newTask.description) || 'To-do',
          type: newTask.type,
          estimatedTime: parseTimeEstimate(newTask.description),
          timeTaken: parseTimeSpent(newTask.description)
        };
        
        results.tasksToCreate.push(newTaskData);
        results.summary.newTasks++;
      }
    }
    
    logger.info('Task matching completed', {
      newTasksToCreate: results.summary.newTasks,
      existingTasksToUpdate: results.summary.updatedTasks,
      totalProcessed: results.summary.totalProcessed,
    });
    
    return results;
    
  } catch (error) {
    logger.error('Error in task matching process', {
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`Task matching failed: ${error.message}`);
  }
}

/**
 * Main function to match new tasks from transcript with existing database tasks
 * @param {Object} extractedTasksData - Structured task data from transcript (by participant)
 * @returns {Promise<Object>} Matching results with actions to take
 */
async function matchTasksWithDatabase(extractedTasksData) {
  try {
    // Convert structured task data to flat array for easier processing
    const newTasks = [];
    
    for (const [participantName, participantTasks] of Object.entries(extractedTasksData)) {
      // Process coding tasks
      if (participantTasks.Coding && Array.isArray(participantTasks.Coding)) {
        for (const task of participantTasks.Coding) {
          newTasks.push({
            assignee: participantName,
            description: typeof task === 'string' ? task : task.description,
            type: 'Coding',
            estimatedTime: typeof task === 'object' ? task.estimatedTime : undefined,
            timeTaken: typeof task === 'object' ? task.timeTaken : undefined,
            status: typeof task === 'object' ? task.status : undefined,
            existingTaskId: typeof task === 'object' ? task.existingTaskId : undefined,
            taskType: typeof task === 'object' ? task.taskType : undefined
          });
        }
      }
      
      // Process non-coding tasks
      if (participantTasks['Non-Coding'] && Array.isArray(participantTasks['Non-Coding'])) {
        for (const task of participantTasks['Non-Coding']) {
          newTasks.push({
            assignee: participantName,
            description: typeof task === 'string' ? task : task.description,
            type: 'Non-Coding',
            estimatedTime: typeof task === 'object' ? task.estimatedTime : undefined,
            timeTaken: typeof task === 'object' ? task.timeTaken : undefined,
            status: typeof task === 'object' ? task.status : undefined,
            existingTaskId: typeof task === 'object' ? task.existingTaskId : undefined,
            taskType: typeof task === 'object' ? task.taskType : undefined
          });
        }
      }
    }
    
    // Get all existing active tasks from database
    const { getActiveTasks } = require('./mongoService');
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
    logger.error('Error in matchTasksWithDatabase', {
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`Database task matching failed: ${error.message}`);
  }
}

module.exports = {
  matchTasksWithDatabase,
  findMatchingTask,
  checkTaskSimilarityWithGPT,
  parseTimeEstimate,
  parseTimeSpent,
  parseStatusUpdate,
  processTaskMatching,
};
