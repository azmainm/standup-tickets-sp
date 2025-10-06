/**
 * Assignee Detection Service
 * 
 * This service handles intelligent assignee detection including:
 * 1. "For me" assignments (speaker inference)
 * 2. Explicit participant name mentions
 * 3. Database participant matching with fuzzy search
 * 4. Fallback assignment logic
 */

const { logger } = require("firebase-functions");
const { AssigneeDetectionSchema } = require("../../schemas/taskSchemas");

// Load participant mapping
const { PARTICIPANT_TO_JIRA_MAPPING } = require("../../config/participantMapping");

/**
 * Detect assignee from task description and context
 * @param {string} taskDescription - The task description text
 * @param {string} speaker - The person who mentioned the task
 * @param {Array} availableParticipants - List of known participants from database
 * @returns {Promise<Object>} Assignee detection result
 */
async function detectAssignee(taskDescription, speaker, availableParticipants = []) {
  try {
    logger.info("Detecting assignee", {
      taskDescription: taskDescription.substring(0, 100),
      speaker,
      availableParticipantsCount: availableParticipants.length
    });

    // Method 1: Check for explicit "for me" or "my task" patterns
    const selfAssignmentResult = detectSelfAssignment(taskDescription, speaker);
    if (selfAssignmentResult.confidence > 0.8) {
      return selfAssignmentResult;
    }

    // Method 2: Check for explicit participant mentions
    const explicitMentionResult = detectExplicitMention(taskDescription, availableParticipants);
    if (explicitMentionResult.confidence > 0.7) {
      return explicitMentionResult;
    }

    // Method 3: Check against known participant database
    const databaseMatchResult = await detectDatabaseParticipant(taskDescription, availableParticipants);
    if (databaseMatchResult.confidence > 0.6) {
      return databaseMatchResult;
    }

    // Method 4: Check against participant mapping
    const mappingMatchResult = detectParticipantFromMapping(taskDescription);
    if (mappingMatchResult.confidence > 0.5) {
      return mappingMatchResult;
    }

    // Fallback: Default assignment based on context
    return getDefaultAssignment(speaker);

  } catch (error) {
    logger.error("Error in assignee detection", {
      error: error.message,
      taskDescription: taskDescription.substring(0, 100),
      speaker
    });

    // Return fallback assignment
    return {
      assignee: speaker || "TBD",
      confidence: 0.1,
      method: "DEFAULT_ASSIGNMENT",
      originalMention: null,
      alternativeCandidates: []
    };
  }
}

/**
 * Detect self-assignment patterns like "for me", "my task", "I will"
 * @param {string} taskDescription - Task description text
 * @param {string} speaker - Speaker name
 * @returns {Object} Detection result
 */
