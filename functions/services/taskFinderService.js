/**
 * Task Finder Service - Stage 1 of 3-Stage Pipeline
 * 
 * This service implements the Scrum Task Finder role, focusing on pure extraction
 * of actionable work items from meeting transcripts with maximum detail and context.
 * 
 * Role: Scrum Task Finder
 * - Epistemic stance: Analytical, Evidence-oriented, Context-aware
 * - Communication style: Structured, Traceable, Concise
 * - Values: Clarity, Accuracy
 * - Domain: Task Recognition, Knowledge Structuring, Information Extraction
 */

const OpenAI = require("openai");
const { logger } = require("firebase-functions");

// Load environment variables
require("dotenv").config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Stage 1: Find all actionable tasks from transcript (Pure Extraction)
 * @param {Array} transcript - Array of transcript entries
 * @param {Object} context - Optional context for multi-transcript processing
 * @returns {Promise<Object>} Found tasks with detailed descriptions
 */
async function findTasksFromTranscript(transcript, context = {}) {
  try {
    logger.info("Starting Stage 1: Task Finder", {
      entryCount: transcript.length,
      transcriptIndex: context.transcriptIndex || 1,
      isMultiTranscript: Boolean(context.isMultiTranscript),
      timestamp: new Date().toISOString(),
    });

    // Convert transcript to readable format
    const transcriptText = formatTranscriptForTaskFinding(transcript);
    
    // Create the task finding prompt
    const prompt = createTaskFindingPrompt(transcriptText, context);

    logger.info("Stage 1: Task Finder prompt created", {
      transcriptChars: transcriptText.length,
      promptChars: prompt.length,
      promptPreview: prompt.substring(0, 500)
    });
    console.log("[Finder] Prompt created", {
      transcriptChars: transcriptText.length,
      promptChars: prompt.length,
      promptPreview: prompt.substring(0, 500)
    });
    
    // Call OpenAI with maximum token allocation for detailed descriptions
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: createTaskFinderSystemPrompt(context)
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3, // Slightly higher for better context extraction
      max_tokens: 4000, // Maximum tokens for detailed descriptions
    });

    const gptResponse = response.choices[0].message.content;

    logger.info("Stage 1: Task Finder raw response (preview)", {
      responseChars: gptResponse ? gptResponse.length : 0,
      responsePreview: gptResponse ? gptResponse.substring(0, 500) : undefined
    });
    console.log("[Finder] Raw response (preview)", {
      responseChars: gptResponse ? gptResponse.length : 0,
      responsePreview: gptResponse ? gptResponse.substring(0, 500) : undefined
    });
    logger.info("Stage 1: Task Finder response received", {
      responseLength: gptResponse.length,
      tokensUsed: response.usage.total_tokens,
      tokenEfficiency: (gptResponse.length / response.usage.total_tokens).toFixed(2),
      transcriptIndex: context.transcriptIndex || 1
    });
    console.log("[Finder] Response received", {
      responseLength: gptResponse.length,
      tokensUsed: response.usage.total_tokens,
      tokenEfficiency: (gptResponse.length / response.usage.total_tokens).toFixed(2),
      transcriptIndex: context.transcriptIndex || 1
    });

    // Parse the response into structured tasks
    const foundTasks = parseTaskFinderResponse(gptResponse);
    
    const totalTasks = foundTasks.length;
    const averageDescriptionLength = calculateAverageDescriptionLength(foundTasks);
    
    logger.info("Stage 1: Task Finder completed successfully", {
      totalTasksFound: totalTasks,
      averageDescriptionLength,
      transcriptIndex: context.transcriptIndex || 1,
      qualityMetric: averageDescriptionLength > 150 ? "high" : averageDescriptionLength > 100 ? "medium" : "low"
    });

    return {
      success: true,
      stage: 1,
      foundTasks,
      metadata: {
        totalTasks,
        averageDescriptionLength,
        tokensUsed: response.usage.total_tokens,
        tokenEfficiency: (gptResponse.length / response.usage.total_tokens).toFixed(2),
        processedAt: new Date().toISOString(),
        transcriptIndex: context.transcriptIndex || 1
      },
      rawResponse: gptResponse
    };

  } catch (error) {
    logger.error("Stage 1: Task Finder failed", {
      error: error.message,
      stack: error.stack,
      transcriptEntries: transcript.length,
      transcriptIndex: context.transcriptIndex || 1
    });
    
    throw new Error(`Task Finder (Stage 1) failed: ${error.message}`);
  }
}

