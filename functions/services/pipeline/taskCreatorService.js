/**
 * Task Creator Service - Stage 2 of 3-Stage Pipeline
 * 
 * This service implements the Task Creator role, focusing on systematic identification
 * of genuinely new tasks that should be created in the system.
 * 
 * Role: Task Creator
 * - Epistemic stance: Systematic
 * - Communication style: Clear, concise, structured, neutral
 * - Values: Clarity, efficiency
 * - Domain: Scrum
 */

const { ChatOpenAI } = require("@langchain/openai");
const { logger } = require("firebase-functions");

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
 * Stage 2: Identify which found tasks are genuinely new and enrich them with RAG
 * @param {Array} foundTasks - Tasks from Stage 1 (Task Finder) 
 * @param {Array} existingTasks - Current active tasks in database
 * @param {Array} tasksToBeCreated - Structured array from Task Finder
 * @param {Object} context - Processing context
 * @returns {Promise<Object>} New tasks to be created with RAG enhancements
 */
async function identifyNewTasks(foundTasks, existingTasks, tasksToBeCreated, context = {}) {
  try {
    const { taskRAG } = require("../utilities/ragService");
    
    logger.info("Starting Stage 2: Task Creator with RAG enhancement", {
      tasksToBeCreated: tasksToBeCreated.length,
      existingTasksCount: existingTasks.length,
      transcriptIndex: context.transcriptIndex || 1,
      isMultiTranscript: Boolean(context.isMultiTranscript),
      timestamp: new Date().toISOString(),
    });

    console.log(`[DEBUG] Task Creator with RAG:`, {
      tasksToProcess: tasksToBeCreated.length,
      existingTasks: existingTasks.length
    });

    const newTasks = [];
    const analysisResults = [];

    // Process each task individually with RAG enhancement
    for (let i = 0; i < tasksToBeCreated.length; i++) {
      const taskToCreate = tasksToBeCreated[i];
      
      logger.info(`Creating task ${i + 1}/${tasksToBeCreated.length} with RAG`, {
        taskDesc: taskToCreate.description.substring(0, 100),
        assignee: taskToCreate.assignee,
        type: taskToCreate.type
      });

      console.log("[DEBUG] Processing task with RAG:", {
        index: i + 1,
        total: tasksToBeCreated.length,
        description: taskToCreate.description.substring(0, 100),
        assignee: taskToCreate.assignee,
        type: taskToCreate.type
      });

      try {
        // Use RAG to create rich task description with full context
        const ragResult = await taskRAG.createRichTaskDescription({
          description: taskToCreate.description,
          assignee: taskToCreate.assignee,
          type: taskToCreate.type,
          evidence: taskToCreate.evidence,
          context: taskToCreate.context
        }, {
          topK: 5,
          scoreThreshold: 0.7
        });

        if (ragResult.success) {
          const enrichedTask = {
            description: ragResult.description,
            title: ragResult.title,
            assignee: taskToCreate.assignee,
            type: taskToCreate.type,
            isFuturePlan: taskToCreate.isFuturePlan || false,
            evidence: taskToCreate.evidence,
            context: taskToCreate.context,
            urgency: taskToCreate.urgency,
            estimatedTime: taskToCreate.estimatedTime || 0,
            timeSpent: taskToCreate.timeSpent || 0,
            ragEnhanced: true,
            ragConfidence: ragResult.confidence,
            ragSources: ragResult.ragSources || [],
            ragReasoning: ragResult.reasoning,
            ragScoped: ragResult.isScoped || false,
            ragScopedToTranscript: ragResult.scopedToTranscript,
            creationConfidence: 1.0,
            creationReason: "RAG-enhanced task creation",
            stage: 2,
            source: "task_creator_rag"
          };

          newTasks.push(enrichedTask);

          console.log("[DEBUG] Task Creator RAG - SUCCESS:", {
            originalLength: taskToCreate.description.length,
            enhancedLength: ragResult.description.length,
            title: ragResult.title,
            ragUsed: ragResult.ragUsed,
            confidence: ragResult.confidence,
            sourcesUsed: ragResult.ragSources ? ragResult.ragSources.length : 0,
            isScoped: ragResult.isScoped,
            scopedToTranscript: ragResult.scopedToTranscript
          });

          analysisResults.push({
            foundTask: taskToCreate,
            decision: 'CREATE_NEW_RAG',
            reason: 'Task enhanced with RAG context',
            confidence: 1.0,
            ragUsed: ragResult.ragUsed,
            ragConfidence: ragResult.confidence
          });
        } else {
          // Fallback to basic task creation if RAG fails
          // Create a clean title by removing artifacts and taking first few words
          let cleanTitle = taskToCreate.description
            .replace(/^(Purpose:|NEW_TASK|Create a task|Background|Context):\s*/i, '') // Remove prefixes
            .replace(/\s*\([^)]*\)\s*/g, '') // Remove parenthetical text
            .split(' ')
            .slice(0, 5) // Take first 5 words max
            .join(' ')
            .replace(/[^\w\s]/g, '') // Remove special characters
            .trim();
          
          if (cleanTitle.length > 50) {
            cleanTitle = cleanTitle.substring(0, 50);
          }

          const basicTask = {
            description: taskToCreate.description,
            title: cleanTitle || taskToCreate.description.substring(0, 30),
            assignee: taskToCreate.assignee,
            type: taskToCreate.type,
            isFuturePlan: taskToCreate.isFuturePlan || false,
            evidence: taskToCreate.evidence,
            context: taskToCreate.context,
            urgency: taskToCreate.urgency,
            estimatedTime: taskToCreate.estimatedTime || 0,
            timeSpent: taskToCreate.timeSpent || 0,
            ragEnhanced: false,
            ragError: ragResult.error,
            creationConfidence: 0.7,
            creationReason: "Basic task creation (RAG failed)",
            stage: 2,
            source: "task_creator_basic"
          };

          newTasks.push(basicTask);

          console.log("[DEBUG] Task Creator RAG - FALLBACK:", {
            error: ragResult.error,
            reason: "Using basic task creation"
          });

          analysisResults.push({
            foundTask: taskToCreate,
            decision: 'CREATE_NEW_BASIC',
            reason: 'RAG failed, using basic creation',
            confidence: 0.7,
            ragUsed: false,
            error: ragResult.error
          });
        }

      } catch (error) {
        logger.error(`Task creation failed for task ${i + 1}`, {
          error: error.message,
          taskDesc: taskToCreate.description.substring(0, 100)
        });

        // Fallback to basic task creation
        const basicTask = {
          description: taskToCreate.description,
          title: taskToCreate.description.substring(0, 50),
          assignee: taskToCreate.assignee,
          type: taskToCreate.type,
          isFuturePlan: taskToCreate.isFuturePlan || false,
          evidence: taskToCreate.evidence,
          context: taskToCreate.context,
          urgency: taskToCreate.urgency,
          estimatedTime: taskToCreate.estimatedTime || 0,
          timeSpent: taskToCreate.timeSpent || 0,
          ragEnhanced: false,
          ragError: error.message,
          creationConfidence: 0.5,
          creationReason: "Basic task creation (exception occurred)",
          stage: 2,
          source: "task_creator_fallback"
        };

        newTasks.push(basicTask);

        analysisResults.push({
          foundTask: taskToCreate,
          decision: 'CREATE_NEW_FALLBACK',
          reason: 'Exception occurred, using fallback creation',
          confidence: 0.5,
          ragUsed: false,
          error: error.message
        });
      }
    }

    logger.info("Stage 2: Task Creator completed successfully with RAG", {
      tasksProcessed: tasksToBeCreated.length,
      newTasksCreated: newTasks.length,
      ragEnhanced: newTasks.filter(t => t.ragEnhanced).length,
      basicCreation: newTasks.filter(t => !t.ragEnhanced).length,
      transcriptIndex: context.transcriptIndex || 1
    });

    return {
      success: true,
      stage: 2,
      newTasks,
      analysisResults,
      metadata: {
        tasksProcessed: tasksToBeCreated.length,
        newTasksCount: newTasks.length,
        ragEnhanced: newTasks.filter(t => t.ragEnhanced).length,
        basicCreation: newTasks.filter(t => !t.ragEnhanced).length,
        processedAt: new Date().toISOString(),
        transcriptIndex: context.transcriptIndex || 1,
        ragUsed: true
      }
    };

  } catch (error) {
    logger.error("Stage 2: Task Creator failed", {
      error: error.message,
      stack: error.stack,
      tasksToBeCreated: tasksToBeCreated.length,
      existingTasksCount: existingTasks.length,
      transcriptIndex: context.transcriptIndex || 1
    });
    
    throw new Error(`Task Creator (Stage 2) failed: ${error.message}`);
  }
}