function detectSelfAssignment(taskDescription, speaker) {
  const lowerDescription = taskDescription.toLowerCase();
  
  // Self-assignment patterns
  const selfPatterns = [
    /\b(?:for me|my task|i will|i'll|i need to|i have to|i should)\b/i,
    /\b(?:i'm going to|i am going to|i plan to|i'm planning to)\b/i,
    /\b(?:assigned to me|my responsibility|my job)\b/i,
    /\b(?:new task for me|task for me)\b/i
  ];

  let confidence = 0;
  let matchedPattern = null;

  for (const pattern of selfPatterns) {
    if (pattern.test(lowerDescription)) {
      confidence = 0.9; // High confidence for self-assignment
      matchedPattern = pattern.source;
      break;
    }
  }

  if (confidence > 0) {
    return {
      assignee: normalizeAssigneeName(speaker) || "TBD",
      confidence,
      method: "SPEAKER_INFERENCE",
      originalMention: matchedPattern,
      alternativeCandidates: []
    };
  }

  return { assignee: null, confidence: 0, method: "SPEAKER_INFERENCE" };
}

/**
 * Detect explicit participant mentions in task description
 * @param {string} taskDescription - Task description text
 * @param {Array} availableParticipants - List of known participants
 * @returns {Object} Detection result
 */
function detectExplicitMention(taskDescription, availableParticipants) {
  
  // Patterns for explicit assignment
  const assignmentPatterns = [
    /(?:for|assign(?:ed)?\s+to|task\s+for)\s+([A-Za-z\s]+?)(?:\s|$|,|\.)/i,
    /([A-Za-z\s]+?)\s+(?:will|should|needs?\s+to|has\s+to)\s+/i,
    /(?:new\s+task\s+for|assign\s+to)\s+([A-Za-z\s]+?)(?:\s|$|,|\.)/i
  ];

  for (const pattern of assignmentPatterns) {
    const match = taskDescription.match(pattern);
    if (match && match[1]) {
      const mentionedName = match[1].trim();
      
      // Try to match against available participants
      const matchedParticipant = findBestParticipantMatch(mentionedName, availableParticipants);
      
      if (matchedParticipant.confidence > 0.7) {
        return {
          assignee: normalizeAssigneeName(matchedParticipant.participant),
          confidence: 0.8,
          method: "EXPLICIT_MENTION", 
          originalMention: mentionedName,
          alternativeCandidates: matchedParticipant.alternatives
        };
      }
    }
  }

  return { assignee: null, confidence: 0, method: "EXPLICIT_MENTION" };
}

/**
 * Detect participant from database of existing tasks
 * @param {string} taskDescription - Task description text
 * @param {Array} availableParticipants - List of participants from database
 * @returns {Promise<Object>} Detection result
 */
async function detectDatabaseParticipant(taskDescription, availableParticipants) {
  if (!availableParticipants || availableParticipants.length === 0) {
    return { assignee: null, confidence: 0, method: "DATABASE_MATCH" };
  }

  // Extract potential names from description
  const namePatterns = [
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g, // Capitalized names
    /\b([A-Za-z]+)\s+(?:will|should|needs|has\s+to)/i // Name before action verbs
  ];

  const potentialNames = [];
  for (const pattern of namePatterns) {
    let match;
    while ((match = pattern.exec(taskDescription)) !== null) {
      potentialNames.push(match[1]);
    }
  }

  // Find best match from available participants
  let bestMatch = { participant: null, confidence: 0, alternatives: [] };
  
  for (const name of potentialNames) {
    const matchResult = findBestParticipantMatch(name, availableParticipants);
    if (matchResult.confidence > bestMatch.confidence) {
      bestMatch = matchResult;
    }
  }

  if (bestMatch.confidence > 0.6) {
    return {
      assignee: normalizeAssigneeName(bestMatch.participant),
      confidence: bestMatch.confidence,
      method: "DATABASE_MATCH",
      originalMention: potentialNames.join(", "),
      alternativeCandidates: bestMatch.alternatives
    };
  }

  return { assignee: null, confidence: 0, method: "DATABASE_MATCH" };
}

/**
 * Detect participant from mapping configuration
 * @param {string} taskDescription - Task description text
 * @returns {Object} Detection result
 */
function detectParticipantFromMapping(taskDescription) {
  const participants = Object.keys(PARTICIPANT_TO_JIRA_MAPPING);
  
  // Check for exact name matches in description
  for (const participant of participants) {
    const nameParts = participant.toLowerCase().split(' ');
    const fullName = participant.toLowerCase();
    const firstName = nameParts[0];
    
    const lowerDescription = taskDescription.toLowerCase();
    
    // Check for full name match
    if (lowerDescription.includes(fullName)) {
      return {
        assignee: normalizeAssigneeName(participant),
        confidence: 0.8,
        method: "EXPLICIT_MENTION",
        originalMention: participant,
        alternativeCandidates: []
      };
    }
    
    // Check for first name match (lower confidence)
    if (lowerDescription.includes(firstName) && firstName.length > 2) {
      return {
        assignee: normalizeAssigneeName(participant),
        confidence: 0.6,
        method: "EXPLICIT_MENTION", 
        originalMention: firstName,
        alternativeCandidates: participants.filter(p => p !== participant)
      };
    }
  }

  return { assignee: null, confidence: 0, method: "EXPLICIT_MENTION" };
}

/**
 * Normalize assignee name to handle common variations
 * @param {string} name - Name to normalize
 * @returns {string} Normalized name
 */
function normalizeAssigneeName(name) {
  if (!name || typeof name !== 'string') {
    return name;
  }

  const lowerName = name.toLowerCase().trim();
  
  // Handle Fayaz/Faiyaz variations - normalize to "Faiyaz Rahman"
  const fayazVariations = [
    "fayaz",
    "faiyaz", 
    "fayaz rahman",
    "faiyaz rahman",
    "faiyazrahman1685"
  ];
  
  if (fayazVariations.includes(lowerName)) {
    return "Faiyaz Rahman";
  }
  
  // Return original name if no normalization needed
  return name;
}

/**
 * Find best matching participant from a list with enhanced fuzzy matching
 * @param {string} mentionedName - Name mentioned in text
 * @param {Array} availableParticipants - List of participant names
 * @returns {Object} Match result with confidence
 */
function findBestParticipantMatch(mentionedName, availableParticipants) {
  if (!mentionedName || !availableParticipants || availableParticipants.length === 0) {
    return { participant: null, confidence: 0, alternatives: [] };
  }

  // First normalize the mentioned name
  const normalizedMentioned = normalizeAssigneeName(mentionedName);
  const lowerMentioned = normalizedMentioned.toLowerCase().trim();
  let bestMatch = { participant: null, confidence: 0, alternatives: [] };

  for (const participant of availableParticipants) {
    if (!participant) continue;
    
    // Also normalize the participant name for comparison
    const normalizedParticipant = normalizeAssigneeName(participant);
    const lowerParticipant = normalizedParticipant.toLowerCase();
    const nameParts = lowerParticipant.split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];

    let confidence = 0;

    // Exact match
    if (lowerMentioned === lowerParticipant) {
      confidence = 1.0;
    }
    // First name + last name match
    else if (lowerMentioned.includes(firstName) && lowerMentioned.includes(lastName)) {
      confidence = 0.9;
    }
    // Full name contained in mention or vice versa
    else if (lowerMentioned.includes(lowerParticipant) || lowerParticipant.includes(lowerMentioned)) {
      confidence = 0.8;
    }
    // First name exact match (handle cases like "faiyaz" -> "Faiyaz Rahman")
    else if (lowerMentioned === firstName) {
      confidence = 0.85; // High confidence for exact first name match
    }
    // First name fuzzy match (handle spelling variations)
    else if (calculateStringSimilarity(lowerMentioned, firstName) > 0.8) {
      confidence = 0.75;
    }
    // Last name match
    else if (lowerMentioned === lastName || lowerMentioned.includes(lastName)) {
      confidence = 0.6;
    }
    // Partial match (at least 3 characters)
    else if (lowerMentioned.length >= 3 && (lowerParticipant.includes(lowerMentioned) || lowerMentioned.includes(lowerParticipant))) {
      confidence = 0.5;
    }
    // Fuzzy match for common misspellings (only if no higher confidence match found)
    else if (confidence === 0 && calculateStringSimilarity(lowerMentioned, lowerParticipant) > 0.7) {
      confidence = 0.4;
    }

    if (confidence > bestMatch.confidence) {
      bestMatch = {
        participant: normalizedParticipant, // Use normalized name
        confidence,
        alternatives: availableParticipants.filter(p => p !== participant).slice(0, 3)
      };
    }
  }

  return bestMatch;
}