/**
 * Create system prompt for Task Finder role
 * @param {Object} context - Processing context
 * @returns {string} System prompt
 */
function createTaskFinderSystemPrompt(context) {
  const roleDescription = `You are a Scrum Task Finder with the following identity:

**Role Identity**: Scrum Task Finder
- **Epistemic stance**: Analytical, Evidence-oriented, Context-aware
- **Communication style**: Structured, Traceable, Concise  
- **Values and priorities**: Clarity, Accuracy
- **Domain orientation**: Task Recognition, Knowledge Structuring, Information Extraction

**Constraints**:
- Maintain neutrality - avoid speculative interpretation or over-formatting
- Focus strictly on clarity and grounded accuracy
- Do not assume advisory, prioritization, or coaching functions

**Core Purpose**: Detect and surface actionable tasks from meeting transcripts in a way that aligns with Scrum practices. Focus on recognizing explicit work items, structuring them clearly, and ensuring they are both accurate and contextually grounded.`;

  let contextualAddition = "";
  if (context.isMultiTranscript) {
    contextualAddition = `

**Multi-Transcript Context**:
- This is transcript ${context.transcriptIndex} of ${context.totalTranscripts}
- Extract tasks specific to THIS meeting only
- Provide maximum detail and context for each task
- Focus on evidence-based extraction without interpretation`;
  }

  return roleDescription + contextualAddition;
}

/**
 * Create task finding prompt with comprehensive instructions
 * @param {string} transcriptText - Formatted transcript text
 * @param {Object} context - Processing context
 * @returns {string} Task finding prompt
 */
function createTaskFindingPrompt(transcriptText, context) {
  return `
**OBJECTIVE**: Extract ALL actionable work items from this meeting transcript with maximum detail and context.

**TASK FINDING REQUIREMENTS**:

**1. EVIDENCE-BASED EXTRACTION**:
- Identify explicit work items mentioned in the conversation
- Extract COMPLETE context for each task (not just isolated sentences)
- Include relevant details from surrounding conversation
- Capture the full scope of what needs to be done

**2. COMPREHENSIVE DESCRIPTION GATHERING**:
- For each task, gather ALL related information from the transcript
- Include background context, technical details, and requirements
- Connect scattered information that relates to the same work item
- Preserve conversation flow and reasoning

**3. WORK ITEM IDENTIFICATION PATTERNS**:
- Direct assignments: "I need to...", "John should...", "[Name] will..."
- Problem statements: "We need to fix...", "There's an issue with..."
- Future work: "We should implement...", "Next we need to..."
- Status updates: "I completed...", "Working on...", "Started..."
- Task refinements: "Actually, that task should include..."

**4. CONTEXT PRESERVATION**:
- Include WHO mentioned the task
- Capture WHY the task is needed (if mentioned)
- Note any dependencies or requirements discussed
- Preserve timeline information ("by Friday", "next week")

**5. ASSIGNEE DETECTION**:
- "for me" / "my task" / "I will" = assign to speaker
- "for [Name]" / "[Name] will" / "[Name] should" = assign to that person
- "task for [Name] who isn't here" = assign to that person (not TBD)
- Future plans without specific assignee = assign to "TBD"

**OUTPUT FORMAT**:
For each task found, provide:
\`\`\`
TASK: [Detailed task description with full context]
ASSIGNEE: [Person assigned or TBD]
TYPE: [Coding/Non-Coding]
EVIDENCE: [Specific quote from transcript]
CONTEXT: [Surrounding conversation context]
URGENCY: [Any timeline mentioned]
\`\`\`

**MEETING TRANSCRIPT**:
${transcriptText}

**YOUR RESPONSE**: Extract ALL actionable work items with maximum detail and context.`;
}

