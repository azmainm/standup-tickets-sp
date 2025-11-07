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

const { ChatOpenAI } = require("@langchain/openai");
const { logger } = require("firebase-functions");

// Load environment variables
require("dotenv").config();

// Initialize OpenAI client using LangChain (same as transcript-chat)
const llm = new ChatOpenAI({
  modelName: 'gpt-5-nano',
  max_output_tokens: 2000,
  reasoning: { effort: 'medium' },
  verbosity: "medium",
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

    // Extract participant names from transcript for name matching
    const { extractParticipantsFromTranscript } = require('../utilities/assigneeDetectionService');
    const participantsInMeeting = extractParticipantsFromTranscript(transcript);
    
    logger.info("Participants extracted from meeting", {
      participants: participantsInMeeting,
      count: participantsInMeeting.length
    });

    // Convert transcript to readable format
    const transcriptText = formatTranscriptForTaskFinding(transcript);
    
    // Create the task finding prompt with participant context
    const prompt = createTaskFindingPrompt(transcriptText, context, participantsInMeeting);

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
    
    // Call OpenAI using LangChain (same as transcript-chat)
    const systemMessage = createTaskFinderSystemPrompt(context);
    const messages = [
      { role: "system", content: systemMessage },
      { role: "user", content: prompt }
    ];
    
    const response = await llm.invoke(messages);
    const gptResponse = response.content;

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
      tokensUsed: response.usage_metadata?.total_tokens || 'unknown',
      transcriptIndex: context.transcriptIndex || 1
    });
    console.log("[Finder] Response received", {
      responseLength: gptResponse.length,
      tokensUsed: response.usage_metadata?.total_tokens || 'unknown',
      transcriptIndex: context.transcriptIndex || 1
    });

    // Parse the response into structured tasks with participant matching
    const foundTasks = parseTaskFinderResponse(gptResponse, participantsInMeeting);
    
    // Extract attendees from the GPT response
    const attendees = extractAttendeesFromResponse(gptResponse);
    
    // Debug: Log the end of the GPT response to see if MEETING ATTENDEES section exists
    // console.log("[DEBUG] GPT Response ending (last 500 chars):", gptResponse.slice(-500));
    
    // Apply task cancellation detection
    const finalTasks = detectAndRemoveCancelledTasks(foundTasks, transcriptText);
    
    // DEBUG: Log all found tasks
    console.log("[DEBUG] Task Finder found tasks:", {
      originalTasks: foundTasks.length,
      finalTasks: finalTasks.length,
      tasks: finalTasks.map(task => ({
        description: task.description.substring(0, 100),
        assignee: task.assignee,
        type: task.type,
        evidence: task.evidence?.substring(0, 50)
      }))
    });
    
    const totalTasks = finalTasks.length;
    const averageDescriptionLength = calculateAverageDescriptionLength(finalTasks);
    
    logger.info("Stage 1: Task Finder completed successfully", {
      totalTasksFound: totalTasks,
      averageDescriptionLength,
      transcriptIndex: context.transcriptIndex || 1,
      qualityMetric: averageDescriptionLength > 150 ? "high" : averageDescriptionLength > 100 ? "medium" : "low"
    });

    // Separate tasks into tasksToBeCreated and tasksToBeUpdated arrays
    const tasksToBeCreated = finalTasks.filter(task => task.category === 'NEW_TASK').map(task => ({
      description: task.description,
      assignee: task.assignee,
      type: task.type,
      evidence: task.evidence,
      context: task.context,
      urgency: task.urgency,
      priority: task.priority,
      estimatedTime: task.estimatedTime || 0,
      timeSpent: task.timeSpent || 0,
      storyPoints: task.storyPoints || null,
      isFuturePlan: task.isFuturePlan
    }));

    const tasksToBeUpdated = finalTasks.filter(task => task.category === 'UPDATE_TASK' && task.ticketId !== 'NONE').map(task => ({
      description: task.description,
      assignee: task.assignee,
      ticketId: task.ticketId,
      evidence: task.evidence,
      context: task.context,
      urgency: task.urgency,
      priority: task.priority,
      estimatedTime: task.estimatedTime || 0,
      timeSpent: task.timeSpent || 0,
      storyPoints: task.storyPoints || null,
    }));

    // console.log("[DEBUG] Task Finder returning attendees:", attendees);
    
    return {
      success: true,
      stage: 1,
      foundTasks: finalTasks, // Keep original for backward compatibility
      tasksToBeCreated,
      tasksToBeUpdated,
      attendees, // Add attendees to the response
      metadata: {
        totalTasks,
        tasksToBeCreated: tasksToBeCreated.length,
        tasksToBeUpdated: tasksToBeUpdated.length,
        averageDescriptionLength,
        tokensUsed: response.usage_metadata?.total_tokens || 'unknown',
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
function createTaskFindingPrompt(transcriptText, context, participantsInMeeting = []) {
  const participantsList = participantsInMeeting.length > 0 ? 
    `\n\n**PARTICIPANTS IN THIS MEETING**: ${participantsInMeeting.join(', ')}\n` : '';
  
  return `
**OBJECTIVE**: Extract ALL actionable work items from this meeting transcript with maximum detail and context.

**TASK FINDING REQUIREMENTS**:

**1. EVIDENCE-BASED EXTRACTION**:
- Identify explicit work items mentioned in the conversation
- Extract COMPLETE context for each task (not just isolated sentences)
- Include relevant details from surrounding conversation
- Capture the full scope of what needs to be done

**2. COMPREHENSIVE DESCRIPTION GATHERING**:
- For each task, gather ALL related information from the ENTIRE transcript
- Include background context, technical details, and requirements from ALL mentions
- Connect scattered information that relates to the same work item across different timestamps
- Preserve conversation flow and reasoning from multiple discussion points
- For NEW_TASK: 
  * Capture initial requirements from first mention
  * Include ANY additional details, features, or context mentioned later in the conversation
  * Combine all related discussions about the same task into comprehensive description
  * Include technical specifications, UI/UX requirements, integration needs mentioned anywhere
- For UPDATE_TASK: 
  * Extract ALL update contexts from every mention of the ticket number
  * Include progress reports, new requirements, technical additions mentioned throughout
  * Capture any clarifications, scope changes, or additional features discussed
  * Combine multiple update mentions into comprehensive update description

**3. WORK ITEM CLASSIFICATION (CRITICAL)**:

**NEW TASK PATTERNS** (EXPLICIT CREATION INTENT REQUIRED):
- EXPLICIT task creation: "create a new task", "new task for [assignee]", "add this as a new task"
- EXPLICIT assignment: "this will be a new task for me/[assignee]", "make this a new task for [person]"
- EXPLICIT work assignment: "[description] and this will be a new task", "create a task for [person] to [action]"
- EXPLICIT future plan: "as a future plan", "this is a future plan", "future plan", "future initiative"

**CRITICAL RULE**: A task should be created if the participant EXPLICITLY mentions:
- "new task" / "create a task" / "add a task" / "make a task" / "this will be a task"
- OR explicitly assigns work with "this will be a task for [person]" / "make this a task for [person]"
- OR explicitly mentions "as a future plan" / "this is a future plan" / "future plan" / "future initiative"

**DO NOT CREATE TASKS FOR VAGUE STATEMENTS**:
- General statements: "I need to...", "John should...", "[Name] will..."
- Problem mentions: "We need to fix...", "There's an issue with..."
- Casual suggestions: "We should implement...", "Maybe we could..."
- Vague considerations: "we should consider" (UNLESS followed by "as a future plan")
- General discussions about work without explicit task creation intent
- Brainstorming: "what if we...", "it would be nice to...", "eventually we could..."
- Vague future plans: "down the line", "in the future", "someday we should"

**FUTURE PLAN DETECTION**: If someone says "as a future plan" or "this is a future plan", CREATE the task with isFuturePlan=true and assignee="TBD"

**TASK CANCELLATION DETECTION**: If someone mentions a potential new task but later in the conversation says:
- "actually, let's not do that", "never mind", "scratch that", "forget about that"
- "we decided not to", "on second thought", "let's hold off on that"
- "maybe later", "not right now", "let's table that"
Then DO NOT create that task.

**TASK UPDATE PATTERNS** (ticket number explicitly mentioned):
- Status updates: "SP-XXX is completed", "SP-XXX is in progress"
- Progress reports: "I'm working on SP-XXX and...", "SP-XXX needs..."
- Task modifications: "For SP-XXX, we should also add..."
- Task discussions: "talking about SP-XXX", "regarding SP-XXX", "for SP-XXX"
- Specific ticket references: Any mention of "SP-" followed by numbers

**CLASSIFICATION RULE**: 
- If a ticket number (SP-XXX) is mentioned, it's an UPDATE to existing task
- If EXPLICIT task creation language is used (without SP-XXX), it's a NEW TASK
- If neither condition is met, DO NOT create any task entry

**4. CONTEXT PRESERVATION**:
- Include WHO mentioned the task
- Capture WHY the task is needed (if mentioned)
- Note any dependencies or requirements discussed
- Preserve timeline information ("by Friday", "next week")

**5. FUTURE PLAN DETECTION** (CREATE TASKS FOR EXPLICIT FUTURE PLANS):
Look for these patterns that indicate future plans that should become tasks:
- "as a future plan" / "this is a future plan" / "future plan" 
- "future initiative" / "this will be a future plan"
- "add this as a future plan" / "make this a future plan"

**ALSO CREATE FUTURE TASKS FOR**:
- "we should definitely consider" (when they provide specific details)
- Clear detailed future work that's being planned (not just brainstorming)

**DO NOT CREATE FUTURE TASKS FOR VAGUE PATTERNS**:
- "for the future" / "something for later" / "down the line" (VAGUE PLANNING)
- "future enhancement" / "future consideration" / "on our roadmap" (WISHFUL THINKING)
- "eventually we'll" / "in the future we should" / "someday" (GENERAL DISCUSSION)
- Casual "we should consider" without specific details

When EXPLICIT future plan language found:
- Extract the COMPLETE description of what the future plan entails
- Use conversation context to understand the full scope
- Assign to "TBD" participant (unless specifically assigned to someone)
- Mark as NEW_TASK category
- Include [IS_FUTURE_PLAN: true] in CONTEXT field

**6. TIME INFORMATION EXTRACTION**:

**ESTIMATED TIME** - Look for these patterns:
- "this will take [X] hours/days" 
- "estimated [X] hours/days"
- "should be about [X] hours/days"
- "roughly [X] hours/days"
- "approximately [X] hours"
- "I think [X] hours"
- "probably [X] days to complete"
- "needs about [X] hours"

**TIME SPENT** - Look for these patterns for EXISTING tasks only (with SP-XXX):
- "spent [X] hours on SP-XXX"
- "worked [X] hours/days on SP-XXX"
- "already put in [X] hours on SP-XXX"
- "took me [X] hours so far on SP-XXX"
- "invested [X] hours in SP-XXX"
- "used [X] hours on SP-XXX"
- "been working for [X] hours on SP-XXX"

**TIME CONVERSION RULES**:
- Only extract time when explicitly mentioned in hours or minutes
- Convert minutes to hours: "30 minutes" = 0.5 hours, "90 minutes" = 1.5 hours
- Accept word numbers: "two hours" = 2, "three hours" = 3
- Do NOT convert days, weeks, or other time units to hours

**CRITICAL RULES**:
- Only extract TIME_SPENT for UPDATE_TASK category (tasks with SP-XXX ticket IDs)
- For NEW_TASK category, TIME_SPENT should always be 0
- If no time mentioned, use 0 for both fields
- Be conservative - only extract when clearly mentioned
- Context matters: "will take" = ESTIMATED, "spent/worked" = TIME_SPENT

**7. PRIORITY EXTRACTION**:

**PRIORITY PATTERNS** - Look for these patterns to extract task priority:
- "high priority" / "high-priority" / "highly prioritized" → Highest or High
- "urgent" / "urgently" / "asap" / "as soon as possible" → Highest or High
- "critical" / "critically important" / "critical priority" → Highest
- "low priority" / "low-priority" / "not urgent" / "not a priority" → Low or Lowest
- "medium priority" / "normal priority" / "standard priority" → Medium
- "highest priority" / "top priority" / "maximum priority" → Highest
- "lowest priority" / "minimal priority" / "nice to have" → Lowest
- Context clues: "blocking", "blocker", "must have" → High or Highest
- Context clues: "can wait", "whenever", "backlog" → Low or Lowest

**PRIORITY VALUES** (Jira standard):
- Highest: For critical, blocking, or urgent tasks that must be done immediately
- High: For important tasks that need attention soon
- Medium: Default priority for most tasks (use if not mentioned)
- Low: For tasks that can be deferred
- Lowest: For nice-to-have or optional tasks

**PRIORITY EXTRACTION RULES**:
- Extract priority from explicit mentions in the conversation
- Consider urgency context and timeline information
- If priority is not mentioned, leave PRIORITY field blank (will default to Medium later)
- Use context to infer priority when explicit language is used
- Be conservative - only extract when clearly indicated

**8. STORY POINTS EXTRACTION**:

**STORY POINTS PATTERNS** - Look for these patterns to extract story points:
- "X story points" / "X points" / "X SP" / "X sp"
- "estimated X story points" / "about X points"
- "this is a X point story" / "X point task"
- "should be X points" / "probably X points"
- Context clues: "small task" (1-2 points), "medium task" (3-5 points), "large task" (8+ points)

**STORY POINTS EXTRACTION RULES**:
- Extract story points from explicit mentions in the conversation
- Story points are typically whole numbers (1, 2, 3, 5, 8, 13, etc.)
- If story points are not mentioned, leave STORY_POINTS field blank (do not add to Jira issue)
- Be conservative - only extract when clearly indicated
- Do not infer story points from estimated time or other metrics

**9. TASK CANCELLATION DETECTION**:
Scan the ENTIRE transcript for task cancellation patterns:
- If someone mentions a potential task early in the conversation
- But later says cancellation phrases like: "actually, let's not", "never mind", "scratch that", "forget about that", "we decided not to", "on second thought", "let's hold off", "maybe later", "not right now", "let's table that"
- Then DO NOT include that task in the final output
- Always check the full conversation context before finalizing any task

**10. CONTEXT GATHERING STRATEGY**:
- Scan the ENTIRE transcript for ALL mentions of each identified task
- For SP-XXX tickets: Find EVERY mention of that ticket number throughout the meeting
- For new tasks: Find the initial mention AND any subsequent elaborations or additions
- Combine information from multiple speakers if they discuss the same task
- Include all technical details, requirements, and context mentioned anywhere in the transcript
- Capture task evolution - how requirements or scope might change during discussion

**11. ASSIGNEE DETECTION WITH PARTICIPANT MATCHING**:
- "for me" / "my task" / "I will" = assign to speaker
- "for [Name]" / "[Name] will" / "[Name] should" = assign to that person
- "task for [Name] who isn't here" = assign to that person (not TBD)
- Future plans without specific assignee = assign to "TBD"

**SMART PARTICIPANT NAME MATCHING**:
- If assignee name is mentioned (e.g., "faiyaz", "john", "jane"), check if any participant in the meeting has a similar name
- Use fuzzy matching to handle spelling variations and transcript errors
- Match first names to full participant names from the meeting
- Examples:
  * "faiyaz" → find participant "Faiyaz Rahman" in meeting
  * "john" → find participant "John Doe" in meeting
  * "jane" → find participant "Jane Smith" in meeting
- Always use the FULL NAME from the participant timestamp for the assignee field
- This ensures proper task assignment even with transcript spelling errors

**OUTPUT FORMAT**:
For each task found, provide EXACTLY this format (DO NOT use bullet points or dashes):

TASK: [CLEAN, short task summary - NO prefixes like "NEW_TASK", "Purpose:", "Create a task" - just the core deliverable like "Email notification system" or "Mobile expense tracker"]
ASSIGNEE: [Person assigned or TBD]
TYPE: [Coding/Non-Coding]
CATEGORY: [NEW_TASK or UPDATE_TASK]
TICKET_ID: [SP-XXX if mentioned for updates, or "NONE" for new tasks]
ESTIMATED_TIME: [Number in hours - e.g., "3", "16" (2 days), "0" if not mentioned]
TIME_SPENT: [Number in hours - e.g., "5", "8" (1 day), "0" if not mentioned OR if NEW_TASK]
PRIORITY: [Highest/High/Medium/Low/Lowest - extract from transcript context, or leave blank if not mentioned]
STORY_POINTS: [Number - e.g., "3", "5", "8", or leave blank if not mentioned]
EVIDENCE: [ALL specific quotes from transcript related to this task - include quotes from every mention throughout the meeting]
CONTEXT: [Comprehensive context combining ALL discussions about this task - include initial mention, elaborations, technical details, and any additional requirements. Include [IS_FUTURE_PLAN: true] if this is a future plan]
URGENCY: [Any timeline mentioned]

**CRITICAL FORMATTING RULES**:
1. Start each field with the field name followed by a colon (no bullet points, no dashes)
2. Each field should be on its own line
3. For the TASK field, write ONLY the core deliverable/system/feature name
4. Examples of GOOD TASK names: "Email notification system", "Mobile expense tracker", "Blue navigation menu"
5. Examples of BAD TASK names: "NEW_TASK - Email notification system", "Purpose: Implement an email notification", "Create a task for email notifications"



**CRITICAL**: Properly classify each item as NEW_TASK or UPDATE_TASK based on whether a ticket number is mentioned.

**MEETING TRANSCRIPT**:${participantsList}
${transcriptText}

**YOUR RESPONSE**: Extract ALL actionable work items with maximum detail and context. Remember to use EXACT participant names from the meeting participant list above when assigning tasks.

**AFTER EXTRACTING ALL TASKS**: At the very end of your response, provide a section titled "MEETING ATTENDEES" that lists ONLY the initials of all meeting participants who spoke during this meeting. Extract initials from the participant names found in the transcript timestamps.

Format:
MEETING ATTENDEES: [comma-separated list of initials, e.g., "JD, AS, MR"]`;
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
function parseTaskFinderResponse(response, participantsInMeeting = []) {
  const { findBestParticipantMatch, normalizeAssigneeName } = require('../utilities/assigneeDetectionService');
  const tasks = [];
  const lines = response.split("\n");
  
  let currentTask = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith("TASK:") || trimmed.startsWith("- TASK:")) {
      // Save previous task if exists
      if (currentTask && currentTask.description) {
        tasks.push(currentTask);
      }
      
      // Start new task
      const taskText = trimmed.startsWith("- TASK:") ? 
        trimmed.replace("- TASK:", "").trim() : 
        trimmed.replace("TASK:", "").trim();
      currentTask = {
        description: taskText,
        assignee: "Unknown",
        type: "Non-Coding",
        category: "NEW_TASK", // Default to new task
        ticketId: "NONE", // Default to no ticket
        evidence: "",
        context: "",
        urgency: "",
        estimatedTime: 0,     // Default to 0 hours
        timeSpent: 0,         // Default to 0 hours
        priority: null,       // Default to null (will default to Medium in Jira)
        storyPoints: null,    // Default to null (only add to Jira if mentioned)
        isFuturePlan: false, // Default to not a future plan
        source: "task_finder",
        stage: 1
      };
    } else if (currentTask) {
      if (trimmed.startsWith('ASSIGNEE:') || trimmed.startsWith('  ASSIGNEE:')) {
        // Clean assignee name to remove any extra text like "(not present)"
        const rawAssignee = trimmed.replace(/^\s*ASSIGNEE:\s*/, '').trim();
        const cleanAssignee = rawAssignee.replace(/\s*\([^)]*\)\s*/g, '').trim();
        
        // Try to match against participants in the meeting
        if (participantsInMeeting.length > 0 && cleanAssignee !== 'TBD') {
          const matchResult = findBestParticipantMatch(cleanAssignee, participantsInMeeting);
          if (matchResult.confidence > 0.7) {
            currentTask.assignee = matchResult.participant;
            logger.info('Assignee name matched', {
              original: cleanAssignee,
              matched: matchResult.participant,
              confidence: matchResult.confidence
            });
          } else {
            currentTask.assignee = normalizeAssigneeName(cleanAssignee);
          }
        } else {
          currentTask.assignee = normalizeAssigneeName(cleanAssignee);
        }
      } else if (trimmed.startsWith('TYPE:') || trimmed.startsWith('  TYPE:')) {
        const type = trimmed.replace(/^\s*TYPE:\s*/, '').trim();
        currentTask.type = type.includes('Coding') ? 'Coding' : 'Non-Coding';
      } else if (trimmed.startsWith('CATEGORY:') || trimmed.startsWith('  CATEGORY:')) {
        const category = trimmed.replace(/^\s*CATEGORY:\s*/, '').trim();
        currentTask.category = category.includes('UPDATE_TASK') ? 'UPDATE_TASK' : 'NEW_TASK';
      } else if (trimmed.startsWith('TICKET_ID:') || trimmed.startsWith('  TICKET_ID:')) {
        const ticketId = trimmed.replace(/^\s*TICKET_ID:\s*/, '').trim();
        currentTask.ticketId = ticketId === 'NONE' ? 'NONE' : ticketId;
      } else if (trimmed.startsWith('EVIDENCE:') || trimmed.startsWith('  EVIDENCE:')) {
        currentTask.evidence = trimmed.replace(/^\s*EVIDENCE:\s*/, '').trim();
      } else if (trimmed.startsWith('CONTEXT:') || trimmed.startsWith('  CONTEXT:')) {
        currentTask.context = trimmed.replace(/^\s*CONTEXT:\s*/, '').trim();
        // Check for future plan indicator in context
        if (currentTask.context.includes('[IS_FUTURE_PLAN: true]')) {
          currentTask.isFuturePlan = true;
          currentTask.assignee = 'TBD'; // Force assignee to TBD for future plans
        }
      } else if (trimmed.startsWith('URGENCY:') || trimmed.startsWith('  URGENCY:')) {
        currentTask.urgency = trimmed.replace(/^\s*URGENCY:\s*/, '').trim();
      } else if (trimmed.startsWith('ESTIMATED_TIME:') || trimmed.startsWith('  ESTIMATED_TIME:')) {
        const timeStr = trimmed.replace(/^\s*ESTIMATED_TIME:\s*/, '').trim();
        currentTask.estimatedTime = parseTimeStringToHours(timeStr);
      } else if (trimmed.startsWith('TIME_SPENT:') || trimmed.startsWith('  TIME_SPENT:')) {
        const timeStr = trimmed.replace(/^\s*TIME_SPENT:\s*/, '').trim();
        currentTask.timeSpent = parseTimeStringToHours(timeStr);
      } else if (trimmed.startsWith('PRIORITY:') || trimmed.startsWith('  PRIORITY:')) {
        const priorityStr = trimmed.replace(/^\s*PRIORITY:\s*/, '').trim();
        // Normalize priority to Jira standard values
        if (priorityStr && priorityStr.length > 0) {
          const normalizedPriority = normalizePriority(priorityStr);
          currentTask.priority = normalizedPriority;
        }
      } else if (trimmed.startsWith('STORY_POINTS:') || trimmed.startsWith('  STORY_POINTS:')) {
        const storyPointsStr = trimmed.replace(/^\s*STORY_POINTS:\s*/, '').trim();
        // Parse story points as integer, set to null if not provided or empty
        if (storyPointsStr && storyPointsStr.length > 0) {
          const storyPoints = parseInt(storyPointsStr, 10);
          if (!isNaN(storyPoints) && storyPoints > 0) {
            currentTask.storyPoints = storyPoints;
          }
        }
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
 * Detect and remove tasks that were mentioned but later cancelled in the conversation
 * @param {Array} tasks - Array of found tasks
 * @param {string} transcriptText - Full transcript text
 * @returns {Array} Filtered tasks with cancelled ones removed
 */
function detectAndRemoveCancelledTasks(tasks, transcriptText) {
  if (!tasks || tasks.length === 0) return tasks;
  
  // Cancellation patterns to look for
  const cancellationPatterns = [
    /actually,?\s*let's not(?:\s+do\s+that)?/i,
    /never\s*mind/i,
    /scratch\s+that/i,
    /forget\s+about\s+that/i,
    /we\s+decided\s+not\s+to/i,
    /on\s+second\s+thought/i,
    /let's\s+hold\s+off\s+on\s+that/i,
    /maybe\s+later/i,
    /not\s+right\s+now/i,
    /let's\s+table\s+that/i,
    /actually,?\s*don't/i,
    /changed\s+my\s+mind/i,
    /let's\s+skip\s+that/i
  ];
  
  const lowerTranscript = transcriptText.toLowerCase();
  
  // Check if any cancellation pattern appears in the transcript
  const hasCancellation = cancellationPatterns.some(pattern => pattern.test(lowerTranscript));
  
  if (!hasCancellation) {
    return tasks; // No cancellation detected, return all tasks
  }
  
  logger.info("Task cancellation patterns detected in transcript", {
    taskCount: tasks.length,
    patterns: cancellationPatterns.filter(pattern => pattern.test(lowerTranscript)).map(p => p.source)
  });
  
  // For now, we'll keep all tasks but log the detection
  // In a more sophisticated implementation, we could try to match specific tasks to cancellations
  // This would require understanding the context around each cancellation phrase
  
  return tasks;
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
 * Normalize priority string to Jira standard values
 * @param {string} priorityStr - Priority string from LLM response
 * @returns {string|null} Normalized priority (Highest/High/Medium/Low/Lowest) or null if invalid
 */
function normalizePriority(priorityStr) {
  if (!priorityStr || typeof priorityStr !== "string") return null;
  
  const normalized = priorityStr.trim();
  const lower = normalized.toLowerCase();
  
  // Map to Jira standard values
  if (lower === "highest" || lower === "highest priority") {
    return "Highest";
  }
  if (lower === "high" || lower === "high priority") {
    return "High";
  }
  if (lower === "medium" || lower === "medium priority" || lower === "normal" || lower === "standard") {
    return "Medium";
  }
  if (lower === "low" || lower === "low priority") {
    return "Low";
  }
  if (lower === "lowest" || lower === "lowest priority" || lower === "minimal") {
    return "Lowest";
  }
  
  // If it doesn't match, return null (will default to Medium in Jira)
  return null;
}

/**
 * Parse time string to hours (only hours and minutes)
 * @param {string} timeStr - Time string to parse
 * @returns {number} Time in hours
 */
function parseTimeStringToHours(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return 0;
  
  const str = timeStr.toLowerCase().trim();
  
  // Direct hour matches: "3 hours", "2.5 hours", "1 hr"
  let hourMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:hour|hr)s?/);
  if (hourMatch) {
    return parseFloat(hourMatch[1]);
  }
  
  // Minute matches: "30 minutes", "90 mins", "45 min"
  let minuteMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:minute|min)s?/);
  if (minuteMatch) {
    return parseFloat(minuteMatch[1]) / 60; // Convert minutes to hours
  }
  
  // Word numbers for hours only - order matters (longer words first)
  const wordNumbers = [
    ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
    ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
    ["couple", 2], ["few", 3], ["several", 4], ["half", 0.5], ["an", 1], ["a", 1]
  ];
  
  for (const [word, num] of wordNumbers) {
    if (str.includes(word)) {
      if (str.includes("hour") || str.includes("hr")) {
        return num;
      }
      if (str.includes("minute") || str.includes("min")) {
        return num / 60; // Convert minutes to hours
      }
      // Only return word numbers if they're standalone (no time units and no other words)
      if (!str.includes("hour") && !str.includes("hr") && !str.includes("minute") && !str.includes("min") && 
          !str.includes("day") && !str.includes("week") && !str.includes("month") && !str.includes("year")) {
        // Check if the string is just the word number or word number + whitespace
        const cleanStr = str.replace(/\s+/g, ' ').trim();
        if (cleanStr === word || cleanStr === word + 's') {
          return num;
        }
      }
    }
  }
  
  // If it's already a number (and no time unit), return it
  // But don't convert if it contains day/week/month/year units
  if (!str.includes("day") && !str.includes("week") && !str.includes("month") && !str.includes("year")) {
    const directNumber = parseFloat(str);
    if (!isNaN(directNumber)) {
      return Math.max(0, directNumber);
    }
  }
  
  return 0;
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
        text: "<v John>I need to create a new task to fix the authentication bug in the login system.</v>"
      },
      {
        speaker: "00:00:05.000", 
        text: "<v Jane>That sounds good. I'll also add a new task for the dashboard updates.</v>"
      }
    ];
    
    const result = await findTasksFromTranscript(testTranscript);
    return result.success && result.foundTasks.length > 0;
  } catch (error) {
    logger.error("Task Finder service test failed", { error: error.message });
    return false;
  }
}