/**
 * Create system prompt for Task Creator role
 * @param {Object} context - Processing context
 * @returns {string} System prompt
 */
function createTaskCreatorSystemPrompt(context) {
  const roleDescription = `You are a Task Creator with the following identity:

**Role Identity**: Task Creator
- **Epistemic stance**: Systematic
- **Communication style**: Clear, concise, structured, neutral
- **Values and priorities**: Clarity, efficiency
- **Domain orientation**: Scrum

**Constraints**:
- Avoid prescriptive solutions and speculative or vague language
- Focus on structured and transparent framing of work items
- Maintain neutrality in all decisions

**Core Purpose**: Systematically define and frame work items with clarity and neutrality. Ensure tasks are understandable, efficient, and aligned without prescribing solutions or introducing ambiguity.`;

  let contextualAddition = "";
  if (context.isMultiTranscript) {
    contextualAddition = `

**Multi-Transcript Context**:
- This is transcript ${context.transcriptIndex} of ${context.totalTranscripts}
- Make decisions based solely on the evidence provided
- Focus on systematic analysis without speculation`;
  }

  return roleDescription + contextualAddition;
}

/**
 * Create prompt for task creation decision
 * @param {Object} foundTask - Task from Stage 1
 * @param {Array} similarTasks - Similar existing tasks
 * @param {Object} context - Processing context
 * @returns {string} Decision prompt
 */
