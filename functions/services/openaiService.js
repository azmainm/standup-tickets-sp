/**
 * OpenAI Service for processing meeting transcripts and extracting tasks
 * 
 * This service takes a meeting transcript and uses GPT to:
 * 1. Identify participants and their tasks
 * 2. Categorize tasks as coding or non-coding
 * 3. Return structured task data
 */

const OpenAI = require('openai');
const {logger} = require("firebase-functions");

// Load environment variables
require('dotenv').config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Process transcript and extract tasks for each participant
 * @param {Array} transcript - Array of transcript entries with speaker, startTime, endTime, text
 * @returns {Promise<Object>} Structured task data organized by participant
 */
async function processTranscriptForTasks(transcript) {
  try {
    logger.info('Starting OpenAI processing for transcript', {
      entryCount: transcript.length,
      timestamp: new Date().toISOString(),
    });

    // Convert transcript to a readable format for GPT
    const transcriptText = formatTranscriptForGPT(transcript);
    
    // Create the prompt for GPT
    const prompt = createTaskExtractionPrompt(transcriptText);
    
    // Call OpenAI GPT API
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', 
      messages: [
        {
          role: 'system',
          content: 'You are an expert meeting analyst who extracts actionable tasks from meeting transcripts and categorizes them by participant and task type.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3, 
      max_tokens: 2000,
    });

    const gptResponse = response.choices[0].message.content;
    logger.info('OpenAI response received', {
      responseLength: gptResponse.length,
      tokensUsed: response.usage.total_tokens,
    });

    // Parse the GPT response into structured data
    const structuredTasks = parseGPTResponse(gptResponse);
    
    logger.info('Successfully processed transcript', {
      participantCount: Object.keys(structuredTasks).length,
      totalTasks: Object.values(structuredTasks).reduce((total, participant) => 
        total + (participant.Coding?.length || 0) + (participant['Non-Coding']?.length || 0), 0
      ),
    });

    return {
      success: true,
      tasks: structuredTasks,
      rawGptResponse: gptResponse,
      metadata: {
        model: 'gpt-4o-mini',
        tokensUsed: response.usage.total_tokens,
        processedAt: new Date().toISOString(),
        participantCount: Object.keys(structuredTasks).length,
      }
    };

  } catch (error) {
    logger.error('Error processing transcript with OpenAI', {
      error: error.message,
      stack: error.stack,
    });
    
    throw new Error(`OpenAI processing failed: ${error.message}`);
  }
}

/**
 * Format transcript entries into readable text for GPT processing
 * @param {Array} transcript - Array of transcript entries
 * @returns {string} Formatted transcript text
 */
function formatTranscriptForGPT(transcript) {
  return transcript
    .map(entry => {
      // Extract speaker name from the text field using <v ParticipantName> format
      let speaker = 'Unknown';
      let text = entry.text || '';
      
      // Look for <v ParticipantName> pattern in the text
      const speakerMatch = text.match(/<v\s*([^>]+)>/);
      if (speakerMatch) {
        speaker = speakerMatch[1].trim();
        // Remove the <v ParticipantName> tag from the text
        text = text.replace(/<v[^>]*>/, '').replace(/<\/v>/, '').trim();
        
        // Skip entries with empty speaker names
        if (!speaker || speaker.length === 0) {
          return '';
        }
      } else {
        // Fallback: clean up speaker field if no <v> tag found
        speaker = entry.speaker
          .replace(/<[^>]*>/g, '') // Remove HTML tags
          .replace(/^v\s+/, '') // Remove 'v ' prefix if present
          .trim();
        
        // Clean up text (remove all HTML tags)
        text = text.replace(/<[^>]*>/g, '').trim();
      }
      
      // Only return meaningful entries
      if (text.length > 0) {
        return `${speaker}: ${text}`;
      }
      return '';
    })
    .filter(line => line.trim().length > 0) // Remove empty lines
    .join('\n');
}

/**
 * Create the prompt for GPT to extract tasks
 * @param {string} transcriptText - Formatted transcript text
 * @returns {string} GPT prompt
 */