/**
 * Extract attendees initials from GPT response
 * @param {string} response - GPT response containing tasks and attendees
 * @returns {string} Comma-separated list of attendee initials
 */
function extractAttendeesFromResponse(response) {
  try {
    console.log("[DEBUG] Searching for MEETING ATTENDEES in response...");
    
    // Look for the MEETING ATTENDEES section in the response
    const attendeesMatch = response.match(/MEETING ATTENDEES:\s*([^.\n\r]+)/i);
    
    console.log("[DEBUG] Attendees regex match result:", attendeesMatch);
    
    if (attendeesMatch && attendeesMatch[1]) {
      // Clean up the attendees string - remove extra spaces, brackets, quotes
      const attendeesStr = attendeesMatch[1]
        .replace(/[\[\]"']/g, '') // Remove brackets and quotes
        .trim();
      
      // Split by comma and clean each initial
      const initials = attendeesStr
        .split(',')
        .map(initial => initial.trim())
        .filter(initial => initial.length > 0 && initial.length <= 5) // Basic validation
        .join(', ');
      
      console.log("[DEBUG] Extracted attendees:", {
        raw: attendeesMatch[1],
        cleaned: initials
      });
      
      logger.info("Extracted meeting attendees", {
        raw: attendeesMatch[1],
        cleaned: initials
      });
      
      return initials;
    }
    
    console.log("[DEBUG] No MEETING ATTENDEES section found in response");
    logger.warn("No MEETING ATTENDEES section found in response");
    return "";
    
  } catch (error) {
    console.log("[DEBUG] Error extracting attendees:", error.message);
    logger.error("Error extracting attendees from response", {
      error: error.message
    });
    return "";
  }
}

module.exports = {
  findTasksFromTranscript,
  testTaskFinderService,
  formatTranscriptForTaskFinding,
  parseTaskFinderResponse,
  calculateAverageDescriptionLength,
  createTaskFinderSystemPrompt,
  createTaskFindingPrompt,
  detectAndRemoveCancelledTasks,
  parseTimeStringToHours,
  extractAttendeesFromResponse
};
