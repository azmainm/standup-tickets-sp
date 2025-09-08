/**
 * Enhanced Task Processing Service - Orchestrates the complete task processing flow
 * 
 * This service coordinates:
 * 1. Processing transcripts with enhanced OpenAI to extract tasks with better context
 * 2. Advanced status change detection and handling
 * 3. Improved task matching with existing database tasks
 * 4. Enhanced assignee detection including 'for me' patterns
 * 5. Better future plans detection and processing
 * 6. Storing the processed tasks in MongoDB with validation
 * 7. Handling the complete end-to-end flow with comprehensive error handling
 */

const { processTranscriptForTasks } = require("./openaiService");
const { storeTasks, storeTranscript, updateTask, updateTaskByTicketId, getActiveTasks } = require("./mongoService");
// const { createJiraIssuesForCodingTasks } = require("./jiraService"); // Removed from main flow - kept for future reuse
const { matchTasksWithDatabaseEnhanced, matchTasksWithDatabase } = require("./taskMatcher");
const { sendStandupSummaryToTeams, generateSummaryDataFromTaskResult } = require("./teamsService");
const { detectStatusChangesFromTranscript, getStatusChangeSummary } = require("./statusChangeDetectionService");
const { validateLLMResponse } = require("../schemas/taskSchemas");
const { logger } = require("firebase-functions");

/**
 * Enhanced process a transcript end-to-end with comprehensive task processing
 * @param {Array} transcript - Array of transcript entries
 * @param {Object} transcriptMetadata - Metadata from transcript fetch (optional)
 * @returns {Promise<Object>} Complete processing result with enhanced task data and storage info
 */
