/**
 * Task Updater Service - Stage 3 of 3-Stage Pipeline
 * 
 * This service implements the Task Updater role, focusing on systematic enhancement
 * of existing tasks with new information from meeting discussions.
 * 
 * Role: Task Updater
 * - Epistemic stance: Systematic
 * - Communication style: Clear, concise, structured, neutral
 * - Values: Clarity, efficiency
 * - Domain: Scrum
 */

const OpenAI = require("openai");
const { logger } = require("firebase-functions");
const {
  findSimilarTasks,
  isVectorDBAvailable
} = require("./vectorService");
const { detectStatusChangesFromTranscript } = require("./statusChangeDetectionService");

// Load environment variables
require("dotenv").config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Stage 3: Update existing tasks with new information
 * @param {Array} foundTasks - Tasks from Stage 1 (Task Finder)
 * @param {Array} skippedTasks - Tasks not created in Stage 2
 * @param {Array} existingTasks - Current active tasks in database
 * @param {Array} transcript - Original transcript for status change detection
 * @param {Object} context - Processing context
 * @returns {Promise<Object>} Task updates to be applied
 */
async function updateExistingTasks(foundTasks, skippedTasks, existingTasks, transcript, context = {}) {
  try {
    // Filter for tasks marked as UPDATE_TASK by Task Finder
    const updateTasksFromFinder = foundTasks.filter(task => 
      task.category === "UPDATE_TASK" && task.ticketId !== "NONE"
    );
    
    console.log("[DEBUG] Task Updater filtering:", {
      totalFound: foundTasks.length,
      updateTasks: updateTasksFromFinder.length,
      ticketIds: updateTasksFromFinder.map(t => t.ticketId)
    });
    
    logger.info("Starting Stage 3: Task Updater", {
      foundTasksCount: foundTasks.length,
      updateTasksFromFinder: updateTasksFromFinder.length,
      skippedTasksCount: skippedTasks.length,
      existingTasksCount: existingTasks.length,
      transcriptIndex: context.transcriptIndex || 1,
      isMultiTranscript: Boolean(context.isMultiTranscript),
      timestamp: new Date().toISOString(),
    });

    const taskUpdates = [];
    const statusChanges = [];

    // Detect status changes from transcript
    const detectedStatusChanges = detectStatusChangesFromTranscript(transcript);
    
    // Process status changes first
    for (const statusChange of detectedStatusChanges) {
      const existingTask = existingTasks.find(task => 
        task.ticketId === statusChange.taskId
      );
      
      if (existingTask) {
        statusChanges.push({
          taskId: statusChange.taskId,
          oldStatus: existingTask.status,
          newStatus: statusChange.newStatus,
          confidence: statusChange.confidence,
          speaker: statusChange.speaker,
          evidence: statusChange.evidence
        });
      }
    }

    // Process skipped tasks (these might be updates to existing tasks)
    // Process UPDATE_TASK items from Task Finder (direct ticket ID lookup)
    for (const updateTask of updateTasksFromFinder) {
      const existingTask = existingTasks.find(task => 
        task.ticketId === updateTask.ticketId
      );
      
      if (existingTask) {
        console.log(`[DEBUG] Updating task ${updateTask.ticketId} directly from Task Finder`);
        
        // Generate detailed update description using transcript context  
        const detailedUpdate = generateDetailedUpdateDescription(updateTask);
        
        taskUpdates.push({
          taskId: updateTask.ticketId,
          originalDescription: existingTask.description,
          newInformation: detailedUpdate,
          updateType: "PROGRESS_UPDATE",
          updateSource: "TASK_FINDER_DIRECT",
          confidence: 1.0,
          evidence: updateTask.evidence,
          speaker: updateTask.assignee,
          context: updateTask.context,
          timestamp: new Date().toISOString()
        });
      } else {
        console.log(`[DEBUG] Task ${updateTask.ticketId} not found in database for update`);
      }
    }

    // No similarity search needed - Task Finder already identified UPDATE_TASK items with explicit ticket IDs
    // All necessary updates are handled above in the UPDATE_TASK processing section
    console.log("[DEBUG] Task Updater: Skipping similarity search - using only explicit ticket ID updates from Task Finder");

    logger.info("Stage 3: Task Updater completed successfully", {
      taskUpdatesCount: taskUpdates.length,
      statusChangesCount: statusChanges.length,
      transcriptIndex: context.transcriptIndex || 1
    });

    return {
      success: true,
      stage: 3,
      taskUpdates,
      statusChanges,
      metadata: {
        taskUpdatesCount: taskUpdates.length,
        statusChangesCount: statusChanges.length,
        processedAt: new Date().toISOString(),
        transcriptIndex: context.transcriptIndex || 1
      }
    };

  } catch (error) {
    logger.error("Stage 3: Task Updater failed", {
      error: error.message,
      stack: error.stack,
      foundTasksCount: foundTasks.length,
      skippedTasksCount: skippedTasks.length,
      existingTasksCount: existingTasks.length,
      transcriptIndex: context.transcriptIndex || 1
    });
    
    throw new Error(`Task Updater (Stage 3) failed: ${error.message}`);
  }
}


