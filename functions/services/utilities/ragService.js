/**
 * RAG (Retrieval-Augmented Generation) Service for Standup Tickets SP
 * 
 * This service provides RAG functionality using transcript embeddings for:
 * 1. Task creation with rich context
 * 2. Task updates with relevant information
 * 3. LangChain integration for structured responses
 * 
 * Based on the proven architecture from transcript-chat system
 */

const { ChatOpenAI } = require('@langchain/openai');
const { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } = require('@langchain/core/prompts');
const { RunnableSequence } = require('@langchain/core/runnables');
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { getRAGContextForTask } = require('../storage/transcriptEmbeddingService');
const { getLocalRAGContext } = require('../storage/localEmbeddingCache');
const { logger } = require("firebase-functions");

// Load environment variables
require("dotenv").config();

/**
 * RAG system for task processing using LangChain
 */
class TaskRAG {
  constructor() {
    this.llm = new ChatOpenAI({
      modelName: 'gpt-5-nano',
      max_output_tokens: 1000,
      reasoning: { effort: 'medium' },
      verbosity: "medium",
    });

    // Create output parser for string responses
    this.outputParser = new StringOutputParser();
  }

  /**
   * Create RAG chain for task creation
   */
  createTaskCreationChain() {
    const chatPrompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(`
You are a Task Creator assistant for a Scrum team. Your role is to create concise, professional task titles and rich descriptions using relevant information from meeting transcripts.

**CORE PURPOSE**: Transform basic task descriptions into comprehensive, actionable task definitions using available context from meeting discussions.

**CRITICAL TITLE REQUIREMENTS**:
- Create a SHORT, CLEAR title (3-5 words maximum)
- Title should be the MAIN ACTION or DELIVERABLE (e.g., "Email notification system", "Mobile expense tracker", "Blue navigation menu")
- NEVER include: "NEW_TASK", "Create a task", "Background", "Context", "Update", "Purpose:", prefixes, or incomplete sentences
- Title should sound like something you'd see in a professional project management tool
- Examples of GOOD titles: "Email notification system", "User authentication fix", "Dashboard UI update"
- Examples of BAD titles: "NEW_TASK - Email notification", "Create a new task to", "BackgroundContext: During", "Purpose: Implement an email notification"

**DESCRIPTION REQUIREMENTS**:
1. **PROFESSIONAL FORMATTING**:
   - Start directly with the task purpose - no "BackgroundContext:" or similar prefixes
   - Write in clear, professional language suitable for stakeholders
   - Structure: Purpose → Requirements → Technical details → Acceptance criteria

2. **RICH CONTENT GENERATION**:
   - Use the provided transcript context to create comprehensive descriptions
   - Include background information, requirements, and technical details mentioned
   - Preserve conversation flow and reasoning from the transcripts
   - Add context about WHY the task is needed (if mentioned)
   - Include any dependencies, constraints, or timeline information

3. **CONTEXT INTEGRATION**:
   - Weave in relevant details from the transcript context naturally
   - Don't just append context - integrate it meaningfully
   - Preserve technical details, names, and specific requirements mentioned
   - Include any clarifications or additional requirements discussed

**OUTPUT FORMAT**:
Return your response as a valid JSON object with these exact fields:
- title: A SHORT, professional title (3-5 words maximum, NO prefixes or artifacts)
- description: Rich, detailed description in professional language (NO "BackgroundContext" or similar prefixes)
- confidence: "high", "medium", or "low"
- sources_used: Array of brief descriptions of sources used
- reasoning: Brief explanation of how context was integrated

IMPORTANT: Return ONLY the JSON object, no additional text or explanations.

**CONTEXT FROM MEETING TRANSCRIPTS**:
{context}
`),
      HumanMessagePromptTemplate.fromTemplate(`
**TASK TO ENHANCE**:
- Basic Description: {taskDescription}
- Assignee: {assignee}
- Type: {taskType}
- Evidence from transcript: {evidence}
- Additional Context: {additionalContext}

Please create a rich, detailed task using the transcript context provided above.
`)
    ]);

    return RunnableSequence.from([
      {
        context: (input) => input.context,
        taskDescription: (input) => input.taskDescription,
        assignee: (input) => input.assignee,
        taskType: (input) => input.taskType,
        evidence: (input) => input.evidence,
        additionalContext: (input) => input.additionalContext,
      },
      chatPrompt,
      this.llm,
      this.outputParser,
    ]);
  }

  /**
   * Create RAG chain for task updates
   */
  createTaskUpdateChain() {
    const chatPrompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(`
You are a Task Updater assistant for a Scrum team. Your role is to update existing tasks with new information from meeting discussions.

**CORE PURPOSE**: Enhance existing task descriptions with new information, progress updates, or clarifications from recent meeting discussions.

**TASK UPDATE GUIDELINES**:

1. **UPDATE INTEGRATION**:
   - PRESERVE the existing task description completely
   - APPEND new information to the existing description (do not replace or rewrite)
   - Add new details as an update section with date prefix
   - Include progress updates, new requirements, or clarifications as additions

2. **CONTEXT UTILIZATION**:
   - Use transcript context to provide rich, detailed updates
   - Include WHO mentioned the update and WHEN
   - Preserve technical details and specific information
   - Add any new requirements, constraints, or timeline changes

3. **UPDATE TYPES**:
   - Progress updates: What work has been done or is in progress
   - Requirement changes: New requirements or scope modifications
   - Technical details: Additional technical information or constraints
   - Status clarifications: Clarifications about current status or blockers

4. **OUTPUT FORMAT**:
Return your response as a valid JSON object with these exact fields:
- updatedDescription: The COMPLETE description with the original description preserved and new information APPENDED (format: "[ORIGINAL_DESCRIPTION]\n\n(DD/MM/YYYY): [NEW_UPDATE_CONTENT]" - NO "BackgroundContext" or artifacts)
- updateSummary: Brief summary of what was added/changed
- updateType: "progress", "requirements", "technical", or "clarification"
- confidence: "high", "medium", or "low" 
- sources_used: Array of brief descriptions of sources used
- reasoning: Brief explanation of update integration

IMPORTANT: Return ONLY the JSON object, no additional text or explanations.

**CONTEXT FROM MEETING TRANSCRIPTS**:
{context}
`),
      HumanMessagePromptTemplate.fromTemplate(`
**TASK TO UPDATE**:
- Ticket ID: {ticketId}
- Current Description: {currentDescription}
- Update Information: {updateInfo}
- Evidence from transcript: {evidence}
- Additional Context: {additionalContext}

Please PRESERVE the existing task description completely and APPEND the new information as an update section. Do not rewrite or replace the original description - only add to it.
`)
    ]);

    return RunnableSequence.from([
      {
        context: (input) => input.context,
        ticketId: (input) => input.ticketId,
        currentDescription: (input) => input.currentDescription,
        updateInfo: (input) => input.updateInfo,
        evidence: (input) => input.evidence,
        additionalContext: (input) => input.additionalContext,
      },
      chatPrompt,
      this.llm,
      this.outputParser,
    ]);
  }

  /**
   * Create a rich task description using RAG (prioritizes local/scoped search)
   * @param {Object} taskInfo - Basic task information
   * @param {Object} options - RAG options
   * @returns {Promise<Object>} Enhanced task description
   */
  async createRichTaskDescription(taskInfo, options = {}) {
    try {
      // First try local/scoped RAG search (current meeting only)
      let ragContext;
      try {
        ragContext = await getLocalRAGContext(taskInfo.description, {
          topK: options.topK || 5,
          scoreThreshold: options.scoreThreshold || 0.7
        });
        
        if (ragContext.success && ragContext.sources.length > 0) {
          logger.info('Using scoped RAG context for task creation', {
            taskDescription: taskInfo.description.substring(0, 100),
            scopedSources: ragContext.sources.length,
            scopedToTranscript: ragContext.scopedToTranscript
          });
        } else {
          // Fall back to global search if local search has no results
          logger.info('Local RAG context empty, falling back to global search', {
            taskDescription: taskInfo.description.substring(0, 100)
          });
          throw new Error('No local context found, falling back to global');
        }
      } catch (localError) {
        // Fallback to global RAG search
        logger.info('Using global RAG context for task creation', {
          taskDescription: taskInfo.description.substring(0, 100),
          reason: localError.message
        });
        
        ragContext = await getRAGContextForTask(taskInfo.description, {
          topK: options.topK || 5,
          scoreThreshold: options.scoreThreshold || 0.7
        });
      }

      if (!ragContext.success) {
        logger.warn('Failed to get RAG context for task creation', {
          taskDescription: taskInfo.description.substring(0, 100),
          error: ragContext.error
        });
        
        // Fallback to basic task description without RAG
        return {
          success: true,
          title: taskInfo.description.substring(0, 50),
          description: taskInfo.description,
          confidence: 'low',
          sources_used: [],
          reasoning: 'No RAG context available, using basic description',
          ragUsed: false
        };
      }

      // Create task creation chain
      const taskCreationChain = this.createTaskCreationChain();

      // Invoke the chain with task information and context
      const response = await taskCreationChain.invoke({
        context: ragContext.context || 'No relevant context found.',
        taskDescription: taskInfo.description,
        assignee: taskInfo.assignee || 'Unknown',
        taskType: taskInfo.type || 'Non-Coding',
        evidence: taskInfo.evidence || '',
        additionalContext: taskInfo.context || ''
      });

      // Parse JSON response
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(response);
      } catch (parseError) {
        logger.warn('Failed to parse RAG response as JSON, using fallback', {
          response: response.substring(0, 200),
          parseError: parseError.message
        });
        
        // Fallback parsing
        parsedResponse = {
          title: taskInfo.description.substring(0, 50),
          description: response || taskInfo.description,
          confidence: 'medium',
          sources_used: ragContext.sources ? ragContext.sources.map(s => s.date) : [],
          reasoning: 'Parsed from non-JSON response'
        };
      }

      logger.info('Rich task description created using RAG', {
        originalLength: taskInfo.description.length,
        enhancedLength: parsedResponse.description.length,
        sourcesUsed: ragContext.sources.length,
        confidence: parsedResponse.confidence,
        isScoped: ragContext.isScoped || false,
        scopedToTranscript: ragContext.scopedToTranscript
      });

      return {
        success: true,
        title: parsedResponse.title,
        description: parsedResponse.description,
        confidence: parsedResponse.confidence,
        sources_used: parsedResponse.sources_used,
        reasoning: parsedResponse.reasoning,
        ragUsed: true,
        ragSources: ragContext.sources,
        isScoped: ragContext.isScoped || false,
        scopedToTranscript: ragContext.scopedToTranscript
      };

    } catch (error) {
      logger.error('Error creating rich task description with RAG', {
        error: error.message,
        stack: error.stack,
        taskDescription: taskInfo.description.substring(0, 100)
      });

      // Fallback to basic task description
      return {
        success: true,
        title: taskInfo.description.substring(0, 50),
        description: taskInfo.description,
        confidence: 'low',
        sources_used: [],
        reasoning: 'RAG failed, using basic description',
        ragUsed: false,
        error: error.message
      };
    }
  }

  /**
   * Update a task description using RAG (prioritizes local/scoped search)
   * @param {Object} updateInfo - Task update information
   * @param {Object} options - RAG options
   * @returns {Promise<Object>} Enhanced task update
   */
  async updateTaskWithRAG(updateInfo, options = {}) {
    try {
      // First try local/scoped RAG search (current meeting only)
      let ragContext;
      try {
        ragContext = await getLocalRAGContext(updateInfo.updateInfo, {
          topK: options.topK || 5,
          scoreThreshold: options.scoreThreshold || 0.7
        });
        
        if (ragContext.success && ragContext.sources.length > 0) {
          logger.info('Using scoped RAG context for task update', {
            ticketId: updateInfo.ticketId,
            updateInfo: updateInfo.updateInfo.substring(0, 100),
            scopedSources: ragContext.sources.length,
            scopedToTranscript: ragContext.scopedToTranscript
          });
        } else {
          // Fall back to global search if local search has no results
          logger.info('Local RAG context empty for update, falling back to global search', {
            ticketId: updateInfo.ticketId,
            updateInfo: updateInfo.updateInfo.substring(0, 100)
          });
          throw new Error('No local context found, falling back to global');
        }
      } catch (localError) {
        // Fallback to global RAG search
        logger.info('Using global RAG context for task update', {
          ticketId: updateInfo.ticketId,
          updateInfo: updateInfo.updateInfo.substring(0, 100),
          reason: localError.message
        });
        
        ragContext = await getRAGContextForTask(updateInfo.updateInfo, {
          topK: options.topK || 5,
          scoreThreshold: options.scoreThreshold || 0.7
        });
      }

      if (!ragContext.success) {
        logger.warn('Failed to get RAG context for task update', {
          ticketId: updateInfo.ticketId,
          updateInfo: updateInfo.updateInfo.substring(0, 100),
          error: ragContext.error
        });
        
        // Fallback to basic update without RAG - append to existing description
        const currentDate = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY format
        return {
          success: true,
          updatedDescription: `${updateInfo.currentDescription}\n\n(${currentDate}): ${updateInfo.updateInfo}`,
          updateSummary: 'Basic update appended without RAG context',
          updateType: 'clarification',
          confidence: 'low',
          sources_used: [],
          reasoning: 'No RAG context available, appended basic update to existing description',
          ragUsed: false
        };
      }

      // Create task update chain
      const taskUpdateChain = this.createTaskUpdateChain();

      // Invoke the chain with update information and context
      const response = await taskUpdateChain.invoke({
        context: ragContext.context || 'No relevant context found.',
        ticketId: updateInfo.ticketId,
        currentDescription: updateInfo.currentDescription,
        updateInfo: updateInfo.updateInfo,
        evidence: updateInfo.evidence || '',
        additionalContext: updateInfo.additionalContext || ''
      });

      // Parse JSON response
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(response);
      } catch (parseError) {
        logger.warn('Failed to parse RAG update response as JSON, using fallback', {
          ticketId: updateInfo.ticketId,
          response: response.substring(0, 200),
          parseError: parseError.message
        });
        
        // Fallback parsing - append to existing description
        const currentDate = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY format
        parsedResponse = {
          updatedDescription: `${updateInfo.currentDescription}\n\n(${currentDate}): ${updateInfo.updateInfo}`,
          updateSummary: 'Update appended from non-JSON response',
          updateType: 'clarification',
          confidence: 'medium',
          sources_used: ragContext.sources ? ragContext.sources.map(s => s.date) : [],
          reasoning: 'Parsed from non-JSON response, appended to existing description'
        };
      }

      logger.info('Task updated using RAG', {
        ticketId: updateInfo.ticketId,
        originalLength: updateInfo.currentDescription.length,
        updatedLength: parsedResponse.updatedDescription.length,
        sourcesUsed: ragContext.sources.length,
        updateType: parsedResponse.updateType,
        confidence: parsedResponse.confidence,
        isScoped: ragContext.isScoped || false,
        scopedToTranscript: ragContext.scopedToTranscript
      });

      return {
        success: true,
        updatedDescription: parsedResponse.updatedDescription,
        updateSummary: parsedResponse.updateSummary,
        updateType: parsedResponse.updateType,
        confidence: parsedResponse.confidence,
        sources_used: parsedResponse.sources_used,
        reasoning: parsedResponse.reasoning,
        ragUsed: true,
        ragSources: ragContext.sources,
        isScoped: ragContext.isScoped || false,
        scopedToTranscript: ragContext.scopedToTranscript
      };

    } catch (error) {
      logger.error('Error updating task with RAG', {
        error: error.message,
        stack: error.stack,
        ticketId: updateInfo.ticketId,
        updateInfo: updateInfo.updateInfo.substring(0, 100)
      });

      // Fallback to basic update - append to existing description
      const currentDate = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY format
      return {
        success: true,
        updatedDescription: `${updateInfo.currentDescription}\n\n(${currentDate}): ${updateInfo.updateInfo}`,
        updateSummary: 'Basic update appended due to RAG failure',
        updateType: 'clarification',
        confidence: 'low',
        sources_used: [],
        reasoning: 'RAG failed, appended basic update to existing description',
        ragUsed: false,
        error: error.message
      };
    }
  }
}

