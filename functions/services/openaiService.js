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
Please analyze the following meeting transcript and extract ONLY actual actionable tasks for each participant. Our system uses unique task IDs in the format SP-{number} (e.g., SP-25, SP-30, SP-32) to track tasks.

**CRITICAL - Task ID Detection:**
1. **EXISTING TASK UPDATES**: If a participant mentions a task ID like "SP-25", "Task SP-30", "SP-32 -", "SP32", "SP 25", etc., they are referring to an EXISTING task
2. **NEW TASKS**: If NO task ID is mentioned when discussing a task, it's a NEW task that needs to be created
3. **Task ID Formats to Look For**: 
   - "SP-XX", "SP XX", "SPXX" (with or without dash/space)
   - "Task SP-XX", "ticket SP-XX", "SP-XX -"
   - "SP3", "SP12", "SP25" (with any number)
   - Case insensitive: "sp-25", "Sp-30", "SP-32"

**Critical Instructions:**
4. ONLY extract tasks that are explicitly mentioned, assigned, or committed to in the conversation
5. Look for phrases like "I will...", "I'm going to...", "I need to...", "I'll work on...", "My task is...", etc.
6. Do NOT create fake or example tasks
7. Do NOT include general discussion topics as tasks
8. If NO actual tasks are mentioned in the transcript, respond with: "NO TASKS IDENTIFIED"
9. Categorize actual tasks as "Coding" (development/technical work) or "Non-Coding" (documentation/research/meetings)

**Time and Progress Extraction (CRITICAL - PAY CLOSE ATTENTION):**
10. **Time Estimates**: Look for ANY mention of future time commitment:
    - Numbers: "3 hours", "5 hours", "2 days", "half day", "8 hours" 
    - Words: "three hours", "five hours", "two days", "a day", "couple hours"
    - Phrases: "will take", "should take", "estimated", "probably", "might need", "around", "about"
    - Examples: "this will take 3 hours", "estimated five hours", "probably around 2 days", "should take about 4 hours"

11. **Time Spent**: Look for ANY mention of time already worked:
    - Phrases: "spent", "took me", "worked", "did", "completed in", "finished in"
    - Numbers: Convert words to numbers ("three" = 3, "five" = 5, "two" = 2)
    - Examples: "spent 4 hours", "took me two hours", "worked three hours on it", "did about 5 hours"

12. **Time Units**: Convert everything to hours:
    - "1 day" = 8 hours, "2 days" = 16 hours, "half day" = 4 hours
    - "morning" = 4 hours, "afternoon" = 4 hours

13. Extract status updates (e.g., "completed the login feature", "started working on", "finished the database")
14. Extract task updates (e.g., "need to add validation to the form", "found an issue with...")

**Task Types:**
- NEW TASK: A completely new task being assigned or mentioned (NO task ID mentioned)
- EXISTING TASK UPDATE: Updates or progress on a previously mentioned task (task ID like SP-XX mentioned)
- STATUS CHANGE: Changes in task status (started, completed, etc.) for existing tasks (task ID mentioned)

**Required Output Format (ONLY if tasks are found):**
[Actual Participant Name]'s Tasks:
1. [Task description] (Coding/Non-Coding) [TYPE: NEW TASK/EXISTING TASK UPDATE/STATUS CHANGE] [TASK_ID: SP-XX or NONE] [ESTIMATED: X hours] [TIME SPENT: X hours] [STATUS: To-do/In-progress/Completed]

**Examples:**
- "Implement user authentication (Coding) [TYPE: NEW TASK] [TASK_ID: NONE] [ESTIMATED: 5 hours]"
- "Login feature - added validation (Coding) [TYPE: EXISTING TASK UPDATE] [TASK_ID: SP-25] [TIME SPENT: 2 hours]"
- "Database setup task (Coding) [TYPE: STATUS CHANGE] [TASK_ID: SP-30] [STATUS: Completed]"

**Important**: 
- If participant says "SP-25 - I made progress on authentication", extract task ID as SP-25 and mark as EXISTING TASK UPDATE
- If participant says "I need to implement authentication" (no SP-XX mentioned), mark as NEW TASK with TASK_ID: NONE
- Pay close attention to any SP-XX patterns in participant speech
- When SP-XX is mentioned with status words like "completed", "done", "finished", mark STATUS as "Completed"
- When SP-XX is mentioned with "started", "working on", "in progress", mark STATUS as "In-progress"
- CRITICAL: If someone says "SP-25 is complete" or "I completed SP-30", this is a STATUS CHANGE, not a new task