/**
 * Create system prompt for Task Updater role
 * @param {Object} context - Processing context
 * @returns {string} System prompt
 */
function createTaskUpdaterSystemPrompt(context) {
  const roleDescription = `You are a Task Updater with the following identity:

**Role Identity**: Task Updater
- **Epistemic stance**: Systematic
- **Communication style**: Clear, concise, structured, neutral
- **Values and priorities**: Clarity, efficiency
- **Domain orientation**: Scrum

**Constraints**:
- Avoid prescriptive solutions and speculative or vague language
- Focus on structured and transparent framing of work items
- Maintain neutrality in all decisions

**Core Purpose**: Systematically enhance existing tasks with new information while maintaining clarity and efficiency. Ensure updates are understandable and aligned without introducing ambiguity.`;

  let contextualAddition = "";
  if (context.isMultiTranscript) {
    contextualAddition = `

**Multi-Transcript Context**:
- This is transcript ${context.transcriptIndex} of ${context.totalTranscripts}
- Focus on factual updates based on new evidence
- Maintain systematic approach to task enhancement`;
  }

  return roleDescription + contextualAddition;
}

/**
 * Create prompt for task update decision
 * @param {Object} skippedTask - Task that wasn't created
 * @param {Object} similarTask - Similar existing task
 * @param {Object} context - Processing context
 * @returns {string} Update decision prompt
 */
function createTaskUpdateDecisionPrompt(skippedTask, similarTask, context) {
  return `
**OBJECTIVE**: Determine if and how an existing task should be updated with new information from a meeting discussion.

**NEW INFORMATION FROM MEETING**:
- Description: "${skippedTask.description}"
- Context: "${skippedTask.context}"
- Evidence: "${skippedTask.evidence}"
- Assignee: ${skippedTask.assignee}

**EXISTING TASK**:
- Description: "${similarTask.metadata.text}"
- Status: ${similarTask.metadata.status}
- Current Assignee: ${similarTask.metadata.assignee}
- Ticket ID: ${similarTask.metadata.taskId}

**UPDATE DECISION CRITERIA**:

**UPDATE TYPES**:
1. **DESCRIPTION_ENHANCEMENT** - Add new details, requirements, or context
2. **SCOPE_CLARIFICATION** - Clarify or refine the task scope
3. **PROGRESS_UPDATE** - Add progress information or current status
4. **REQUIREMENT_ADDITION** - Add new requirements or constraints
5. **NONE** - No update needed

**SHOULD UPDATE if**:
- The new information adds valuable context or details
- Requirements or scope have been clarified or expanded
- Progress or status information is provided
- Technical details or constraints are mentioned

**SHOULD NOT UPDATE if**:
- The information is already covered in the existing description
- The new information contradicts the existing task purpose
- The information is too vague or speculative
- It would make the task description unclear

**RESPONSE FORMAT**:
SHOULD_UPDATE: [YES/NO]
UPDATE_TYPE: [DESCRIPTION_ENHANCEMENT/SCOPE_CLARIFICATION/PROGRESS_UPDATE/REQUIREMENT_ADDITION/NONE]
NEW_INFORMATION: [Specific information to add to the task]
CONFIDENCE: [0.0-1.0]
REASONING: [Clear explanation of decision]

**YOUR ANALYSIS**:`;
}