/**
 * Test RAG service connection and functionality
 */
async function testRAGService() {
  try {
    const ragService = new TaskRAG();
    
    // Test task creation
    const testTask = {
      description: "Fix login authentication bug",
      assignee: "John",
      type: "Coding",
      evidence: "John mentioned login issues",
      context: "Authentication system discussion"
    };
    
    const creationResult = await ragService.createRichTaskDescription(testTask);
    
    // Test task update
    const testUpdate = {
      ticketId: "SP-123",
      currentDescription: "Fix login authentication bug",
      updateInfo: "Added new security requirements",
      evidence: "Security team requirements",
      additionalContext: "Meeting discussion about security"
    };
    
    const updateResult = await ragService.updateTaskWithRAG(testUpdate);
    
    logger.info('RAG service test completed', {
      creationSuccess: creationResult.success,
      updateSuccess: updateResult.success,
      creationRAGUsed: creationResult.ragUsed,
      updateRAGUsed: updateResult.ragUsed
    });
    
    return creationResult.success && updateResult.success;
  } catch (error) {
    logger.error('RAG service test failed', { error: error.message });
    return false;
  }
}

// Create singleton instance
const taskRAG = new TaskRAG();

module.exports = {
  TaskRAG,
  taskRAG,
  testRAGService
};