/**
 * Get default assignment when no specific assignee is detected
 * @param {string} speaker - The person who mentioned the task
 * @returns {Object} Default assignment
 */
function getDefaultAssignment(speaker) {
  // If speaker is known, assign to them
  if (speaker && speaker !== "Unknown" && speaker.trim().length > 0) {
    return {
      assignee: normalizeAssigneeName(speaker),
      confidence: 0.3,
      method: "DEFAULT_ASSIGNMENT",
      originalMention: null,
      alternativeCandidates: []
    };
  }

  // Otherwise assign to TBD
  return {
    assignee: "TBD",
    confidence: 0.1,
    method: "DEFAULT_ASSIGNMENT",
    originalMention: null,
    alternativeCandidates: []
  };
}

/**
 * Get all unique participants from database tasks
 * @param {Array} databaseTasks - Tasks from database
 * @returns {Array} Unique participant names
 */
function extractParticipantsFromDatabase(databaseTasks) {
  if (!databaseTasks || !Array.isArray(databaseTasks)) {
    return [];
  }

  const participants = new Set();
  
  for (const task of databaseTasks) {
    if (task.participantName && typeof task.participantName === 'string') {
      participants.add(task.participantName.trim());
    }
  }

  return Array.from(participants).filter(name => name.length > 0 && name !== "TBD");
}

/**
 * Validate assignee detection result
 * @param {Object} result - Detection result
 * @returns {Object} Validated result
 */
function validateAssigneeDetection(result) {
  try {
    return AssigneeDetectionSchema.parse(result);
  } catch (error) {
    logger.error("Invalid assignee detection result", {
      error: error.message,
      result
    });
    
    // Return safe fallback
    return {
      assignee: "TBD",
      confidence: 0.0,
      method: "DEFAULT_ASSIGNMENT",
      originalMention: null,
      alternativeCandidates: []
    };
  }
}

/**
 * Calculate string similarity using Levenshtein distance
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score between 0 and 1
 */
function calculateStringSimilarity(str1, str2) {
  if (str1 === str2) return 1;
  if (str1.length === 0 || str2.length === 0) return 0;
  
  const matrix = [];
  
  // Initialize matrix
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  // Fill matrix
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  const maxLength = Math.max(str1.length, str2.length);
  const distance = matrix[str2.length][str1.length];
  return 1 - (distance / maxLength);
}

/**
 * Extract participant names from transcript entries
 * @param {Array} transcript - Transcript entries with speaker information
 * @returns {Array} Unique participant names found in transcript
 */
function extractParticipantsFromTranscript(transcript) {
  if (!transcript || !Array.isArray(transcript)) {
    return [];
  }

  const participants = new Set();
  
  for (const entry of transcript) {
    if (entry.text) {
      // Extract participant name from <v ParticipantName> format
      const speakerMatch = entry.text.match(/<v\s*([^>]+)>/);
      if (speakerMatch && speakerMatch[1]) {
        const participantName = speakerMatch[1].trim();
        if (participantName.length > 0) {
          participants.add(participantName);
        }
      }
    }
  }

  return Array.from(participants);
}

module.exports = {
  detectAssignee,
  detectSelfAssignment,
  detectExplicitMention,
  detectDatabaseParticipant,
  detectParticipantFromMapping,
  findBestParticipantMatch,
  getDefaultAssignment,
  extractParticipantsFromDatabase,
  validateAssigneeDetection,
  calculateStringSimilarity,
  extractParticipantsFromTranscript,
  normalizeAssigneeName
};
