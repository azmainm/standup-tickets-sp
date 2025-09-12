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

const OpenAI = require("openai");
const { logger } = require("firebase-functions");
const {
  findSimilarTasks,
  isVectorDBAvailable,
  addTaskEmbedding
} = require("./vectorService");

// Load environment variables
require("dotenv").config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Stage 2: Identify which found tasks are genuinely new
 * @param {Array} foundTasks - Tasks from Stage 1 (Task Finder)
 * @param {Array} existingTasks - Current active tasks in database
 * @param {Object} context - Processing context
 * @returns {Promise<Object>} New tasks to be created
 */
async function identifyNewTasks(foundTasks, existingTasks, transcript, context = {}) {
  try {
    // Filter to only process tasks marked as NEW_TASK by the Task Finder
    const newTasksToCreate = foundTasks.filter(task => 
      task.category === 'NEW_TASK' || 
      (!task.category && task.ticketId === 'NONE') // Fallback for older format
    );
    
    console.log(`[DEBUG] Task Creator filtering:`, {
      totalFound: foundTasks.length,
      newTasksToCreate: newTasksToCreate.length,
      updateTasks: foundTasks.filter(t => t.category === 'UPDATE_TASK').length,
      filtered: foundTasks.length - newTasksToCreate.length
    });
    
    logger.info("Starting Stage 2: Task Creator", {
      foundTasksCount: foundTasks.length,
      newTasksToProcess: newTasksToCreate.length,
      existingTasksCount: existingTasks.length,
      transcriptIndex: context.transcriptIndex || 1,
      isMultiTranscript: Boolean(context.isMultiTranscript),
      timestamp: new Date().toISOString(),
    });

    const newTasks = [];
    const analysisResults = [];

    // Process each new task (Task Finder already classified them)
    for (let i = 0; i < newTasksToCreate.length; i++) {
      const foundTask = newTasksToCreate[i];
      
      logger.info(`Analyzing task ${i + 1}/${newTasksToCreate.length}`, {
        taskDesc: foundTask.description.substring(0, 100),
        assignee: foundTask.assignee,
        type: foundTask.type
      });

      // Check if task has explicit task ID (indicates existing task reference)
      const hasExplicitTaskId = checkForExplicitTaskId(foundTask.description);
      
      if (hasExplicitTaskId) {
        logger.info("Task references existing ID, skipping creation", {
          taskDesc: foundTask.description.substring(0, 50),
          taskId: hasExplicitTaskId
        });
        
        analysisResults.push({
          foundTask,
          decision: 'EXISTING_REFERENCE',
          reason: `References existing task ID: ${hasExplicitTaskId}`,
          confidence: 1.0
        });
        continue;
      }

      // Task Finder already classified this as NEW_TASK, so create it
      let isNewTask = true;
      let confidence = 1.0;
      let reason = "Task Finder classified as NEW_TASK";
      
      if (isNewTask) {
        // Generate detailed description using transcript context
        const detailedDescription = await generateDetailedTaskDescription(foundTask, transcript);
        
        newTasks.push({
          ...foundTask,
          description: detailedDescription,
          creationConfidence: confidence,
          creationReason: reason,
          stage: 2
        });
        
        console.log("[DEBUG] Task Creator - NEW TASK:", {
          taskDesc: foundTask.description.substring(0, 100),
          assignee: foundTask.assignee,
          type: foundTask.type,
          confidence,
          reason,
          isFuturePlan: foundTask.isFuturePlan
        });
      } else {
        console.log("[DEBUG] Task Creator - SKIPPED:", {
          taskDesc: foundTask.description.substring(0, 100),
          assignee: foundTask.assignee,
          type: foundTask.type,
          confidence,
          reason,
          category: foundTask.category,
          ticketId: foundTask.ticketId
        });
      }
      
      analysisResults.push({
        foundTask,
        decision: isNewTask ? 'CREATE_NEW' : 'SKIP_EXISTING',
        reason,
        confidence,
        similarMatches: 0 // No similarity matching since Task Finder classified
      });
    }

    logger.info("Stage 2: Task Creator completed successfully", {
      foundTasks: foundTasks.length,
      newTasksToCreate: newTasks.length,
      existingTaskReferences: analysisResults.filter(a => a.decision === 'EXISTING_REFERENCE').length,
      skippedDuplicates: analysisResults.filter(a => a.decision === 'SKIP_EXISTING').length,
      transcriptIndex: context.transcriptIndex || 1
    });

    return {
      success: true,
      stage: 2,
      newTasks,
      analysisResults,
      metadata: {
        foundTasksCount: foundTasks.length,
        newTasksCount: newTasks.length,
        existingReferences: analysisResults.filter(a => a.decision === 'EXISTING_REFERENCE').length,
        skippedDuplicates: analysisResults.filter(a => a.decision === 'SKIP_EXISTING').length,
        processedAt: new Date().toISOString(),
        transcriptIndex: context.transcriptIndex || 1
      }
    };

  } catch (error) {
    logger.error("Stage 2: Task Creator failed", {
      error: error.message,
      stack: error.stack,
      foundTasksCount: foundTasks.length,
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
 * LEGACY: Find similar tasks using vector database for creation decision
 * NOTE: This function is no longer used after removing similarity search from pipeline decisions
 * @param {Object} foundTask - Task from Stage 1
 * @param {Array} existingTasks - Current active tasks
 * @returns {Promise<Object>} Similarity search results
 */
async function findSimilarTasksForCreation(foundTask, existingTasks) {
  try {
    const vectorAvailable = await isVectorDBAvailable();
    
    if (!vectorAvailable) {
      logger.warn("Vector database not available, skipping similarity search");
      return { matches: [] };
    }

    // Filter existing tasks by same assignee
    const assigneeTasks = existingTasks.filter(task => 
      task.participantName === foundTask.assignee
    );

    if (assigneeTasks.length === 0) {
      return { matches: [] };
    }

    // Search for similar tasks using vector similarity
    const queryText = `${foundTask.description}`;
    const searchContext = {
      assignee: foundTask.assignee,
      type: foundTask.type,
      status: 'To-do'
    };

    logger.info("Stage 2: Vector search input (creation)", {
      queryPreview: queryText.substring(0, 200),
      searchContext
    });
    console.log("[Creator] Vector search input", {
      queryPreview: queryText.substring(0, 200),
      searchContext
    });

    const similarTasks = await findSimilarTasks(queryText, searchContext, 5, 0.85);

    // Debug: log shape of results
    try {
      const sample = (similarTasks || []).slice(0, 5).map((m, i) => ({
        index: i,
        keys: m ? Object.keys(m) : [],
        hasMetadata: Boolean(m && m.metadata),
        metadataKeys: m && m.metadata ? Object.keys(m.metadata) : [],
        similarity: (m && typeof m.similarity === 'number') ? m.similarity : null
      }));
      logger.info("Stage 2: Vector search raw results (sample)", { count: (similarTasks || []).length, sample });
      console.log("[Creator] Vector raw results (sample)", { count: (similarTasks || []).length, sample });
    } catch (e) {
      logger.warn("Stage 2: Failed to log vector search results (debug)", { error: e.message });
      console.log("[Creator] Failed to log vector search results", { error: e.message });
    }
    
    // Filter results to only include tasks from the same assignee
    const relevantMatches = similarTasks.filter(similar => 
      similar.metadata.assignee === foundTask.assignee
    );

    logger.info("Stage 2: Vector search filtered results (creation)", {
      originalCount: (similarTasks || []).length,
      filteredCount: relevantMatches.length
    });
    console.log("[Creator] Vector filtered results", {
      originalCount: (similarTasks || []).length,
      filteredCount: relevantMatches.length
    });

    return {
      matches: relevantMatches,
      searchPerformed: true
    };

  } catch (error) {
    logger.error("Error in similarity search for creation", {
      error: error.message,
      foundTask: foundTask.description.substring(0, 50)
    });
    
    return { matches: [] };
  }
}

/**
 * LEGACY: Use GPT to make final creation decision when similar tasks exist
 * NOTE: This function is no longer used after removing similarity search from pipeline decisions
 * @param {Object} foundTask - Task from Stage 1
 * @param {Array} similarTasks - Similar existing tasks
 * @param {Object} context - Processing context
 * @returns {Promise<Object>} Creation decision
 */
async function makeCreationDecisionWithGPT(foundTask, similarTasks, context) {
  try {
    const prompt = createTaskCreationDecisionPrompt(foundTask, similarTasks, context);
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: createTaskCreatorSystemPrompt(context)
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1, // Low temperature for consistent decisions
      max_tokens: 500,
    });

    logger.info("Stage 2: GPT creation decision prompt", {
      promptChars: prompt.length,
      promptPreview: prompt.substring(0, 500)
    });
    console.log("[Creator] GPT prompt", {
      promptChars: prompt.length,
      promptPreview: prompt.substring(0, 500)
    });

    const gptResponse = response.choices[0].message.content;

    logger.info("Stage 2: GPT creation decision raw response", {
      responseChars: gptResponse ? gptResponse.length : 0,
      responsePreview: gptResponse ? gptResponse.substring(0, 500) : undefined
    });
    console.log("[Creator] GPT response", {
      responseChars: gptResponse ? gptResponse.length : 0,
      responsePreview: gptResponse ? gptResponse.substring(0, 500) : undefined
    });

    const decision = parseCreationDecision(gptResponse);
    
    logger.info("GPT creation decision made", {
      foundTask: foundTask.description.substring(0, 50),
      decision: decision.shouldCreate ? "CREATE" : "SKIP",
      confidence: decision.confidence,
      reasoning: decision.reasoning.substring(0, 100)
    });

    return decision;

  } catch (error) {
    logger.error("Error in GPT creation decision", {
      error: error.message,
      foundTask: foundTask.description.substring(0, 50)
    });
    
    // Default to creating the task if GPT fails
    return {
      shouldCreate: true,
      confidence: 0.5,
      reasoning: "GPT decision failed, defaulting to task creation"
    };
  }
}

/**
 * LEGACY: Test Task Creator service
 * NOTE: This function is no longer used - tests should be run using dedicated test files
 * @returns {Promise<boolean>} True if service is working
 */
async function testTaskCreatorService() {
  try {
    const foundTasks = [
      {
        description: "Fix authentication bug in login system",
        assignee: "John",
        type: "Coding",
        evidence: "John: I need to fix the auth bug",
        context: "Login system discussion",
        source: "task_finder"
      }
    ];
    
    const existingTasks = [];
    
    const result = await identifyNewTasks(foundTasks, existingTasks);
    return result.success;
  } catch (error) {
    logger.error("Task Creator service test failed", { error: error.message });
    return false;
  }
}

module.exports = {
  identifyNewTasks,
  testTaskCreatorService,
  findSimilarTasksForCreation,
  makeCreationDecisionWithGPT,
  checkForExplicitTaskId,
  parseCreationDecision,
  createTaskCreatorSystemPrompt,
  createTaskCreationDecisionPrompt,
  generateDetailedTaskDescription
};