**Meeting Transcript:**
${transcriptText}

**Response:**`;
}

/**
 * Parse time strings to hours with support for various formats
 * @param {string} timeStr - Time string to parse (e.g., "3 hours", "2 days", "half day")
 * @returns {number} Time in hours
 */
function parseTimeToHours(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  
  const str = timeStr.toLowerCase().trim();
  
  // Direct hour matches
  let hourMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:hour|hr)s?/);
  if (hourMatch) {
    return parseFloat(hourMatch[1]);
  }
  
  // Day matches (assuming 8 hours per day)
  let dayMatch = str.match(/(\d+(?:\.\d+)?)\s*days?/);
  if (dayMatch) {
    return parseFloat(dayMatch[1]) * 8;
  }
  
  // Word number conversions
  const wordNumbers = {
    'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
    'a': 1, 'an': 1, 'couple': 2, 'few': 3, 'several': 4
  };
  
  // Check for word numbers with time units
  for (const [word, num] of Object.entries(wordNumbers)) {
    if (str.includes(word)) {
      if (str.includes('hour') || str.includes('hr')) {
        return num;
      }
      if (str.includes('day')) {
        return num * 8;
      }
    }
  }
  
  // Special cases
  if (str.includes('half day') || str.includes('half-day')) {
    return 4;
  }
  if (str.includes('morning') || str.includes('afternoon')) {
    return 4;
  }
  if (str.includes('full day') || str.includes('whole day')) {
    return 8;
  }
  
  // Try to extract any number as fallback
  const numberMatch = str.match(/(\d+(?:\.\d+)?)/);
  if (numberMatch) {
    const num = parseFloat(numberMatch[1]);
    // If the string contains 'day' assume it's days, otherwise assume hours
    if (str.includes('day')) {
      return num * 8;
    }
    return num;
  }
  
  return 0;
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
    
    // Enhanced task parsing to handle the new format with task IDs
    // Format: 1. [Task description] (Coding/Non-Coding) [TYPE: ...] [TASK_ID: SP-XX or NONE] [ESTIMATED: X hours] [TIME SPENT: X hours] [STATUS: ...]
    const taskMatch = trimmedLine.match(/^\d+\.\s*(.+?)\s*\((Coding|Non-Coding)\)(.*)$/i);
    if (taskMatch && currentParticipant) {
      const taskDescription = taskMatch[1].trim();
      const taskType = taskMatch[2]; // 'Coding' or 'Non-Coding'
      const additionalInfo = taskMatch[3] || '';
      
      // Skip if this looks like a placeholder task (only obvious placeholders)
      if (taskDescription.includes('[') || 
          taskDescription.includes('Task description') ||
          taskDescription.includes('Actual task mentioned')) {
        continue;
      }
      
      if (structuredTasks[currentParticipant]) {
        // Parse additional information from the enhanced format
        let taskType_extracted = 'NEW TASK';
        let estimatedTime = 0;
        let timeSpent = 0;
        let status = 'To-do';
        let existingTaskId = null;
        
        // Extract TYPE
        const typeMatch = additionalInfo.match(/\[TYPE:\s*([^\]]+)\]/i);
        if (typeMatch) {
          taskType_extracted = typeMatch[1].trim();
        }
        
        // Extract TASK_ID
        const taskIdMatch = additionalInfo.match(/\[TASK_ID:\s*([^\]]+)\]/i);
        if (taskIdMatch) {
          const taskIdValue = taskIdMatch[1].trim();
          if (taskIdValue !== 'NONE' && taskIdValue.match(/^SP-\d+$/i)) {
            existingTaskId = taskIdValue.toUpperCase();
          }
        }
        
        // Extract ESTIMATED time with enhanced parsing
        const estimatedMatch = additionalInfo.match(/\[ESTIMATED:\s*([^\]]+)\]/i);
        if (estimatedMatch) {
          estimatedTime = parseTimeToHours(estimatedMatch[1].trim());
        }
        
        // Extract TIME SPENT with enhanced parsing
        const timeSpentMatch = additionalInfo.match(/\[TIME SPENT:\s*([^\]]+)\]/i);
        if (timeSpentMatch) {
          timeSpent = parseTimeToHours(timeSpentMatch[1].trim());
        }
        
        // Extract STATUS
        const statusMatch = additionalInfo.match(/\[STATUS:\s*([^\]]+)\]/i);
        if (statusMatch) {
          status = statusMatch[1].trim();
        }
        
        // Create task object with enhanced data
        const taskObject = {
          description: taskDescription,
          status: status,
          estimatedTime: estimatedTime,
          timeTaken: timeSpent,
          taskType: taskType_extracted, // NEW TASK, EXISTING TASK UPDATE, STATUS CHANGE
          existingTaskId: existingTaskId // SP-XX if this is an update to existing task, null if new
        };
        
        structuredTasks[currentParticipant][taskType].push(taskObject);
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
 * Generate a concise title from a task description
 * @param {string} description - Full task description
 * @returns {Promise<string>} Concise title (2-5 words)
 */
async function generateTaskTitle(description) {
  try {
    if (!description || description.trim().length === 0) {
      return 'Untitled Task';
    }

    // If description is already short, use it as title
    if (description.length <= 50) {
      return description.trim();
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at creating concise, descriptive titles from task descriptions. Create titles that are 2-5 words and capture the main action and subject.'
        },
        {
          role: 'user',
          content: `Create a concise title (2-5 words) for this task description: "${description}"`
        }
      ],
      temperature: 0.3,
      max_tokens: 20,
    });

    let title = response.choices[0].message.content.trim();
    
    // Clean up the title
    title = title.replace(/['"]/g, ''); // Remove quotes
    title = title.replace(/^Title:\s*/i, ''); // Remove "Title:" prefix if present
    title = title.replace(/\.$/, ''); // Remove trailing period
    
    // Ensure title is reasonable length
    if (title.length > 60) {
      title = title.substring(0, 57) + '...';
    }
    
    // Fallback if title is empty or too short
    if (title.length < 3) {
      // Extract first few meaningful words from description
      const words = description.split(/\s+/).filter(word => word.length > 2);
      title = words.slice(0, 3).join(' ');
    }
    
    return title || 'Untitled Task';
    
  } catch (error) {
    logger.error('Error generating task title', {
      error: error.message,
      description: description.substring(0, 100),
    });
    
    // Fallback: use first few words of description
    const words = description.split(/\s+/).filter(word => word.length > 2);
    return words.slice(0, 3).join(' ') || 'Untitled Task';
  }
}

/**
 * Generate titles for multiple tasks in batch
 * @param {Array} tasks - Array of tasks with descriptions
 * @returns {Promise<Array>} Array of tasks with titles added
 */
async function generateTaskTitlesInBatch(tasks) {
  try {
    const titlesPromises = tasks.map(task => {
      if (typeof task === 'string') {
        return generateTaskTitle(task);
      } else if (task.description) {
        return generateTaskTitle(task.description);
      } else {
        return Promise.resolve('Untitled Task');
      }
    });
    
    const titles = await Promise.all(titlesPromises);
    
    return tasks.map((task, index) => {
      if (typeof task === 'string') {
        return {
          description: task,
          title: titles[index],
          status: 'To-do',
          estimatedTime: 0,
          timeTaken: 0
        };
      } else {
        return {
          ...task,
          title: titles[index]
        };
      }
    });
    
  } catch (error) {
    logger.error('Error generating task titles in batch', {
      error: error.message,
      taskCount: tasks.length,
    });
    
    // Fallback: add simple titles
    return tasks.map(task => {
      const description = typeof task === 'string' ? task : task.description || '';
      const words = description.split(/\s+/).filter(word => word.length > 2);
      const fallbackTitle = words.slice(0, 3).join(' ') || 'Untitled Task';
      
      if (typeof task === 'string') {
        return {
          description: task,
          title: fallbackTitle,
          status: 'To-do',
          estimatedTime: 0,
          timeTaken: 0
        };
      } else {
        return {
          ...task,
          title: fallbackTitle
        };
      }
    });
  }
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
  parseTimeToHours,
  generateTaskTitle,
  generateTaskTitlesInBatch,
};
