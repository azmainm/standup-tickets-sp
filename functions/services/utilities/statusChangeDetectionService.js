/**
 * Status Change Detection Service
 * 
 * This service handles detection of task status changes from transcript text,
 * specifically looking for patterns like "SP-XX is complete", "finished SP-25", etc.
 */

const { logger } = require("firebase-functions");
const { StatusChangeSchema } = require("../../schemas/taskSchemas");

/**
 * Detect status changes from transcript text
 * @param {string} transcriptText - The transcript text to analyze
 * @param {string} speaker - Who said this text
 * @returns {Array} Array of detected status changes
 */
function detectStatusChanges(transcriptText, speaker) {
  try {
    const statusChanges = [];
    const lowerText = transcriptText.toLowerCase();
    
    // DEBUG: Log the text being analyzed
    console.log("[DEBUG] Status detection analyzing:", {
      speaker,
      text: transcriptText.substring(0, 200),
      containsSP99: transcriptText.includes('SP-99'),
      containsCompleted: transcriptText.toLowerCase().includes('completed')
    });
    
    // Patterns for completion (supports both SP-XXX and Jira ticket formats like TDS-XXX)
    const completionPatterns = [
      // "SP-XX is completed/done/finished" or "TDS-204 is completed"
      {
        pattern: /\b((?:sp|[A-Z]{2,})[-\s]?\d+)\s+(?:is|was|has\s+been)\s+(?:now\s+|definitely\s+)?(?:completed?|done|finished|resolved)\b/gi,
        status: "Completed",
        confidence: 0.9
      },
      // "completed SP-XX" or "completed TDS-204"
      {
        pattern: /\b(?:completed?|finished|done\s+with)\s+((?:sp|[A-Z]{2,})[-\s]?\d+)\b/gi,
        status: "Completed", 
        confidence: 0.9
      },
      // "SP-XX - completed" or "TDS-204 completed"
      {
        pattern: /\b((?:sp|[A-Z]{2,})[-\s]?\d+)(?:\s*[-:]\s*|\s+)(?:completed?|finished|done)\b(?!\s+(?:by|in|within|about))/gi,
        status: "Completed",
        confidence: 0.8
      },
      // "I completed SP-XX" or "I've completed TDS-204"
      {
        pattern: /\b(?:i\s+)?(?:have\s+)?(?:completed?|finished|done)\s+(?:working\s+on\s+)?((?:sp|[A-Z]{2,})[-\s]?\d+)\b/gi,
        status: "Completed",
        confidence: 0.9
      }
    ];

    // Patterns for in-progress (supports both SP-XXX and Jira ticket formats)
    const inProgressPatterns = [
      // "SP-XX is in progress/started" or "TDS-204 is in progress"
      {
        pattern: /\b((?:sp|[A-Z]{2,})[-\s]?\d+)\s+(?:is|was)?\s*(?:in\s+progress|started|begun|underway|ongoing)\b/gi,
        status: "In-progress",
        confidence: 0.9
      },
      // "started SP-XX" or "started TDS-204"
      {
        pattern: /\b(?:started|began|begun)\s+(?:working\s+on\s+)?((?:sp|[A-Z]{2,})[-\s]?\d+)\b/gi,
        status: "In-progress",
        confidence: 0.9
      },
      // "working on SP-XX" or "working on TDS-204"
      {
        pattern: /\b(?:working\s+on|currently\s+on)\s+((?:sp|[A-Z]{2,})[-\s]?\d+)\b/gi,
        status: "In-progress",
        confidence: 0.8
      },
      // "SP-XX - started" or "TDS-204 started"
      {
        pattern: /\b((?:sp|[A-Z]{2,})[-\s]?\d+)(?:\s*[-:]\s*|\s+)(?:started|begun|in\s+progress)\b/gi,
        status: "In-progress",
        confidence: 0.8
      }
    ];

    // Process completion patterns
    for (const patternInfo of completionPatterns) {
      let match;
      patternInfo.pattern.lastIndex = 0; // Reset regex
      
      // DEBUG: Log pattern testing for SP-99
      if (transcriptText.includes('SP-99') && transcriptText.toLowerCase().includes('completed')) {
        console.log("[DEBUG] Testing completion pattern:", {
          pattern: patternInfo.pattern.toString(),
          speaker,
          text: transcriptText.substring(0, 200)
        });
      }
      
      while ((match = patternInfo.pattern.exec(transcriptText)) !== null) {
        const taskId = normalizeTaskId(match[1]);
        if (taskId) {
          console.log("[DEBUG] Status change detected:", {
            taskId,
            status: patternInfo.status,
            speaker,
            evidence: match[0],
            patternUsed: patternInfo.pattern.toString()
          });
          
          statusChanges.push({
            taskId,
            newStatus: patternInfo.status,
            confidence: patternInfo.confidence,
            evidence: match[0],
            speaker: speaker || "Unknown",
            patternType: "completion"
          });
        }
      }
    }

    // Process in-progress patterns  
    for (const patternInfo of inProgressPatterns) {
      let match;
      patternInfo.pattern.lastIndex = 0; // Reset regex
      
      while ((match = patternInfo.pattern.exec(transcriptText)) !== null) {
        const taskId = normalizeTaskId(match[1]);
        if (taskId) {
          // Check if we already detected completion for this task (completion takes precedence)
          const hasCompletion = statusChanges.some(sc => sc.taskId === taskId && sc.newStatus === "Completed");
          
          if (!hasCompletion) {
            statusChanges.push({
              taskId,
              newStatus: patternInfo.status,
              confidence: patternInfo.confidence,
              evidence: match[0],
              speaker: speaker || "Unknown",
              patternType: "in-progress"
            });
          }
        }
      }
    }

    // Remove duplicates, keeping highest confidence for each task
    const uniqueStatusChanges = [];
    const seenTasks = new Map();

    for (const change of statusChanges) {
      const existing = seenTasks.get(change.taskId);
      if (!existing || change.confidence > existing.confidence) {
        seenTasks.set(change.taskId, change);
      }
    }

    uniqueStatusChanges.push(...seenTasks.values());

    if (uniqueStatusChanges.length > 0) {
      logger.info("Detected status changes", {
        count: uniqueStatusChanges.length,
        changes: uniqueStatusChanges.map(c => `${c.taskId}: ${c.newStatus}`),
        speaker
      });
    }

    return uniqueStatusChanges.map(change => validateStatusChange(change));

  } catch (error) {
    logger.error("Error detecting status changes", {
      error: error.message,
      speaker,
      textLength: transcriptText.length
    });
    return [];
  }
}