function createTaskCreationDecisionPrompt(foundTask, similarTasks, context) {
  const similarTasksList = similarTasks.map((task, index) => 
    `${index + 1}. "${task.metadata.text}" (Similarity: ${(task.similarity * 100).toFixed(1)}%)`
  ).join('\n');

  return `
**OBJECTIVE**: Determine if this found task should be created as a NEW task or if it's similar enough to existing tasks that it should NOT be created.

**FOUND TASK TO ANALYZE**:
- Description: "${foundTask.description}"
- Assignee: ${foundTask.assignee}
- Type: ${foundTask.type}
- Evidence: "${foundTask.evidence}"

**SIMILAR EXISTING TASKS**:
${similarTasksList}

**DECISION CRITERIA**:

**CREATE NEW TASK if**:
- The found task represents genuinely different work
- The scope or requirements are substantially different
- It's a new feature or component not covered by existing tasks
- The approach or implementation differs significantly

**DO NOT CREATE if**:
- The task is essentially the same as an existing task
- It's a minor variation that could be handled as an update
- The work is already covered by an existing task's scope
- It would create unnecessary duplication

**ANALYSIS REQUIREMENTS**:
1. Compare the SCOPE of work between found task and existing tasks
2. Evaluate if the DELIVERABLES would be different
3. Consider if this represents NEW work or refinement of existing work
4. Assess if creating a separate task would improve or hinder project clarity

**RESPONSE FORMAT**:
DECISION: [CREATE_NEW/DO_NOT_CREATE]
CONFIDENCE: [0.0-1.0]
REASONING: [Clear explanation of decision based on analysis]

**YOUR ANALYSIS**:`;
}

/**
 * Parse GPT creation decision response
 * @param {string} response - GPT response
 * @returns {Object} Parsed decision
 */