/**
 * Create prompt for explicit task update decision
 * @param {Object} foundTask - Task with explicit reference
 * @param {Object} existingTask - Referenced existing task
 * @param {Object} context - Processing context
 * @returns {string} Explicit update decision prompt
 */
function createExplicitUpdateDecisionPrompt(foundTask, existingTask, context) {
  return `
**OBJECTIVE**: Determine how to update an existing task that was explicitly referenced in the meeting.

**EXPLICIT REFERENCE FROM MEETING**:
- Description: "${foundTask.description}"
- Context: "${foundTask.context}"
- Evidence: "${foundTask.evidence}"

**EXISTING TASK BEING REFERENCED**:
- Description: "${existingTask.text}"
- Status: ${existingTask.status}
- Ticket ID: ${existingTask.taskId}

**EXPLICIT UPDATE ANALYSIS**:
Since this task was explicitly mentioned, determine what new information should be added.

**UPDATE TYPES**:
1. **DESCRIPTION_ENHANCEMENT** - Add new details or context
2. **SCOPE_CLARIFICATION** - Clarify the actual scope
3. **PROGRESS_UPDATE** - Add progress or status information
4. **REQUIREMENT_ADDITION** - Add new requirements
5. **STATUS_CHANGE** - Status change is handled separately

**RESPONSE FORMAT**:
SHOULD_UPDATE: [YES/NO]
UPDATE_TYPE: [DESCRIPTION_ENHANCEMENT/SCOPE_CLARIFICATION/PROGRESS_UPDATE/REQUIREMENT_ADDITION/NONE]
NEW_INFORMATION: [Information to add to the existing task description]
CONFIDENCE: [0.0-1.0]
REASONING: [Explanation of what should be updated and why]

**YOUR ANALYSIS**:`;
}

/**
 * Parse GPT update decision response
 * @param {string} response - GPT response
 * @returns {Object} Parsed update decision
 */
function parseUpdateDecision(response) {
  try {
    const lines = response.split('\n').map(line => line.trim()).filter(line => line);
    
    let shouldUpdate = false;
    let updateType = "none";
    let newInformation = "";
    let confidence = 0.0;
    let reasoning = "Unable to parse decision";
    
    for (const line of lines) {
      if (line.startsWith('SHOULD_UPDATE:')) {
        const decision = line.replace('SHOULD_UPDATE:', '').trim();
        shouldUpdate = decision.toUpperCase() === "YES";
      } else if (line.startsWith("UPDATE_TYPE:")) {
        updateType = line.replace("UPDATE_TYPE:", "").trim().toLowerCase();
      } else if (line.startsWith("NEW_INFORMATION:")) {
        newInformation = line.replace("NEW_INFORMATION:", "").trim();
      } else if (line.startsWith("CONFIDENCE:")) {
        const confStr = line.replace("CONFIDENCE:", "").trim();
        const confMatch = confStr.match(/(\d+(?:\.\d+)?)/);
        if (confMatch) {
          confidence = Math.max(0, Math.min(1, parseFloat(confMatch[1])));
        }
      } else if (line.startsWith("REASONING:")) {
        reasoning = line.replace("REASONING:", "").trim();
      }
    }
    
    return { shouldUpdate, updateType, newInformation, confidence, reasoning };
    
  } catch (error) {
    logger.error("Error parsing update decision", {
      error: error.message,
      response: response.substring(0, 200)
    });
    
    return {
      shouldUpdate: false,
      updateType: "none",
      newInformation: "",
      confidence: 0.0,
      reasoning: "Failed to parse decision"
    };
  }
}

/**
 * Check if task description contains explicit task ID references
 * @param {string} description - Task description
 * @returns {string|null} Task ID if found, null otherwise
 */
function checkForExplicitTaskId(description) {
  if (!description) return null;
  
  // Look for SP-XX, SP XX, SPXX patterns
  const taskIdPattern = /\b(SP[-\s]?\d+)\b/i;
  const match = description.match(taskIdPattern);
  
  if (match) {
    // Normalize to SP-XX format
    return match[1].replace(/\s+/g, "").toUpperCase().replace(/^(SP)(\d+)$/, "$1-$2");
  }
  
  return null;
}