/**
 * Format transcript for task finding (clean and readable)
 * @param {Array} transcript - Array of transcript entries
 * @returns {string} Formatted transcript text
 */
function formatTranscriptForTaskFinding(transcript) {
  return transcript
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
        
        // Skip entries with empty speaker names
        if (!speaker || speaker.length === 0) {
          return "";
        }
      } else {
        // Fallback: clean up speaker field if no <v> tag found
        speaker = entry.speaker
          .replace(/<[^>]*>/g, "") // Remove HTML tags
          .replace(/^v\s+/, "") // Remove 'v ' prefix if present
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
}

/**
 * Parse Task Finder response into structured format
 * @param {string} response - GPT response
 * @returns {Array} Array of found tasks
 */
function parseTaskFinderResponse(response) {
  const tasks = [];
  const lines = response.split('\n');
  
  let currentTask = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('TASK:')) {
      // Save previous task if exists
      if (currentTask && currentTask.description) {
        tasks.push(currentTask);
      }
      
      // Start new task
      currentTask = {
        description: trimmed.replace('TASK:', '').trim(),
        assignee: 'Unknown',
        type: 'Non-Coding',
        evidence: '',
        context: '',
        urgency: '',
        source: 'task_finder',
        stage: 1
      };
    } else if (currentTask) {
      if (trimmed.startsWith('ASSIGNEE:')) {
        currentTask.assignee = trimmed.replace('ASSIGNEE:', '').trim();
      } else if (trimmed.startsWith('TYPE:')) {
        const type = trimmed.replace('TYPE:', '').trim();
        currentTask.type = type.includes('Coding') ? 'Coding' : 'Non-Coding';
      } else if (trimmed.startsWith('EVIDENCE:')) {
        currentTask.evidence = trimmed.replace('EVIDENCE:', '').trim();
      } else if (trimmed.startsWith('CONTEXT:')) {
        currentTask.context = trimmed.replace('CONTEXT:', '').trim();
      } else if (trimmed.startsWith('URGENCY:')) {
        currentTask.urgency = trimmed.replace('URGENCY:', '').trim();
      }
    }
  }
  
  // Save last task if exists
  if (currentTask && currentTask.description) {
    tasks.push(currentTask);
  }
  
  // Filter out invalid tasks
  return tasks.filter(task => 
    task.description && 
    task.description.length > 5 && 
    !task.description.includes('[') &&
    task.assignee !== 'Unknown'
  );
}

/**
 * Calculate average description length
 * @param {Array} tasks - Array of tasks
 * @returns {number} Average description length
 */
function calculateAverageDescriptionLength(tasks) {
  if (tasks.length === 0) return 0;
  
  const totalLength = tasks.reduce((sum, task) => sum + (task.description?.length || 0), 0);
  return Math.round(totalLength / tasks.length);
}

/**
 * Test Task Finder service connection
 * @returns {Promise<boolean>} True if service is working
 */
async function testTaskFinderService() {
  try {
    const testTranscript = [
      {
        speaker: "00:00:01.000",
        text: "<v John>I need to fix the authentication bug in the login system.</v>"
      },
      {
        speaker: "00:00:05.000", 
        text: "<v Jane>That sounds good. I'll work on the dashboard updates.</v>"
      }
    ];
    
    const result = await findTasksFromTranscript(testTranscript);
    return result.success && result.foundTasks.length > 0;
  } catch (error) {
    logger.error("Task Finder service test failed", { error: error.message });
    return false;
  }
}

module.exports = {
  findTasksFromTranscript,
  testTaskFinderService,
  formatTranscriptForTaskFinding,
  parseTaskFinderResponse,
  calculateAverageDescriptionLength,
  createTaskFinderSystemPrompt,
  createTaskFindingPrompt
};