function parseCreationDecision(response) {
  try {
    const lines = response.split('\n').map(line => line.trim()).filter(line => line);
    
    let shouldCreate = true;
    let confidence = 0.5;
    let reasoning = "Unable to parse decision";
    
    for (const line of lines) {
      if (line.startsWith('DECISION:')) {
        const decision = line.replace('DECISION:', '').trim();
        shouldCreate = decision.includes('CREATE_NEW');
      } else if (line.startsWith('CONFIDENCE:')) {
        const confStr = line.replace('CONFIDENCE:', '').trim();
        const confMatch = confStr.match(/(\d+(?:\.\d+)?)/);
        if (confMatch) {
          confidence = Math.max(0, Math.min(1, parseFloat(confMatch[1])));
        }
      } else if (line.startsWith('REASONING:')) {
        reasoning = line.replace('REASONING:', '').trim();
      }
    }
    
    return { shouldCreate, confidence, reasoning };
    
  } catch (error) {
    logger.error("Error parsing creation decision", {
      error: error.message,
      response: response.substring(0, 200)
    });
    
    return {
      shouldCreate: true,
      confidence: 0.5,
      reasoning: "Failed to parse decision, defaulting to create"
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
 * Generate detailed task description using full transcript context
 * @param {Object} foundTask - Basic task from Task Finder
 * @param {Array} transcript - Full transcript for context
 * @returns {Promise<string>} Detailed task description
 */
async function generateDetailedTaskDescription(foundTask, transcript) {
  try {
    // Format transcript for context
    const transcriptText = transcript.map(entry => entry.text.replace(/<[^>]*>/g, "")).join("\n");
    
    // Use the evidence and context to generate a comprehensive description
    // Remove [IS_FUTURE_PLAN: true] markers from context
    const cleanContext = foundTask.context.replace(/\[IS_FUTURE_PLAN:\s*true\]/gi, '').trim();
    const description = `${foundTask.description}. Based on the discussion, ${cleanContext} ${foundTask.evidence ? `Evidence from transcript: "${foundTask.evidence}"` : ''}`.trim();
    
    logger.info("Task description generated", {
      originalLength: foundTask.description.length,
      enhancedLength: description.length,
      assignee: foundTask.assignee
    });
    
    return description;
    
  } catch (error) {
    logger.error("Error generating detailed task description", {
      error: error.message,
      taskSummary: foundTask.description.substring(0, 50)
    });
    
    // Return original description if generation fails
    return foundTask.description;
  }
}



/**
 * Generate embeddings for newly created tasks
 * @param {Array} newTasks - Array of new tasks with ticket IDs
 * @returns {Promise<Object>} Result summary
 */
async function generateEmbeddingsForNewTasks(newTasks) {
  try {
    const { addOrUpdateTaskEmbedding } = require("../storage/mongoEmbeddingService");
    
    let generated = 0;
    let skipped = 0;
    let errors = 0;
    
    logger.info("Starting embedding generation for new tasks", {
      taskCount: newTasks.length
    });
    
    for (const task of newTasks) {
      try {
        if (!task.ticketId || task.ticketId === 'NONE') {
          skipped++;
          continue;
        }
        
        const embeddingResult = await addOrUpdateTaskEmbedding(task.ticketId, {
          title: task.title || task.description.substring(0, 50),
          description: task.description,
          assignee: task.assignee,
          participantName: task.assignee,
          type: task.type,
          status: task.status || 'To-do',
          isFuturePlan: task.isFuturePlan || false,
          estimatedTime: task.estimatedTime || 0,
          timeTaken: task.timeTaken || 0
        });
        
        if (embeddingResult) {
          generated++;
          logger.info("Embedding generated for new task", {
            taskId: task.ticketId
          });
        } else {
          skipped++;
        }
        
      } catch (error) {
        errors++;
        logger.error("Error generating embedding for new task", {
          taskId: task.ticketId,
          error: error.message
        });
      }
    }
    
    logger.info("Embedding generation completed", {
      total: newTasks.length,
      generated,
      skipped,
      errors
    });
    
    return {
      success: true,
      total: newTasks.length,
      generated,
      skipped,
      errors
    };
    
  } catch (error) {
    logger.error("Error in embedding generation for new tasks", {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

module.exports = {
  identifyNewTasks,
  checkForExplicitTaskId,
  parseCreationDecision,
  createTaskCreatorSystemPrompt,
  createTaskCreationDecisionPrompt,
  generateDetailedTaskDescription,
  generateEmbeddingsForNewTasks
};