/**
 * Generate detailed update description using task context
 * @param {Object} updateTask - Update task from Task Finder
 * @returns {string} Detailed update description
 */
function generateDetailedUpdateDescription(updateTask) {
  try {
    // Combine the basic description with context and evidence for a fuller update
    const detailedUpdate = `${updateTask.description}. ${updateTask.context} ${updateTask.evidence ? `Evidence: "${updateTask.evidence}"` : ''}`.trim();
    
    logger.info("Task update description generated", {
      ticketId: updateTask.ticketId,
      originalLength: updateTask.description.length,
      enhancedLength: detailedUpdate.length
    });
    
    return detailedUpdate;
    
  } catch (error) {
    logger.error("Error generating detailed update description", {
      error: error.message,
      ticketId: updateTask.ticketId,
      taskSummary: updateTask.description.substring(0, 50)
    });
    
    // Return original description if generation fails
    return updateTask.description;
  }
}

/**
 * LEGACY: Find and create updates for tasks that were skipped in Stage 2
 * NOTE: This function is no longer used in the current pipeline after removing similarity search
 * @param {Object} skippedTask - Task that wasn't created
 * @param {Array} existingTasks - Current active tasks
 * @param {Object} context - Processing context
 * @returns {Promise<Array>} Array of task updates
 */
async function findAndCreateTaskUpdates(skippedTask, existingTasks, context) {
  try {
    // Debug: log skipped task fully
    logger.info("Stage 3: Processing skipped task for potential updates", {
      skippedTaskFull: skippedTask
    });
    console.log("[Updater] Processing skipped task", { skippedTaskFull: skippedTask });

    // Find the most similar existing task
    const similarTasks = await findSimilarTasksForUpdate(skippedTask, existingTasks);
    
    if (similarTasks.length === 0) {
      return [];
    }

    // Debug: log first few matches fully
    try {
      const sampleFull = (similarTasks || []).slice(0, 3).map((m, idx) => ({
        index: idx,
        similarity: m.similarity,
        metadata: m.metadata
      }));
      logger.info("Stage 3: Similar tasks (full sample)", { sampleFull });
      console.log("[Updater] Similar tasks (full sample)", { sampleFull });
    } catch (e) {
      logger.warn("Stage 3: Failed to log similar tasks (full sample)", { error: e.message });
    }

    const updates = [];
    
    // For each similar task, determine what updates should be made
    for (const similarTask of similarTasks.slice(0, 3)) { // Limit to top 3 matches
      const updateDecision = await determineTaskUpdateWithGPT(
        skippedTask, 
        similarTask, 
        context
      );
      
      if (updateDecision.shouldUpdate) {
        updates.push({
          taskId: similarTask.metadata.taskId,
          existingTask: similarTask.metadata,
          updateType: updateDecision.updateType,
          newInformation: updateDecision.newInformation,
          confidence: updateDecision.confidence,
          reasoning: updateDecision.reasoning,
          source: skippedTask,
          stage: 3
        });
      }
    }
    
    return updates;

  } catch (error) {
    logger.error("Error finding task updates", {
      error: error.message,
      skippedTask: skippedTask.description.substring(0, 50)
    });
    return [];
  }
}

/**
 * LEGACY: Create update for task with explicit ID reference
 * NOTE: This function is no longer used after removing separate GPT enhancement calls
 * @param {Object} foundTask - Task with explicit ID reference
 * @param {string} taskId - Referenced task ID
 * @param {Array} existingTasks - Current active tasks
 * @param {Object} context - Processing context
 * @returns {Promise<Object|null>} Task update or null
 */
