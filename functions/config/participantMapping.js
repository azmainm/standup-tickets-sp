/**
 * Participant Mapping Configuration
 * 
 * This file maps transcript participant names to their corresponding
 * Jira accountIds (no API lookup needed).
 */

/**
 * Map of participant names (as they appear in transcripts) to their Jira accountIds
 * 
 * Key: Participant name as it appears in Microsoft Teams transcripts
 * Value: Jira accountId (e.g., "557058:abc123def456")
 * 
 * Example:
 * "Azmain Morshed": "557058:abc123def456"
 * "Doug Whitewolff": "557058:xyz789ghi012"
 */
const PARTICIPANT_TO_JIRA_MAPPING = {
  // Add your team members here with their Jira accountIds
  "Azmain Morshed": "712020:07191a71-d22a-4918-a0a5-7fd37a3d989d",  // Jira account ID
  "Faiyaz Rahman": "712020:c78868d6-22f3-4057-af78-ee12cb842f1d",
  "Shafkat Kabir": "63b5ca05b790087ed712410a",
  "Doug Whitewolff": "712020:bd2ea925-798e-4c8f-8854-c0ddfc7c787f",
  
  // You can also use variations of names that might appear in transcripts
  "Azmain": "712020:07191a71-d22a-4918-a0a5-7fd37a3d989d",
  "Doug": "712020:bd2ea925-798e-4c8f-8854-c0ddfc7c787f",
  "Shafkat": "63b5ca05b790087ed712410a",
  "Faiyaz": "712020:c78868d6-22f3-4057-af78-ee12cb842f1d",
  "Fayaz": "712020:c78868d6-22f3-4057-af78-ee12cb842f1d", // Map Fayaz to Faiyaz's accountId
  
};

/**
 * Default assignee accountId when participant is not found in mapping
 * Set this to your accountId or leave null to create unassigned issues
 */
const DEFAULT_ASSIGNEE = "557058:abc123def456"; // or null

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
 * Get Jira assignee accountId for a participant
 * @param {string} participantName - Name as it appears in transcript
 * @returns {string|null} Jira accountId or null if not found
 */
function getJiraAssigneeForParticipant(participantName) {
  if (!participantName) {
    return DEFAULT_ASSIGNEE;
  }
  
  // First normalize the participant name
  const normalizedName = normalizeAssigneeName(participantName);
  
  // Direct lookup
  let assignee = PARTICIPANT_TO_JIRA_MAPPING[normalizedName];
  if (assignee) {
    return assignee;
  }
  
  // Try case-insensitive lookup
  const lowerName = normalizedName.toLowerCase();
  for (const [mappedName, accountId] of Object.entries(PARTICIPANT_TO_JIRA_MAPPING)) {
    if (mappedName.toLowerCase() === lowerName) {
      return accountId;
    }
  }
  
  // Try partial matching (first name)
  const firstName = normalizedName.split(" ")[0].toLowerCase();
  for (const [mappedName, accountId] of Object.entries(PARTICIPANT_TO_JIRA_MAPPING)) {
    if (mappedName.toLowerCase().includes(firstName)) {
      return accountId;
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
 * Validate that all participants have valid accountId formats
 * @returns {Object} Validation results
 */
function validateParticipantMapping() {
  // Jira accountIds typically follow format: "number:alphanumeric" (e.g., "557058:abc123def456")
  const accountIdRegex = /^\d+:[a-zA-Z0-9]+$/;
  const validEntries = [];
  const invalidEntries = [];
  
  for (const [participant, accountId] of Object.entries(PARTICIPANT_TO_JIRA_MAPPING)) {
    if (accountIdRegex.test(accountId)) {
      validEntries.push({ participant, accountId });
    } else {
      invalidEntries.push({ participant, accountId, reason: "Invalid accountId format (expected format: 'number:alphanumeric')" });
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
  normalizeAssigneeName,
};