function createTaskExtractionPrompt(transcriptText) {
  return `
Please analyze the following meeting transcript and extract ONLY actual actionable tasks for each participant.

**Critical Instructions:**
1. ONLY extract tasks that are explicitly mentioned, assigned, or committed to in the conversation
2. Look for phrases like "I will...", "I'm going to...", "I need to...", "I'll work on...", "My task is...", etc.
3. Do NOT create fake or example tasks
4. Do NOT include general discussion topics as tasks
5. If NO actual tasks are mentioned in the transcript, respond with: "NO TASKS IDENTIFIED"
6. Categorize actual tasks as "Coding" (development/technical work) or "Non-Coding" (documentation/research/meetings)

**Required Output Format (ONLY if tasks are found):**
[Actual Participant Name]'s Tasks:
1. [Actual task mentioned] (Coding/Non-Coding)

**Meeting Transcript:**
${transcriptText}

**Response:**`;
}

/**
 * Parse GPT response into structured task data
 * @param {string} gptResponse - Raw response from GPT
 * @returns {Object} Structured task data organized by participant
 */
function parseGPTResponse(gptResponse) {
  const structuredTasks = {};
  
  // Check if GPT responded with no tasks found
  if (gptResponse.trim().toUpperCase().includes('NO TASKS IDENTIFIED')) {
    return structuredTasks; // Return empty object
  }
  
  const lines = gptResponse.split('\n').filter(line => line.trim());
  let currentParticipant = null;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Skip placeholder/example lines that contain brackets
    if (trimmedLine.includes('[') && trimmedLine.includes(']')) {
      continue;
    }
    
    // Check if line is a participant header (ends with "Tasks:" or "'s Tasks:")
    const participantMatch = trimmedLine.match(/^(.+?)(?:'s)?\s+Tasks:$/i);
    if (participantMatch) {
      currentParticipant = participantMatch[1].trim();
      
      // Skip if this is a placeholder name
      if (currentParticipant.includes('[') || 
          currentParticipant.includes('Participant Name') ||
          currentParticipant.includes('Next Participant') ||
          currentParticipant.includes('Another Participant')) {
        currentParticipant = null;
        continue;
      }
      
      structuredTasks[currentParticipant] = {
        'Coding': [],
        'Non-Coding': []
      };
      continue;
    }
    
    // Check if line is a task item (starts with number and period)
    const taskMatch = trimmedLine.match(/^\d+\.\s*(.+?)\s*\((Coding|Non-Coding)\)\.?$/i);
    if (taskMatch && currentParticipant) {
      const taskDescription = taskMatch[1].trim();
      const taskType = taskMatch[2]; // 'Coding' or 'Non-Coding'
      
      // Skip if this looks like a placeholder task (only obvious placeholders)
      if (taskDescription.includes('[') || 
          taskDescription.includes('Task description') ||
          taskDescription.includes('Actual task mentioned')) {
        continue;
      }
      
      if (structuredTasks[currentParticipant]) {
        structuredTasks[currentParticipant][taskType].push(taskDescription);
      }
    }
  }
  
  // Clean up empty participants (remove participants with no tasks)
  Object.keys(structuredTasks).forEach(participant => {
    const tasks = structuredTasks[participant];
    if (tasks.Coding.length === 0 && tasks['Non-Coding'].length === 0) {
      delete structuredTasks[participant];
    }
  });
  
  return structuredTasks;
}

/**
 * Test function to validate OpenAI API connection
 * @returns {Promise<boolean>} True if connection successful
 */
async function testOpenAIConnection() {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: 'Hello, please respond with "Connection successful"'
        }
      ],
      max_tokens: 10,
    });
    
    return response.choices[0].message.content.includes('successful');
  } catch (error) {
    logger.error('OpenAI connection test failed', { error: error.message });
    return false;
  }
}

module.exports = {
  processTranscriptForTasks,
  testOpenAIConnection,
  formatTranscriptForGPT,
  parseGPTResponse,
};