async function createExplicitTaskUpdate(foundTask, taskId, existingTasks, context) {
  try {
    const existingTask = existingTasks.find(task => 
      task.ticketId === taskId
    );
    
    if (!existingTask) {
      logger.warn("Explicit task ID referenced but not found", {
        taskId,
        foundTask: foundTask.description.substring(0, 50)
      });
      return null;
    }

    // Determine what kind of update this is
    const updateDecision = await determineExplicitUpdateWithGPT(
      foundTask, 
      existingTask, 
      context
    );
    
    if (updateDecision.shouldUpdate) {
      return {
        taskId: taskId,
        existingTask: existingTask,
        updateType: updateDecision.updateType,
        newInformation: updateDecision.newInformation,
        confidence: updateDecision.confidence,
        reasoning: updateDecision.reasoning,
        source: foundTask,
        stage: 3,
        isExplicitReference: true
      };
    }
    
    return null;

  } catch (error) {
    logger.error("Error creating explicit task update", {
      error: error.message,
      taskId,
      foundTask: foundTask.description.substring(0, 50)
    });
    return null;
  }
}

/**
 * LEGACY: Find similar tasks for update consideration using vector database
 * NOTE: This function is no longer used after removing similarity search from pipeline
 * @param {Object} skippedTask - Task that wasn't created
 * @param {Array} existingTasks - Current active tasks
 * @returns {Promise<Array>} Similar tasks
 */
async function findSimilarTasksForUpdate(skippedTask, existingTasks) {
  try {
    const vectorAvailable = await isVectorDBAvailable();
    
    if (!vectorAvailable) {
      return [];
    }

    // Search for similar tasks
    const queryText = skippedTask.description;
    const searchContext = {
      assignee: skippedTask.assignee,
      type: skippedTask.type
    };

    // Debug: input to vector search
    logger.info("Stage 3: Vector search input (update)", {
      queryPreview: queryText.substring(0, 300),
      searchContext
    });
    console.log("[Updater] Vector search input", {
      queryPreview: queryText.substring(0, 300),
      searchContext
    });

    const similarTasks = await findSimilarTasks(queryText, searchContext, 5, 0.6);
    
    // Filter to tasks from the same assignee (original behavior)
    const relevantMatches = (similarTasks || []).filter(similar => 
      similar.metadata.assignee === skippedTask.assignee
    );

    // Detailed logs for raw and filtered
    try {
      logger.info("Stage 3: Vector raw results (count only)", {
        rawCount: Array.isArray(similarTasks) ? similarTasks.length : 0
      });
      console.log("[Updater] Vector raw results (count)", {
        rawCount: Array.isArray(similarTasks) ? similarTasks.length : 0
      });
      const rawSample = (similarTasks || []).slice(0, 5).map((m, idx) => ({
        index: idx,
        keys: m ? Object.keys(m) : [],
        hasMetadata: Boolean(m && m.metadata),
        metadataKeys: m && m.metadata ? Object.keys(m.metadata) : [],
        similarity: m && typeof m.similarity === 'number' ? m.similarity : null
      }));
      logger.info("Stage 3: Vector raw sample (first 5)", { rawSample });
      console.log("[Updater] Vector raw sample (first 5)", { rawSample });
      const filteredSample = (relevantMatches || []).slice(0, 5).map((m, idx) => ({
        index: idx,
        similarity: m.similarity,
        metadata: m.metadata
      }));
      logger.info("Stage 3: Vector filtered sample (first 5)", { filteredSample });
      console.log("[Updater] Vector filtered sample (first 5)", { filteredSample });
    } catch (e) {
      logger.warn("Stage 3: Failed to log vector samples", { error: e.message });
    }

    return relevantMatches;

  } catch (error) {
    logger.error("Error finding similar tasks for update", {
      error: error.message,
      skippedTask: skippedTask.description.substring(0, 50)
    });
    return [];
  }
}

/**
 * LEGACY: Use GPT to determine what updates should be made to an existing task
 * NOTE: This function is no longer used after removing similarity search from pipeline
 * @param {Object} skippedTask - Task that wasn't created
 * @param {Object} similarTask - Similar existing task
 * @param {Object} context - Processing context
 * @returns {Promise<Object>} Update decision
 */