/**
 * Detect status changes from complete transcript entries
 * @param {Array} transcriptEntries - Array of transcript entries
 * @returns {Array} Array of detected status changes
 */
function detectStatusChangesFromTranscript(transcriptEntries) {
  const allStatusChanges = [];

  for (const entry of transcriptEntries) {
    if (!entry.text) continue;

    // Extract speaker name
    let speaker = "Unknown";
    const speakerMatch = entry.text.match(/<v\s*([^>]+)>/);
    if (speakerMatch) {
      speaker = speakerMatch[1].trim();
    }

    // Clean text (remove speaker tags)
    const cleanText = entry.text.replace(/<[^>]*>/g, "").trim();
    
    if (cleanText.length > 0) {
      const statusChanges = detectStatusChanges(cleanText, speaker);
      allStatusChanges.push(...statusChanges);
    }
  }

  // DEBUG: Log all detected status changes
  console.log("[DEBUG] Status Change Detection Results:", {
    totalChanges: allStatusChanges.length,
    changes: allStatusChanges.map(change => ({
      taskId: change.taskId,
      newStatus: change.newStatus,
      speaker: change.speaker,
      confidence: change.confidence,
      evidence: change.evidence?.substring(0, 100)
    }))
  });

  return allStatusChanges;
}

/**
 * Normalize task ID to standard format (SP-XX or Jira format like TDS-XX)
 * @param {string} rawTaskId - Raw task ID from text
 * @returns {string|null} Normalized task ID or null if invalid
 */
function normalizeTaskId(rawTaskId) {
  if (!rawTaskId) return null;
  
  // Remove spaces and convert to uppercase
  const cleaned = rawTaskId.replace(/\s+/g, "").toUpperCase();
  
  // Check if it matches SP followed by numbers (legacy format)
  const spMatch = cleaned.match(/^SP[-]?(\d+)$/);
  if (spMatch) {
    return `SP-${spMatch[1]}`;
  }
  
  // Check if it matches Jira ticket format (PROJECTKEY-NUMBER)
  // This matches formats like: TDS-204, PROJ-123, ABC-456
  // Must have at least 2 uppercase letters followed by dash and numbers
  const jiraMatch = cleaned.match(/^([A-Z]{2,})[-]?(\d+)$/);
  if (jiraMatch) {
    const projectKey = jiraMatch[1];
    const number = jiraMatch[2];
    
    // Verify it's likely a Jira ticket by checking against project key if available
    try {
      const { JIRA_PROJECT_KEY } = process.env;
      if (JIRA_PROJECT_KEY && projectKey === JIRA_PROJECT_KEY.toUpperCase()) {
        return `${projectKey}-${number}`;
      }
      // If no project key configured or doesn't match, still accept the format
      // This is lenient to handle multiple Jira projects or future projects
      return `${projectKey}-${number}`;
    } catch (error) {
      // If env check fails, still accept the format
      return `${projectKey}-${number}`;
    }
  }
  
  return null;
}

