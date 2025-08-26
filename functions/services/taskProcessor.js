/**
 * Task Processing Service - Orchestrates the complete task processing flow
 * 
 * This service coordinates:
 * 1. Processing transcripts with OpenAI to extract tasks
 * 2. Storing the processed tasks in MongoDB
 * 3. Handling the complete end-to-end flow
 */

const { processTranscriptForTasks } = require('./openaiService');
const { storeTasks, storeTranscript } = require('./mongoService');
const { createJiraIssuesForCodingTasks } = require('./jiraService');
const { logger } = require("firebase-functions");

/**
 * Process a transcript end-to-end: OpenAI extraction + MongoDB storage
 * @param {Array} transcript - Array of transcript entries
 * @param {Object} transcriptMetadata - Metadata from transcript fetch (optional)
 * @returns {Promise<Object>} Complete processing result with task data and storage info
 */
async function processTranscriptToTasks(transcript, transcriptMetadata = {}) {
  const startTime = Date.now();
  
  try {
    logger.info('Starting complete task processing flow', {
      transcriptEntries: transcript.length,
      timestamp: new Date().toISOString(),
    });

    // Step 1: Store the raw transcript in MongoDB
    logger.info('Step 1: Storing transcript in MongoDB');
    const transcriptStorageResult = await storeTranscript(transcript, transcriptMetadata);

    // Step 2: Process transcript with OpenAI to extract tasks
    logger.info('Step 2: Processing transcript with OpenAI');
    const openaiResult = await processTranscriptForTasks(transcript);
    
    if (!openaiResult.success) {
      throw new Error('OpenAI processing failed');
    }

    // Step 3: Store the processed tasks in MongoDB
    logger.info('Step 3: Storing tasks in MongoDB', {
      participantCount: Object.keys(openaiResult.tasks).length,
    });
    
    const mongoResult = await storeTasks(openaiResult.tasks, {
      ...openaiResult.metadata,
      transcriptMetadata,
      transcriptDocumentId: transcriptStorageResult.documentId,
      processingDuration: (Date.now() - startTime) / 1000,
    });

    // Step 4: Create Jira issues for coding tasks
    logger.info('Step 4: Creating Jira issues for coding tasks');
    let jiraResult = null;
    
    try {
      jiraResult = await createJiraIssuesForCodingTasks(openaiResult.tasks);
      
      if (jiraResult.success) {
        logger.info('Jira issues created successfully', {
          totalCodingTasks: jiraResult.totalCodingTasks,
          successfulIssues: jiraResult.createdIssues.length,
          failedIssues: jiraResult.failedIssues.length,
        });
      } else {
        logger.warn('Some Jira issues failed to create', {
          totalCodingTasks: jiraResult.totalCodingTasks,
          successfulIssues: jiraResult.createdIssues.length,
          failedIssues: jiraResult.failedIssues.length,
        });
      }
    } catch (jiraError) {
      logger.error('Jira issue creation failed', {
        error: jiraError.message,
        stack: jiraError.stack,
      });
      
      // Create a failed result object
      jiraResult = {
        success: false,
        error: jiraError.message,
        totalCodingTasks: 0,
        createdIssues: [],
        failedIssues: [],
        participants: [],
      };
    }

    // Step 5: Prepare complete result
    const completeDuration = (Date.now() - startTime) / 1000;
    
    const result = {
      success: true,
      tasks: openaiResult.tasks,
      storage: mongoResult,
      transcriptStorage: transcriptStorageResult,
      jira: jiraResult,
      processing: {
        duration: completeDuration,
        steps: {
          transcriptStorage: true,
          openaiProcessing: true,
          mongodbStorage: true,
          jiraIssueCreation: jiraResult?.success || false,
        },
        metadata: {
          ...openaiResult.metadata,
          mongoDocumentId: mongoResult.documentId,
          transcriptDocumentId: transcriptStorageResult.documentId,
          totalProcessingTime: `${completeDuration.toFixed(2)}s`,
          jiraProcessingTime: jiraResult?.processingTime || '0s',
        }
      },
      summary: {
        participantCount: Object.keys(openaiResult.tasks).length,
        totalTasks: Object.values(openaiResult.tasks).reduce((total, participant) => 
          total + (participant.Coding?.length || 0) + (participant['Non-Coding']?.length || 0), 0
        ),
        totalCodingTasks: jiraResult?.totalCodingTasks || 0,
        jiraIssuesCreated: jiraResult?.createdIssues?.length || 0,
        jiraIssuesFailed: jiraResult?.failedIssues?.length || 0,
        processedAt: new Date().toISOString(),
      }
    };

    logger.info('Task processing completed successfully', {
      participantCount: result.summary.participantCount,
      totalTasks: result.summary.totalTasks,
      totalCodingTasks: result.summary.totalCodingTasks,
      jiraIssuesCreated: result.summary.jiraIssuesCreated,
      jiraIssuesFailed: result.summary.jiraIssuesFailed,
      duration: `${completeDuration.toFixed(2)}s`,
      jiraProcessingTime: result.processing.metadata.jiraProcessingTime,
      mongoDocumentId: mongoResult.documentId,
      transcriptDocumentId: transcriptStorageResult.documentId,
      transcriptDate: transcriptStorageResult.date,
      jiraIntegrationSuccess: jiraResult?.success || false,
    });

    return result;

  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    
    logger.error('Task processing failed', {
      error: error.message,
      stack: error.stack,
      duration: `${duration.toFixed(2)}s`,
      transcriptEntries: transcript.length,
    });

    throw new Error(`Task processing failed: ${error.message}`);
  }
}