async function determineTaskUpdateWithGPT(skippedTask, similarTask, context) {
  try {
    // Extremely detailed logs before using fields
    logger.info("Stage 3: Update decision inputs", {
      skippedTaskFull: skippedTask,
      similarTaskFull: similarTask,
      similarTaskMetadata: similarTask ? similarTask.metadata : undefined
    });
    console.log("[Updater] Update decision inputs", {
      skippedTaskFull: skippedTask,
      similarTaskFull: similarTask,
      similarTaskMetadata: similarTask ? similarTask.metadata : undefined
    });

    const prompt = createTaskUpdateDecisionPrompt(skippedTask, similarTask, context);

    logger.info("Stage 3: GPT update decision prompt", {
      promptChars: prompt.length,
      promptPreview: prompt.substring(0, 1000)
    });
    console.log("[Updater] GPT prompt", {
      promptChars: prompt.length,
      promptPreview: prompt.substring(0, 1000)
    });
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: createTaskUpdaterSystemPrompt(context)
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 600,
    });

    const gptResponse = response.choices[0].message.content;

    logger.info("Stage 3: GPT update decision raw response", {
      responseChars: gptResponse ? gptResponse.length : 0,
      responsePreview: gptResponse ? gptResponse.substring(0, 1000) : undefined
    });
    console.log("[Updater] GPT response", {
      responseChars: gptResponse ? gptResponse.length : 0,
      responsePreview: gptResponse ? gptResponse.substring(0, 1000) : undefined
    });

    const decision = parseUpdateDecision(gptResponse);
    
    logger.info("GPT update decision made", {
      skippedTask: skippedTask.description.substring(0, 50),
      existingTask: similarTask.metadata.text.substring(0, 50),
      shouldUpdate: decision.shouldUpdate,
      updateType: decision.updateType,
      confidence: decision.confidence
    });

    return decision;

  } catch (error) {
    logger.error("Error in GPT update decision", {
      error: error.message,
      skippedTask: skippedTask.description.substring(0, 50),
      similarTaskDump: similarTask
    });
    console.log("[Updater] Error in GPT update decision", {
      error: error.message,
      skippedTask: skippedTask.description.substring(0, 50),
      similarTaskDump: similarTask
    });
    
    return {
      shouldUpdate: false,
      updateType: "none",
      newInformation: "",
      confidence: 0.0,
      reasoning: "GPT decision failed"
    };
  }
}

/**
 * LEGACY: Use GPT to determine updates for explicit task references
 * NOTE: This function is no longer used after removing separate GPT enhancement calls
 * @param {Object} foundTask - Task with explicit reference
 * @param {Object} existingTask - Referenced existing task
 * @param {Object} context - Processing context
 * @returns {Promise<Object>} Update decision
 */
async function determineExplicitUpdateWithGPT(foundTask, existingTask, context) {
  try {
    const prompt = createExplicitUpdateDecisionPrompt(foundTask, existingTask, context);
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: createTaskUpdaterSystemPrompt(context)
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 600,
    });

    const gptResponse = response.choices[0].message.content;
    const decision = parseUpdateDecision(gptResponse);
    
    return decision;

  } catch (error) {
    logger.error("Error in explicit GPT update decision", {
      error: error.message,
      foundTask: foundTask.description.substring(0, 50)
    });
    
    return {
      shouldUpdate: false,
      updateType: "none",
      newInformation: "",
      confidence: 0.0,
      reasoning: "GPT decision failed"
    };
  }
}


/**
 * LEGACY: Test Task Updater service
 * NOTE: This function is no longer used - tests should be run using dedicated test files
 * @returns {Promise<boolean>} True if service is working
 */
async function testTaskUpdaterService() {
  try {
    const foundTasks = [];
    const skippedTasks = [];
    const existingTasks = [];
    const transcript = [];
    
    const result = await updateExistingTasks(foundTasks, skippedTasks, existingTasks, transcript);
    return result.success;
  } catch (error) {
    logger.error("Task Updater service test failed", { error: error.message });
    return false;
  }
}



module.exports = {
  updateExistingTasks,
  testTaskUpdaterService,
  findAndCreateTaskUpdates,
  createExplicitTaskUpdate,
  determineTaskUpdateWithGPT,
  determineExplicitUpdateWithGPT,
  checkForExplicitTaskId,
  parseUpdateDecision,
  createTaskUpdaterSystemPrompt,
  createTaskUpdateDecisionPrompt,
  createExplicitUpdateDecisionPrompt,
  generateDetailedUpdateDescription
};
