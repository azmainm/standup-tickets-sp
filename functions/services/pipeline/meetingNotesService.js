/**
 * Meeting Notes Generation Service
 * 
 * This service generates comprehensive meeting notes from processed transcripts
 * after task creation and updating is complete. 
 */

const { ChatOpenAI } = require("@langchain/openai");
const { logger } = require("firebase-functions");

// Load environment variables
require("dotenv").config();

// Initialize OpenAI client using LangChain (same as other services)
const llm = new ChatOpenAI({
  modelName: 'gpt-4o-mini',
  max_output_tokens: 2000,
  reasoning: { effort: 'medium' },
  verbosity: "medium",
});

/**
 * Generate meeting notes from transcript and task processing results
 * @param {Array} transcript - Array of transcript entries
 * @param {Array} createdTasks - Array of tasks that were created
 * @param {Array} updatedTasks - Array of tasks that were updated
 * @param {string} attendees - Comma-separated list of attendee initials
 * @returns {Promise<Object>} Meeting notes generation result
 */
async function generateMeetingNotes(transcript, createdTasks = [], updatedTasks = [], attendees = "") {
  try {
    logger.info("Starting meeting notes generation", {
      transcriptEntries: transcript.length,
      createdTasksCount: createdTasks.length,
      updatedTasksCount: updatedTasks.length,
      attendees: attendees
    });

    // Format transcript for notes generation
    const transcriptText = formatTranscriptForNotes(transcript);
    
    // Create the meeting notes prompt
    const prompt = createMeetingNotesPrompt(transcriptText, createdTasks, updatedTasks, attendees);

    logger.info("Meeting notes prompt created", {
      transcriptChars: transcriptText.length,
      promptChars: prompt.length
    });
    
    // Call OpenAI using LangChain
    const systemMessage = createMeetingNotesSystemPrompt();
    const messages = [
      { role: "system", content: systemMessage },
      { role: "user", content: prompt }
    ];
    
    const response = await llm.invoke(messages);
    const meetingNotes = response.content;

    logger.info("Meeting notes generated successfully", {
      notesLength: meetingNotes.length,
      tokensUsed: response.usage_metadata?.total_tokens || 'unknown'
    });

    return {
      success: true,
      meetingNotes,
      metadata: {
        notesLength: meetingNotes.length,
        tokensUsed: response.usage_metadata?.total_tokens || 'unknown',
        generatedAt: new Date().toISOString(),
        transcriptEntries: transcript.length,
        tasksProcessed: createdTasks.length + updatedTasks.length
      }
    };

  } catch (error) {
    logger.error("Meeting notes generation failed", {
      error: error.message,
      stack: error.stack,
      transcriptEntries: transcript.length
    });
    
    throw new Error(`Meeting notes generation failed: ${error.message}`);
  }
}

/**
 * Create system prompt for meeting notes generation
 * @returns {string} System prompt
 */
function createMeetingNotesSystemPrompt() {
  return `You are a professional meeting notes generator. Your role is to create comprehensive, well-structured meeting notes that capture the essence of the discussion and outcomes.

**Your Expertise**:
- Meeting documentation and summarization
- Professional communication
- Task and decision tracking
- Clear, actionable writing

**Your Approach**:
- Analytical and thorough
- Structured and organized  
- Professional tone
- Focus on outcomes and decisions`;
}

/**
 * Create meeting notes generation prompt
 * @param {string} transcriptText - Formatted transcript text
 * @param {Array} createdTasks - Array of created tasks
 * @param {Array} updatedTasks - Array of updated tasks
 * @param {string} attendees - Attendee initials
 * @returns {string} Meeting notes prompt
 */
function createMeetingNotesPrompt(transcriptText, createdTasks, updatedTasks, attendees) {
  // Format created tasks for the prompt
  const createdTasksText = createdTasks.length > 0 ? 
    createdTasks.map((task, index) => {
      const ticketId = task.ticketId || task.ticket_id || `SP-${task.id || 'NEW'}`;
      return `${index + 1}. ${ticketId}: ${task.title || task.description}`;
    }).join('\n') : 'No new tasks were created.';

  // Format updated tasks for the prompt  
  const updatedTasksText = updatedTasks.length > 0 ?
    updatedTasks.map((task, index) => {
      const ticketId = task.ticketId || task.ticket_id || task.taskId || 'Unknown';
      return `${index + 1}. ${ticketId}`;
    }).join('\n') : 'No existing tasks were updated.';

  return `**OBJECTIVE**: Generate comprehensive meeting notes from this transcript and task processing results.

**MEETING NOTES REQUIREMENTS**:

**1. STRUCTURE**: Create well-organized meeting notes with clear sections:
   - Meeting Summary
   - Key Discussion Points  
   - Decisions Made
   - Tasks Created
   - Tasks Updated
   - Next Steps/Action Items

**2. MEETING SUMMARY**: 
   - Provide a concise 2-3 sentence overview of the meeting's main purpose and outcomes
   - Capture the overall theme and key achievements

**3. KEY DISCUSSION POINTS**:
   - Summarize the main topics discussed during the meeting
   - Include important technical details, requirements, or concerns raised
   - Organize by topic or theme where appropriate
   - Focus on substantive discussions, not casual conversation

**4. DECISIONS MADE**:
   - List any explicit decisions, approvals, or conclusions reached
   - Include context for why decisions were made
   - Note any alternatives that were considered and rejected

**5. TASKS CREATED**:
   - List all new tasks that were created with their ticket IDs and titles
   - Include brief context about why each task was needed
   - Format: "SP-XXX: Task Title - Brief context"

**6. TASKS UPDATED**:
   - List all existing tasks that were updated with their ticket IDs
   - Note what type of updates were made (progress, completion, modifications)
   - Format: "SP-XXX - Update type/status"

**7. NEXT STEPS/ACTION ITEMS**:
   - Identify any follow-up actions or future plans discussed
   - Include timelines or deadlines if mentioned
   - Note any dependencies or blockers

**WRITING GUIDELINES**:
- Use professional, clear language
- Write in past tense (this meeting already happened)
- Be concise but comprehensive
- Use bullet points and numbered lists for clarity
- Avoid verbatim quotes unless they capture important decisions
- Focus on outcomes and actionable information

**MEETING TRANSCRIPT**:
${transcriptText}

**TASKS CREATED DURING PROCESSING**:
${createdTasksText}

**TASKS UPDATED DURING PROCESSING**:
${updatedTasksText}

**MEETING ATTENDEES**: ${attendees || 'Not specified'}

**YOUR RESPONSE**: Generate comprehensive meeting notes following the structure and requirements above. Make the notes professional, actionable, and valuable for future reference.`;
}

/**
 * Format transcript for meeting notes generation
 * @param {Array} transcript - Array of transcript entries
 * @returns {string} Formatted transcript text
 */
function formatTranscriptForNotes(transcript) {
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

module.exports = {
  generateMeetingNotes,
  createMeetingNotesSystemPrompt,
  createMeetingNotesPrompt,
  formatTranscriptForNotes
};