/**
 * Check if text contains explicit status keywords
 * @param {string} text - Text to check
 * @returns {Object} Status detection result
 */
function detectExplicitStatus(text) {
  const lowerText = text.toLowerCase();
  
  // Completion indicators
  const completionWords = [
    "completed", "complete", "finished", "done", "resolved", 
    "closed", "finalized", "delivered", "deployed"
  ];
  
  // In-progress indicators
  const inProgressWords = [
    "started", "begun", "beginning", "working", "in progress", 
    "ongoing", "underway", "currently", "developing"
  ];
  
  // To-do indicators (less common but possible)
  const todoWords = [
    "pending", "todo", "to-do", "planned", "scheduled", "will start"
  ];

  let status = null;
  let confidence = 0;
  let evidence = [];

  // Check for completion
  for (const word of completionWords) {
    if (lowerText.includes(word)) {
      status = "Completed";
      confidence = Math.max(confidence, 0.8);
      evidence.push(word);
    }
  }

  // Check for in-progress (if not completed)
  if (!status) {
    for (const word of inProgressWords) {
      if (lowerText.includes(word)) {
        status = "In-progress";
        confidence = Math.max(confidence, 0.7);
        evidence.push(word);
      }
    }
  }

  // Check for to-do (if nothing else found)
  if (!status) {
    for (const word of todoWords) {
      if (lowerText.includes(word)) {
        status = "To-do";
        confidence = Math.max(confidence, 0.6);
        evidence.push(word);
      }
    }
  }

  return {
    status,
    confidence,
    evidence: evidence.join(", ")
  };
}

/**
 * Validate status change result against schema
 * @param {Object} statusChange - Status change result
 * @returns {Object} Validated status change
 */
function validateStatusChange(statusChange) {
  try {
    return StatusChangeSchema.parse(statusChange);
  } catch (error) {
    logger.error("Invalid status change result", {
      error: error.message,
      statusChange
    });
    
    // Return safe fallback
    return {
      taskId: statusChange.taskId || "SP-0",
      newStatus: "To-do",
      confidence: 0.0,
      evidence: statusChange.evidence || "validation failed",
      speaker: statusChange.speaker || "Unknown"
    };
  }
}

/**
 * Filter status changes by confidence threshold
 * @param {Array} statusChanges - Array of status changes
 * @param {number} threshold - Minimum confidence threshold (default: 0.7)
 * @returns {Array} Filtered status changes
 */
function filterStatusChangesByConfidence(statusChanges, threshold = 0.7) {
  return statusChanges.filter(change => change.confidence >= threshold);
}

/**
 * Get status change summary for logging
 * @param {Array} statusChanges - Array of status changes
 * @returns {Object} Summary information
 */
function getStatusChangeSummary(statusChanges) {
  const summary = {
    total: statusChanges.length,
    byStatus: {
      "Completed": 0,
      "In-progress": 0,
      "To-do": 0
    },
    byConfidence: {
      high: 0, // >= 0.8
      medium: 0, // 0.6 - 0.79
      low: 0 // < 0.6
    },
    uniqueTasks: new Set()
  };

  for (const change of statusChanges) {
    summary.byStatus[change.newStatus]++;
    summary.uniqueTasks.add(change.taskId);
    
    if (change.confidence >= 0.8) {
      summary.byConfidence.high++;
    } else if (change.confidence >= 0.6) {
      summary.byConfidence.medium++;
    } else {
      summary.byConfidence.low++;
    }
  }

  summary.uniqueTaskCount = summary.uniqueTasks.size;
  delete summary.uniqueTasks; // Remove Set object for clean logging

  return summary;
}

module.exports = {
  detectStatusChanges,
  detectStatusChangesFromTranscript,
  normalizeTaskId,
  detectExplicitStatus,
  validateStatusChange,
  filterStatusChangesByConfidence,
  getStatusChangeSummary
};
