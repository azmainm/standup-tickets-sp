/**
 * Participant Mapping Configuration
 * 
 * This file maps transcript participant names to their corresponding
 * Jira user identifiers (emails or usernames).
 */

/**
 * Map of participant names (as they appear in transcripts) to their Jira identifiers
 * 
 * Key: Participant name as it appears in Microsoft Teams transcripts
 * Value: Email address or username used in Jira
 * 
 * Example:
 * "Azmain Morshed": "azmain.morshed@company.com"
 * "Doug Whitewolff": "doug.whitewolff@company.com"
 */
const PARTICIPANT_TO_JIRA_MAPPING = {
  // Add your team members here
  "Azmain Morshed": "azmainmorshed03@gmail.com",
  "Doug Whitewolff": "doug@transformationmath.com", // Replace with actual email
  "Shafkat Kabir": "kabir.shafkat@gmail.com", // Replace with actual email
  
  // You can also use variations of names that might appear in transcripts
  "Azmain": "azmainmorshed03@gmail.com",
  "Doug": "doug@transformationmath.com",
  "Shafkat": "kabir.shafkat@gmail.com",
  
};

/**
 * Default assignee email when participant is not found in mapping
 * Set this to your email or leave null to create unassigned issues
 */
const DEFAULT_ASSIGNEE = "azmainmorshed03@gmail.com"; // or null

/**
 * Get Jira assignee identifier for a participant
 * @param {string} participantName - Name as it appears in transcript
 * @returns {string|null} Jira email/username or null if not found
 */
function getJiraAssigneeForParticipant(participantName) {
  if (!participantName) {
    return DEFAULT_ASSIGNEE;
  }
  
  // Direct lookup
  let assignee = PARTICIPANT_TO_JIRA_MAPPING[participantName];
  if (assignee) {
    return assignee;
  }
  
  // Try case-insensitive lookup
  const lowerName = participantName.toLowerCase();
  for (const [mappedName, email] of Object.entries(PARTICIPANT_TO_JIRA_MAPPING)) {
    if (mappedName.toLowerCase() === lowerName) {
      return email;
    }
  }
  
  // Try partial matching (first name)
  const firstName = participantName.split(' ')[0].toLowerCase();
  for (const [mappedName, email] of Object.entries(PARTICIPANT_TO_JIRA_MAPPING)) {
    if (mappedName.toLowerCase().includes(firstName)) {
      return email;
    }
  }
  
  // Return default assignee if no mapping found
  return DEFAULT_ASSIGNEE;
}

/**
 * Get all configured participants
 * @returns {Array<string>} List of participant names
 */
function getAllParticipants() {
  return Object.keys(PARTICIPANT_TO_JIRA_MAPPING);
}

/**
 * Validate that all participants have valid email formats
 * @returns {Object} Validation results
 */
function validateParticipantMapping() {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const validEntries = [];
  const invalidEntries = [];
  
  for (const [participant, email] of Object.entries(PARTICIPANT_TO_JIRA_MAPPING)) {
    if (emailRegex.test(email)) {
      validEntries.push({ participant, email });
    } else {
      invalidEntries.push({ participant, email, reason: 'Invalid email format' });
    }
  }
  
  return {
    valid: invalidEntries.length === 0,
    validCount: validEntries.length,
    invalidCount: invalidEntries.length,
    validEntries,
    invalidEntries,
  };
}

module.exports = {
  PARTICIPANT_TO_JIRA_MAPPING,
  DEFAULT_ASSIGNEE,
  getJiraAssigneeForParticipant,
  getAllParticipants,
  validateParticipantMapping,
};