async function processTranscriptToTasks(transcript, transcriptMetadata = {}) {
  const startTime = Date.now();
  
  try {
    logger.info("Starting enhanced task processing flow", {
      transcriptEntries: transcript.length,
      hasMetadata: Object.keys(transcriptMetadata).length > 0,
      timestamp: new Date().toISOString(),
    });

    // Step 1: Store the raw transcript in MongoDB
    logger.info("📁 Step 1: Storing raw transcript in MongoDB");
    const transcriptStorageResult = await storeTranscript(transcript, transcriptMetadata);

    // Step 2: Get existing tasks for context
    logger.info("📋 Step 2: Retrieving existing tasks for context");
    const existingTasks = await getActiveTasks();
    logger.info("Retrieved existing tasks", {
      count: existingTasks.length,
      participants: [...new Set(existingTasks.map(t => t.participantName))].length
    });

    // Step 3: Enhanced status change detection
    logger.info("🔍 Step 3: Detecting status changes from transcript");
    const detectedStatusChanges = detectStatusChangesFromTranscript(transcript);
    const statusChangeSummary = getStatusChangeSummary(detectedStatusChanges);
    
    if (detectedStatusChanges.length > 0) {
      logger.info("Status changes detected", statusChangeSummary);
    }

    // Step 4: Enhanced process transcript with OpenAI
    logger.info("🤖 Step 4: Processing transcript with enhanced OpenAI");
    const openaiResult = await processTranscriptForTasks(transcript, existingTasks);
    
    if (!openaiResult.success) {
      throw new Error("Enhanced OpenAI processing failed");
    }

    // Step 5: Validate OpenAI response
    logger.info("✅ Step 5: Validating OpenAI response structure");
    const validationResult = validateLLMResponse(openaiResult.tasks);
    if (!validationResult.success) {
      logger.warn("OpenAI response validation failed", {
        errors: validationResult.errors,
        willProceedWithSanitized: true
      });
    }

    // Step 6: Enhanced match extracted tasks with existing database tasks (Vector + GPT + Sync)
    logger.info("🔗 Step 6: Enhanced matching tasks with vector similarity and admin panel sync");
    
    let matchingResult;
    try {
      // Try enhanced matching first (vector + GPT + admin panel sync)
      matchingResult = await matchTasksWithDatabaseEnhanced(openaiResult.tasks);
      logger.info("✨ Enhanced vector-based task matching completed successfully", {
        vectorMatches: matchingResult.summary?.vectorMatches || 0,
        gptMatches: matchingResult.summary?.gptMatches || 0,
        syncAdded: matchingResult.synchronization?.added || 0,
        syncUpdated: matchingResult.synchronization?.updated || 0
      });
    } catch (error) {
      logger.warn("Enhanced task matching failed, falling back to legacy method", {
        error: error.message
      });
      // Fallback to legacy matching
      matchingResult = await matchTasksWithDatabase(openaiResult.tasks);
    }
    
    // Step 7: Process detected status changes first
    logger.info("🔄 Step 7: Processing detected status changes");
    const statusChangeResults = [];
    
    for (const statusChange of detectedStatusChanges) {
      try {
        // Find the task in database by ticket ID
        const taskToUpdate = existingTasks.find(task => 
          task.ticketId === statusChange.taskId
        );
        
        if (taskToUpdate) {
          const updateResult = await updateTaskByTicketId(
            statusChange.taskId,
            { status: statusChange.newStatus }
          );
          
          statusChangeResults.push({
            success: updateResult.success,
            taskId: statusChange.taskId,
            oldStatus: taskToUpdate.status,
            newStatus: statusChange.newStatus,
            confidence: statusChange.confidence,
            speaker: statusChange.speaker
          });
          
          logger.info("Status change applied", {
            taskId: statusChange.taskId,
            oldStatus: taskToUpdate.status,
            newStatus: statusChange.newStatus,
            speaker: statusChange.speaker
          });
        } else {
          logger.warn("Task not found for status change", {
            taskId: statusChange.taskId,
            newStatus: statusChange.newStatus
          });
          
          statusChangeResults.push({
            success: false,
            taskId: statusChange.taskId,
            error: "Task not found in database",
            newStatus: statusChange.newStatus
          });
        }
      } catch (error) {
        logger.error("Failed to apply status change", {
          taskId: statusChange.taskId,
          error: error.message
        });
        
        statusChangeResults.push({
          success: false,
          taskId: statusChange.taskId,
          error: error.message
        });
      }
    }

    // Step 8: Update existing tasks in the database (from task matching)
    logger.info("📝 Step 8: Updating existing tasks from task matching", {
      tasksToUpdate: matchingResult.summary.updatedTasks,
    });
    
    const updateResults = [];
    for (const taskUpdate of matchingResult.tasksToUpdate) {
      try {
        const updateResult = await updateTask(
          taskUpdate.originalTask.documentId,
          taskUpdate.originalTask.taskPath,
          taskUpdate.updates
        );
        updateResults.push({
          success: updateResult.success,
          taskPath: taskUpdate.originalTask.taskPath,
          updates: taskUpdate.updates,
          similarityScore: taskUpdate.originalTask.similarityScore,
          reasoning: taskUpdate.originalTask.reasoning
        });
      } catch (error) {
        logger.error("Failed to update task from matching", {
          taskPath: taskUpdate.originalTask.taskPath,
          error: error.message,
        });
        updateResults.push({
          success: false,
          taskPath: taskUpdate.originalTask.taskPath,
          error: error.message
        });
      }
    }

    // Step 9: Store new tasks in MongoDB (only the ones that don't match existing tasks)
    logger.info("💾 Step 9: Storing new tasks in MongoDB", {
      newTasksCount: matchingResult.summary.newTasks,
    });
    
    let mongoResult = null;
    if (matchingResult.tasksToCreate.length > 0) {
      // Convert new tasks back to the original format for storage
      const newTasksForStorage = {};
      
      for (const newTask of matchingResult.tasksToCreate) {
        if (!newTasksForStorage[newTask.participantName]) {
          newTasksForStorage[newTask.participantName] = {
            "Coding": [],
            "Non-Coding": []
          };
        }
        
        const taskObject = {
          description: newTask.description,
          status: newTask.status,
          estimatedTime: newTask.estimatedTime || 0,
          timeTaken: newTask.timeTaken || 0,
          isFuturePlan: Boolean(newTask.isFuturePlan)
        };
        
        newTasksForStorage[newTask.participantName][newTask.type].push(taskObject);
      }
      
      mongoResult = await storeTasks(newTasksForStorage, {
        ...openaiResult.metadata,
        transcriptMetadata,
        transcriptDocumentId: transcriptStorageResult.documentId,
        processingDuration: (Date.now() - startTime) / 1000,
        taskMatchingResults: matchingResult.summary,
      });
    } else {
      // No new tasks to store
      mongoResult = {
        success: true,
        documentId: null,
        timestamp: new Date(),
        participantCount: 0,
        message: "No new tasks to store - all were updates to existing tasks"
      };
    }

    // Step 10: Jira integration removed from main flow (kept jiraService.js for future reuse)
    logger.info("⏭️  Step 10: Skipping Jira integration (removed from main flow)");
    const jiraResult = {
      success: true,
      skipped: true,
      message: "Jira integration removed from main flow",
      totalCodingTasks: 0,
      createdIssues: [],
      failedIssues: [],
      participants: [],
      processingTime: "0s"
    };

    // Step 11: Send enhanced summary to Teams webhook
    logger.info("📢 Step 11: Sending enhanced standup summary to Teams");
    let teamsResult = null;
    
    try {
      // Generate summary data from the complete task processing result
      const summaryData = generateSummaryDataFromTaskResult({
        taskMatching: matchingResult,
        jira: jiraResult,
        tasks: openaiResult.tasks
      }, mongoResult);
      
      // Determine standup date from target date (meeting date) not fetch date
      const standupDate = transcriptMetadata?.targetDate ? 
        new Date(transcriptMetadata.targetDate).toLocaleDateString("en-GB") : 
        new Date().toLocaleDateString("en-GB");
      
      teamsResult = await sendStandupSummaryToTeams(summaryData, {
        standupDate,
        processingDuration: (Date.now() - startTime) / 1000,
        jiraIntegrationSuccess: jiraResult?.success || false,
      });
      
      if (teamsResult.success) {
        logger.info("Teams summary sent successfully", {
          totalNewTasks: summaryData.summary?.totalNewTasks || 0,
          totalUpdatedTasks: summaryData.summary?.totalUpdatedTasks || 0,
          totalParticipants: summaryData.summary?.totalParticipants || 0,
          messageLength: teamsResult.messageLength,
        });
      } else if (teamsResult.skipped) {
        logger.info("Teams notification skipped (webhook URL not configured)");
      } else {
        logger.warn("Teams summary failed to send", {
          error: teamsResult.error,
          status: teamsResult.status,
        });
      }
    } catch (teamsError) {
      logger.error("Teams webhook processing failed", {
        error: teamsError.message,
        stack: teamsError.stack,
      });
      
      // Create a failed result object
      teamsResult = {
        success: false,
        error: teamsError.message,
        timestamp: new Date().toISOString(),
      };
    }

    // Step 12: Prepare enhanced complete result
    const completeDuration = (Date.now() - startTime) / 1000;
    
    const result = {
      success: true,
      tasks: openaiResult.tasks,
      storage: mongoResult,
      transcriptStorage: transcriptStorageResult,
      taskMatching: matchingResult,
      taskUpdates: updateResults,
      statusChanges: {
        detected: detectedStatusChanges,
        applied: statusChangeResults,
        summary: statusChangeSummary
      },
      jira: jiraResult,
      teams: teamsResult,
      validation: {
        openaiValidation: validationResult,
        enhancementsApplied: true
      },
      processing: {
        duration: completeDuration,
        steps: {
          transcriptStorage: true,
          existingTasksRetrieval: true,
          statusChangeDetection: detectedStatusChanges.length > 0,
          enhancedOpenaiProcessing: true,
          responseValidation: true,
          taskMatching: true,
          statusChangeUpdates: statusChangeResults.length > 0,
          taskUpdates: updateResults.length > 0,
          mongodbStorage: mongoResult?.success || false,
          jiraIssueCreation: false, // Removed from main flow
          teamsNotification: teamsResult?.success || false,
        },
        metadata: {
          ...openaiResult.metadata,
          mongoDocumentId: mongoResult?.documentId,
          transcriptDocumentId: transcriptStorageResult.documentId,
          totalProcessingTime: `${completeDuration.toFixed(2)}s`,
          jiraProcessingTime: jiraResult?.processingTime || "0s",
          existingTasksContext: existingTasks.length,
          statusChangesDetected: detectedStatusChanges.length,
          statusChangesApplied: statusChangeResults.filter(r => r.success).length
        }
      },
      summary: {
        participantCount: Object.keys(openaiResult.tasks).length,
        extractedTasks: Object.values(openaiResult.tasks).reduce((total, participant) => 
          total + (participant.Coding?.length || 0) + (participant["Non-Coding"]?.length || 0), 0
        ),
        newTasksCreated: matchingResult.summary.newTasks,
        existingTasksUpdated: matchingResult.summary.updatedTasks,
        statusChangesDetected: detectedStatusChanges.length,
        statusChangesApplied: statusChangeResults.filter(r => r.success).length,
        totalCodingTasks: 0, // Jira integration removed
        jiraIssuesCreated: 0, // Jira integration removed
        jiraIssuesFailed: 0, // Jira integration removed
        processedAt: new Date().toISOString(),
        enhancementsUsed: [
          "Enhanced OpenAI prompts",
          "Status change detection",
          "Improved task matching",
          "Assignee detection",
          "Response validation"
        ]
      }
    };

    logger.info("Enhanced task processing completed successfully", {
      participantCount: result.summary.participantCount,
      extractedTasks: result.summary.extractedTasks,
      newTasksCreated: result.summary.newTasksCreated,
      existingTasksUpdated: result.summary.existingTasksUpdated,
      statusChangesDetected: result.summary.statusChangesDetected,
      statusChangesApplied: result.summary.statusChangesApplied,
      totalCodingTasks: result.summary.totalCodingTasks,
      jiraIssuesCreated: result.summary.jiraIssuesCreated,
      jiraIssuesFailed: result.summary.jiraIssuesFailed,
      duration: `${completeDuration.toFixed(2)}s`,
      jiraProcessingTime: "0s", // Jira integration removed
      mongoDocumentId: mongoResult?.documentId,
      transcriptDocumentId: transcriptStorageResult.documentId,
      transcriptDate: transcriptStorageResult.date,
      jiraIntegrationSkipped: true, // Jira integration removed from main flow
      teamsNotificationSuccess: teamsResult?.success || false,
      teamsNotificationSkipped: teamsResult?.skipped || false,
      enhancementsApplied: result.summary.enhancementsUsed.length,
      validationSuccess: validationResult.success,
      existingTasksContext: existingTasks.length
    });

    return result;

  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    
    logger.error("Enhanced task processing failed", {
      error: error.message,
      stack: error.stack,
      duration: `${duration.toFixed(2)}s`,
      transcriptEntries: transcript.length,
      hasMetadata: Object.keys(transcriptMetadata).length > 0,
      errorType: error.constructor.name
    });

    throw new Error(`Enhanced task processing failed: ${error.message}`);
  }
}