/**
 * Process tasks from a transcript JSON file (for testing)
 * @param {string} transcriptFilePath - Path to the transcript JSON file
 * @returns {Promise<Object>} Complete processing result
 */
async function processTranscriptFromFile(transcriptFilePath) {
  const fs = require('fs');
  const path = require('path');
  
  try {
    // Read the transcript file
    const absolutePath = path.resolve(transcriptFilePath);
    const transcriptData = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    
    logger.info('Processing transcript from file', {
      filePath: transcriptFilePath,
      entryCount: transcriptData.length,
    });

    // Process the transcript
    const result = await processTranscriptToTasks(transcriptData, {
      sourceFile: transcriptFilePath,
      fileProcessedAt: new Date().toISOString(),
    });

    return result;

  } catch (error) {
    logger.error('Error processing transcript from file', {
      filePath: transcriptFilePath,
      error: error.message,
    });
    throw new Error(`File processing failed: ${error.message}`);
  }
}

/**
 * Validate that a transcript has the required structure
 * @param {Array} transcript - Transcript array to validate
 * @returns {boolean} True if transcript is valid
 */
function validateTranscript(transcript) {
  if (!Array.isArray(transcript)) {
    return false;
  }

  if (transcript.length === 0) {
    return false;
  }

  // Check that each entry has required fields
  for (const entry of transcript) {
    if (!entry.speaker || !entry.text) {
      return false;
    }
  }

  return true;
}

/**
 * Get a summary of tasks for display/logging purposes
 * @param {Object} tasks - Structured task data
 * @returns {Object} Summary with participant and task counts
 */
function getTaskSummary(tasks) {
  const summary = {
    participants: [],
    totalCodingTasks: 0,
    totalNonCodingTasks: 0,
    totalTasks: 0,
  };

  for (const [participant, participantTasks] of Object.entries(tasks)) {
    const codingCount = participantTasks.Coding?.length || 0;
    const nonCodingCount = participantTasks['Non-Coding']?.length || 0;
    
    summary.participants.push({
      name: participant,
      codingTasks: codingCount,
      nonCodingTasks: nonCodingCount,
      totalTasks: codingCount + nonCodingCount,
    });
    
    summary.totalCodingTasks += codingCount;
    summary.totalNonCodingTasks += nonCodingCount;
  }
  
  summary.totalTasks = summary.totalCodingTasks + summary.totalNonCodingTasks;
  summary.participantCount = summary.participants.length;
  
  return summary;
}

/**
 * Format tasks for display (useful for logging or API responses)
 * @param {Object} tasks - Structured task data
 * @returns {string} Formatted string representation of tasks
 */
function formatTasksForDisplay(tasks) {
  let formatted = '';
  
  for (const [participant, participantTasks] of Object.entries(tasks)) {
    formatted += `\n${participant}'s Tasks:\n`;
    
    if (participantTasks.Coding && participantTasks.Coding.length > 0) {
      formatted += '  Coding Tasks:\n';
      participantTasks.Coding.forEach((task, index) => {
        const taskText = typeof task === 'string' ? task : task.description;
        const taskStatus = typeof task === 'object' ? task.status : 'To-do';
        formatted += `    ${index + 1}. ${taskText} (${taskStatus})\n`;
      });
    }
    
    if (participantTasks['Non-Coding'] && participantTasks['Non-Coding'].length > 0) {
      formatted += '  Non-Coding Tasks:\n';
      participantTasks['Non-Coding'].forEach((task, index) => {
        const taskText = typeof task === 'string' ? task : task.description;
        const taskStatus = typeof task === 'object' ? task.status : 'To-do';
        formatted += `    ${index + 1}. ${taskText} (${taskStatus})\n`;
      });
    }
  }
  
  return formatted;
}

module.exports = {
  processTranscriptToTasks,
  processTranscriptFromFile,
  validateTranscript,
  getTaskSummary,
  formatTasksForDisplay,
};
