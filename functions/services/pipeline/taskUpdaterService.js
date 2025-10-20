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

const { ChatOpenAI } = require("@langchain/openai");
const { logger } = require("firebase-functions");
const { detectStatusChangesFromTranscript } = require("../utilities/statusChangeDetectionService");
const { normalizeTicketId } = require("./taskMatcher");

// Load environment variables
require("dotenv").config();

// Initialize OpenAI client using LangChain (same as transcript-chat)
const llm = new ChatOpenAI({
  modelName: 'gpt-5-nano',
  max_output_tokens: 1000,
  reasoning: { effort: 'medium' },
  verbosity: "medium",
});


/**
 * Stage 3: Update existing tasks with new information using RAG
 * @param {Array} foundTasks - Tasks from Stage 1 (Task Finder)
 * @param {Array} skippedTasks - Tasks not created in Stage 2
 * @param {Array} existingTasks - Current active tasks in database
 * @param {Array} tasksToBeUpdated - Structured array from Task Finder
 * @param {Array} transcript - Original transcript for status change detection
 * @param {Object} context - Processing context
 * @returns {Promise<Object>} Task updates to be applied
 */
async function updateExistingTasks(foundTasks, skippedTasks, existingTasks, tasksToBeUpdated, transcript, context = {}) {
  try {
    const { taskRAG } = require("../utilities/ragService");
    
    logger.info("Starting Stage 3: Task Updater with RAG enhancement", {
      tasksToBeUpdated: tasksToBeUpdated.length,
      existingTasksCount: existingTasks.length,
      transcriptIndex: context.transcriptIndex || 1,
      isMultiTranscript: Boolean(context.isMultiTranscript),
      timestamp: new Date().toISOString(),
    });

    console.log("[DEBUG] Task Updater with RAG:", {
      tasksToUpdate: tasksToBeUpdated.length,
      existingTasks: existingTasks.length,
      ticketIds: tasksToBeUpdated.map(t => t.ticketId)
    });

    const taskUpdates = [];
    const statusChanges = [];

    // Detect status changes from transcript first
    const detectedStatusChanges = detectStatusChangesFromTranscript(transcript);
    
    // Process status changes
    for (const statusChange of detectedStatusChanges) {
      const normalizedStatusChangeTaskId = normalizeTicketId(statusChange.taskId);
      const existingTask = existingTasks.find(task => 
        normalizeTicketId(task.ticketId) === normalizedStatusChangeTaskId
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

    // Process task updates using RAG for each individual task
    for (let i = 0; i < tasksToBeUpdated.length; i++) {
      const taskToUpdate = tasksToBeUpdated[i];
      
      logger.info(`Updating task ${i + 1}/${tasksToBeUpdated.length} with RAG`, {
        ticketId: taskToUpdate.ticketId,
        description: taskToUpdate.description.substring(0, 100),
        assignee: taskToUpdate.assignee
      });

      console.log("[DEBUG] Processing task update with RAG:", {
        index: i + 1,
        total: tasksToBeUpdated.length,
        ticketId: taskToUpdate.ticketId,
        description: taskToUpdate.description.substring(0, 100)
      });

      // Find the existing task in database (using normalized comparison)
      const normalizedUpdateTicketId = normalizeTicketId(taskToUpdate.ticketId);
      const existingTask = existingTasks.find(task => 
        normalizeTicketId(task.ticketId) === normalizedUpdateTicketId
      );
      
      if (!existingTask) {
        logger.warn(`Task ${taskToUpdate.ticketId} not found in database for update`);
        console.log(`[DEBUG] Task ${taskToUpdate.ticketId} not found in database for update`);
        continue;
      }

      try {
        // Use RAG to enhance task update with full context
        const ragResult = await taskRAG.updateTaskWithRAG({
          ticketId: taskToUpdate.ticketId,
          currentDescription: existingTask.description || existingTask.text,
          updateInfo: taskToUpdate.description,
          evidence: taskToUpdate.evidence,
          additionalContext: taskToUpdate.context
        }, {
          topK: 5,
          scoreThreshold: 0.7
        });

        if (ragResult.success) {
          const ragEnhancedUpdate = {
            taskId: taskToUpdate.ticketId,
            originalDescription: existingTask.description || existingTask.text,
            newInformation: ragResult.updatedDescription,
            updateType: ragResult.updateType || "RAG_ENHANCEMENT",
            updateSource: "TASK_UPDATER_RAG",
            confidence: ragResult.confidence === 'high' ? 1.0 : ragResult.confidence === 'medium' ? 0.8 : 0.6,
            evidence: taskToUpdate.evidence,
            speaker: taskToUpdate.assignee,
            context: taskToUpdate.context,
            timestamp: new Date().toISOString(),
            ragEnhanced: true,
            ragSources: ragResult.ragSources || [],
            ragReasoning: ragResult.reasoning,
            ragUpdateSummary: ragResult.updateSummary,
            ragScoped: ragResult.isScoped || false,
            ragScopedToTranscript: ragResult.scopedToTranscript,
            updatedTaskData: {
              ...existingTask,
              description: ragResult.updatedDescription,
              participantName: existingTask.participantName,
              type: existingTask.type || 'Non-Coding',
              status: existingTask.status || 'To-do',
              estimatedTime: existingTask.estimatedTime || 0,
              timeTaken: existingTask.timeTaken || 0
            }
          };

          taskUpdates.push(ragEnhancedUpdate);

          console.log("[DEBUG] Task Updater RAG - SUCCESS:", {
            ticketId: taskToUpdate.ticketId,
            originalLength: existingTask.description ? existingTask.description.length : 0,
            updatedLength: ragResult.updatedDescription.length,
            updateType: ragResult.updateType,
            confidence: ragResult.confidence,
            sourcesUsed: ragResult.ragSources ? ragResult.ragSources.length : 0,
            isScoped: ragResult.isScoped,
            scopedToTranscript: ragResult.scopedToTranscript
          });
        } else {
          // Fallback to basic update if RAG fails
          const basicUpdate = generateDetailedUpdateDescription(taskToUpdate);
          
          const basicTaskUpdate = {
            taskId: taskToUpdate.ticketId,
            originalDescription: existingTask.description || existingTask.text,
            newInformation: basicUpdate,
            updateType: "BASIC_UPDATE",
            updateSource: "TASK_UPDATER_BASIC",
            confidence: 0.7,
            evidence: taskToUpdate.evidence,
            speaker: taskToUpdate.assignee,
            context: taskToUpdate.context,
            timestamp: new Date().toISOString(),
            ragEnhanced: false,
            ragError: ragResult.error,
            updatedTaskData: {
              ...existingTask,
              description: `${existingTask.description || existingTask.text}\n\nUpdate: ${basicUpdate}`,
              participantName: existingTask.participantName,
              type: existingTask.type || 'Non-Coding',
              status: existingTask.status || 'To-do',
              estimatedTime: existingTask.estimatedTime || 0,
              timeTaken: existingTask.timeTaken || 0
            }
          };

          taskUpdates.push(basicTaskUpdate);

          console.log("[DEBUG] Task Updater RAG - FALLBACK:", {
            ticketId: taskToUpdate.ticketId,
            error: ragResult.error,
            reason: "Using basic task update"
          });
        }

      } catch (error) {
        logger.error(`Task update failed for task ${taskToUpdate.ticketId}`, {
          error: error.message,
          ticketId: taskToUpdate.ticketId
        });

        // Fallback to basic update
        const basicUpdate = generateDetailedUpdateDescription(taskToUpdate);
        
        const fallbackTaskUpdate = {
          taskId: taskToUpdate.ticketId,
          originalDescription: existingTask.description || existingTask.text,
          newInformation: basicUpdate,
          updateType: "FALLBACK_UPDATE",
          updateSource: "TASK_UPDATER_FALLBACK",
          confidence: 0.5,
          evidence: taskToUpdate.evidence,
          speaker: taskToUpdate.assignee,
          context: taskToUpdate.context,
          timestamp: new Date().toISOString(),
          ragEnhanced: false,
          ragError: error.message,
          updatedTaskData: {
            ...existingTask,
            description: `${existingTask.description || existingTask.text}\n\nUpdate: ${basicUpdate}`,
            participantName: existingTask.participantName,
            type: existingTask.type || 'Non-Coding',
            status: existingTask.status || 'To-do',
            estimatedTime: existingTask.estimatedTime || 0,
            timeTaken: existingTask.timeTaken || 0
          }
        };

        taskUpdates.push(fallbackTaskUpdate);

        console.log("[DEBUG] Task Updater - EXCEPTION FALLBACK:", {
          ticketId: taskToUpdate.ticketId,
          error: error.message
        });
      }
    }

    logger.info("Stage 3: Task Updater completed successfully with RAG", {
      tasksProcessed: tasksToBeUpdated.length,
      taskUpdatesCreated: taskUpdates.length,
      ragEnhanced: taskUpdates.filter(u => u.ragEnhanced).length,
      basicUpdates: taskUpdates.filter(u => !u.ragEnhanced).length,
      statusChangesCount: statusChanges.length,
      transcriptIndex: context.transcriptIndex || 1
    });

    return {
      success: true,
      stage: 3,
      taskUpdates,
      statusChanges,
      metadata: {
        tasksProcessed: tasksToBeUpdated.length,
        taskUpdatesCount: taskUpdates.length,
        ragEnhanced: taskUpdates.filter(u => u.ragEnhanced).length,
        basicUpdates: taskUpdates.filter(u => !u.ragEnhanced).length,
        statusChangesCount: statusChanges.length,
        processedAt: new Date().toISOString(),
        transcriptIndex: context.transcriptIndex || 1,
        ragUsed: true
      }
    };

  } catch (error) {
    logger.error("Stage 3: Task Updater failed", {
      error: error.message,
      stack: error.stack,
      tasksToBeUpdated: tasksToBeUpdated.length,
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
 * Update embeddings for modified tasks
 * @param {Array} taskUpdates - Array of task updates
 * @returns {Promise<Object>} Result summary
 */
async function updateEmbeddingsForModifiedTasks(taskUpdates) {
  try {
    const { updateTaskEmbedding } = require("../storage/mongoEmbeddingService");
    
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    logger.info("Starting embedding updates for modified tasks", {
      taskCount: taskUpdates.length
    });
    
    for (const taskUpdate of taskUpdates) {
      try {
        if (!taskUpdate.taskId || !taskUpdate.updatedTaskData) {
          skipped++;
          continue;
        }
        
        const embeddingResult = await updateTaskEmbedding(taskUpdate.taskId, {
          ticketId: taskUpdate.taskId,
          title: taskUpdate.updatedTaskData.title || taskUpdate.updatedTaskData.description.substring(0, 50),
          description: taskUpdate.updatedTaskData.description,
          participantName: taskUpdate.updatedTaskData.participantName,
          type: taskUpdate.updatedTaskData.type,
          status: taskUpdate.updatedTaskData.status,
          isFuturePlan: taskUpdate.updatedTaskData.isFuturePlan || false,
          estimatedTime: taskUpdate.updatedTaskData.estimatedTime || 0,
          timeTaken: taskUpdate.updatedTaskData.timeTaken || 0
        });
        
        if (embeddingResult.success) {
          updated++;
          logger.info("Embedding updated for modified task", {
            taskId: taskUpdate.taskId,
            updateType: taskUpdate.updateType,
            chunksStored: embeddingResult.chunksStored
          });
        } else {
          skipped++;
        }
        
      } catch (error) {
        errors++;
        logger.error("Error updating embedding for modified task", {
          taskId: taskUpdate.taskId,
          error: error.message
        });
      }
    }
    
    logger.info("Embedding updates completed", {
      total: taskUpdates.length,
      updated,
      skipped,
      errors
    });
    
    return {
      success: true,
      total: taskUpdates.length,
      updated,
      skipped,
      errors
    };
    
  } catch (error) {
    logger.error("Error in embedding updates for modified tasks", {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

module.exports = {
  updateExistingTasks,
  checkForExplicitTaskId,
  parseUpdateDecision,
  createTaskUpdaterSystemPrompt,
  createTaskUpdateDecisionPrompt,
  createExplicitUpdateDecisionPrompt,
  generateDetailedUpdateDescription,
  updateEmbeddingsForModifiedTasks
};