/**
 * Process tasks from a transcript JSON file (for testing)
 * @param {string} transcriptFilePath - Path to the transcript JSON file
 * @returns {Promise<Object>} Complete processing result
 */
async function processTranscriptFromFile(transcriptFilePath) {
  const fs = require("fs");
  const path = require("path");
  
  try {
    // Read the transcript file
    const absolutePath = path.resolve(transcriptFilePath);
    const transcriptData = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    
    logger.info("Processing transcript from file", {
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
    logger.error("Error processing transcript from file", {
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
    const nonCodingCount = participantTasks["Non-Coding"]?.length || 0;
    
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
  let formatted = "";
  
  for (const [participant, participantTasks] of Object.entries(tasks)) {
    formatted += `\n${participant}'s Tasks:\n`;
    
    if (participantTasks.Coding && participantTasks.Coding.length > 0) {
      formatted += "  Coding Tasks:\n";
      participantTasks.Coding.forEach((task, index) => {
        const taskText = typeof task === "string" ? task : task.description;
        const taskStatus = typeof task === "object" ? task.status : "To-do";
        formatted += `    ${index + 1}. ${taskText} (${taskStatus})\n`;
      });
    }
    
    if (participantTasks["Non-Coding"] && participantTasks["Non-Coding"].length > 0) {
      formatted += "  Non-Coding Tasks:\n";
      participantTasks["Non-Coding"].forEach((task, index) => {
        const taskText = typeof task === "string" ? task : task.description;
        const taskStatus = typeof task === "object" ? task.status : "To-do";
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
