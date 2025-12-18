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

const { processTranscriptForTasks, processTranscriptForTasksWithPipeline } = require("../integrations/openaiService");
const { storeTasks, storeTranscript, updateTask, updateTaskByTicketId, getActiveTasks } = require("../storage/mongoService");
const { createJiraIssuesForCodingTasks, isJiraTicket, updateJiraIssue } = require("../integrations/jiraService");
const { matchTasksWithDatabase, normalizeTicketId } = require("../pipeline/taskMatcher");
const { sendStandupSummaryToTeams, generateSummaryDataFromTaskResult } = require("../integrations/teamsService");
const { detectStatusChangesFromTranscript, getStatusChangeSummary } = require("../utilities/statusChangeDetectionService");
const { validateLLMResponse } = require("../../schemas/taskSchemas");
const { logger } = require("firebase-functions");

/**
 * Enhanced process a transcript end-to-end with comprehensive task processing
 * @param {Array} transcript - Array of transcript entries
 * @param {Object} transcriptMetadata - Metadata from transcript fetch (optional)
 * @param {Object} processingOptions - Processing options including test mode
 * @returns {Promise<Object>} Complete processing result with enhanced task data and storage info
 */
async function processTranscriptToTasks(transcript, transcriptMetadata = {}, processingOptions = {}) {
  const startTime = Date.now();
  
  try {
    // Check for test mode from multiple sources
    const isTestMode = processingOptions.testMode || 
                      transcriptMetadata.isTestRun || 
                      transcriptMetadata.sourceFile === "test_transcript.json";
    
    logger.info("Starting enhanced task processing flow", {
      transcriptEntries: transcript.length,
      hasMetadata: Object.keys(transcriptMetadata).length > 0,
      isTestMode: isTestMode,
      timestamp: new Date().toISOString(),
    });

    // Step 1: Store the raw transcript in MongoDB (skip for test mode)
    let transcriptStorageResult;
    if (isTestMode) {
      logger.info("🧪 Step 1: Skipping transcript storage (TEST MODE)");
      transcriptStorageResult = {
        success: true,
        documentId: "test-mode-skip",
        timestamp: new Date(),
        message: "Transcript storage skipped - test mode",
        dataSize: JSON.stringify(transcript).length,
        entryCount: transcript.length,
        isTestMode: true
      };
    } else {
      logger.info("📁 Step 1: Storing raw transcript in MongoDB");
      transcriptStorageResult = await storeTranscript(transcript, transcriptMetadata);
    }

    // Step 2: REMOVED - No longer need to sync vector database
    // MongoDB embeddings are automatically updated when tasks change
    logger.info("⚡ Step 2: Skipping vector sync (using MongoDB embeddings)");
    
    // Step 3: Get existing tasks for context
    logger.info("📋 Step 3: Retrieving existing tasks for context");
    const existingTasks = await getActiveTasks();
    logger.info("Retrieved existing tasks", {
      count: existingTasks.length,
      participants: [...new Set(existingTasks.map(t => t.participantName))].length
    });

    // Step 4: Enhanced status change detection
    logger.info("🔍 Step 4: Detecting status changes from transcript");
    const detectedStatusChanges = detectStatusChangesFromTranscript(transcript);
    const statusChangeSummary = getStatusChangeSummary(detectedStatusChanges);
    
    if (detectedStatusChanges.length > 0) {
      logger.info("Status changes detected", statusChangeSummary);
    }

    // Step 5: Enhanced process transcript with OpenAI
    logger.info("🤖 Step 5: Processing transcript with enhanced OpenAI");
    const openaiResult = await processTranscriptForTasks(transcript, existingTasks);
    
    if (!openaiResult.success) {
      throw new Error("Enhanced OpenAI processing failed");
    }

    // Step 6: Validate OpenAI response
    logger.info("✅ Step 6: Validating OpenAI response structure");
    const validationResult = validateLLMResponse(openaiResult.tasks);
    if (!validationResult.success) {
      logger.warn("OpenAI response validation failed", {
        errors: validationResult.errors,
        willProceedWithSanitized: true
      });
    }

    // Step 7: Simple task matching (explicit ticket ID only)
    logger.info("🔗 Step 7: Simple task matching (explicit ticket ID only)");
    
    const matchingResult = await matchTasksWithDatabase(openaiResult.tasks);
    logger.info("✅ Simple task matching completed successfully", {
      explicitIdMatches: matchingResult.summary?.explicitIdMatches || 0,
      newTasks: matchingResult.summary?.newTasks || 0,
      updatedTasks: matchingResult.summary?.updatedTasks || 0
    });
    
    // Step 8: Process detected status changes first
    logger.info("🔄 Step 8: Processing detected status changes");
    const statusChangeResults = [];
    
    console.log("[DEBUG] Processing status changes:", {
      detectedChanges: detectedStatusChanges.length,
      existingTasksCount: existingTasks.length,
      existingTaskIds: existingTasks.map(t => t.ticketId).filter(Boolean)
    });
    
    for (const statusChange of detectedStatusChanges) {
      try {
        console.log("[DEBUG] Processing status change:", {
          taskId: statusChange.taskId,
          newStatus: statusChange.newStatus,
          speaker: statusChange.speaker,
          confidence: statusChange.confidence
        });
        
        // Find the task in database by ticket ID (using normalized comparison)
        const normalizedStatusTaskId = normalizeTicketId(statusChange.taskId);
        const taskToUpdate = existingTasks.find(task => 
          normalizeTicketId(task.ticketId) === normalizedStatusTaskId
        );
        
        console.log("[DEBUG] Task lookup result:", {
          taskId: statusChange.taskId,
          taskFound: !!taskToUpdate,
          taskDetails: taskToUpdate ? {
            currentStatus: taskToUpdate.status,
            participantName: taskToUpdate.participantName,
            documentId: taskToUpdate.documentId
          } : null
        });
        
        if (taskToUpdate) {
          let jiraUpdateSuccess = false;
          let jiraUpdateError = null;
          
          // Update Jira if this is a Jira ticket (skip MongoDB)
          if (isJiraTicket(statusChange.taskId)) {
            try {
              const jiraUpdateResult = await updateJiraIssue(statusChange.taskId, {
                status: statusChange.newStatus
              });
              
              jiraUpdateSuccess = jiraUpdateResult.success;
              
              if (jiraUpdateResult.success) {
                logger.info("Jira status updated successfully (legacy function)", {
                  taskId: statusChange.taskId,
                  oldStatus: taskToUpdate.status,
                  newStatus: statusChange.newStatus,
                  statusUpdated: jiraUpdateResult.statusUpdated
                });
              } else {
                jiraUpdateError = jiraUpdateResult.errors?.join(", ") || "Jira update failed";
                logger.warn("Jira status update failed (legacy function)", {
                  taskId: statusChange.taskId,
                  errors: jiraUpdateResult.errors
                });
              }
            } catch (jiraError) {
              jiraUpdateError = jiraError.message;
              logger.error("Error updating Jira status (legacy function)", {
                taskId: statusChange.taskId,
                error: jiraError.message
              });
            }
          }
          
          console.log("[DEBUG] Status update processed (MongoDB skipped, Jira updated):", {
            taskId: statusChange.taskId,
            oldStatus: taskToUpdate.status,
            newStatus: statusChange.newStatus,
            jiraUpdated: jiraUpdateSuccess
          });
          
          statusChangeResults.push({
            success: jiraUpdateSuccess || !isJiraTicket(statusChange.taskId), // Success if Jira updated or not a Jira ticket
            taskId: statusChange.taskId,
            oldStatus: taskToUpdate.status,
            newStatus: statusChange.newStatus,
            jiraUpdated: jiraUpdateSuccess,
            error: jiraUpdateError,
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
          console.log("[DEBUG] Task not found in database:", {
            searchedTaskId: statusChange.taskId,
            availableTaskIds: existingTasks.map(t => t.ticketId).filter(Boolean),
            totalExistingTasks: existingTasks.length
          });
          
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
        console.log("[DEBUG] Status change error:", {
          taskId: statusChange.taskId,
          error: error.message,
          stack: error.stack
        });
        
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
    // SKIPPED: MongoDB updates and embeddings (handled by Jira automation)
    // Still updating Jira directly
    logger.info("🔄 Step 8: Applying task updates to Jira from matching (MongoDB skipped)", {
      tasksToUpdate: matchingResult.summary.updatedTasks,
    });
    
    const updateResults = [];
    for (const taskUpdate of matchingResult.tasksToUpdate) {
      try {
        const ticketId = taskUpdate.originalTask.ticketId;
        let jiraUpdateSuccess = false;
        let jiraUpdateError = null;
        
        // Update Jira if this is a Jira ticket (skip MongoDB)
        if (ticketId && isJiraTicket(ticketId)) {
          try {
            const jiraUpdateData = {};
            if (taskUpdate.updates.status) {
              jiraUpdateData.status = taskUpdate.updates.status;
            }
            if (taskUpdate.updates.description) {
              jiraUpdateData.description = taskUpdate.updates.description;
            }
            
            if (Object.keys(jiraUpdateData).length > 0) {
              const jiraUpdateResult = await updateJiraIssue(ticketId, jiraUpdateData);
              
              jiraUpdateSuccess = jiraUpdateResult.success;
              
              if (jiraUpdateResult.success) {
                logger.info("Jira task updated successfully from matching (legacy function)", {
                  ticketId,
                  statusUpdated: jiraUpdateResult.statusUpdated,
                  descriptionUpdated: jiraUpdateResult.descriptionUpdated
                });
              } else {
                jiraUpdateError = jiraUpdateResult.errors?.join(", ") || "Jira update failed";
                logger.warn("Jira task update failed from matching (legacy function)", {
                  ticketId,
                  errors: jiraUpdateResult.errors
                });
              }
            }
          } catch (jiraError) {
            jiraUpdateError = jiraError.message;
            logger.error("Error updating Jira task from matching (legacy function)", {
              ticketId,
              error: jiraError.message
            });
          }
        }
        
        updateResults.push({
          success: jiraUpdateSuccess || !ticketId || !isJiraTicket(ticketId), // Success if Jira updated or not a Jira ticket
          taskPath: taskUpdate.originalTask.taskPath,
          updates: taskUpdate.updates,
          similarityScore: taskUpdate.originalTask.similarityScore,
          reasoning: taskUpdate.originalTask.reasoning,
          jiraUpdated: jiraUpdateSuccess,
          error: jiraUpdateError
        });
        
        logger.info("Task update processed (MongoDB skipped, Jira updated)", {
          taskPath: taskUpdate.originalTask.taskPath,
          ticketId,
          updates: taskUpdate.updates,
          jiraUpdated: jiraUpdateSuccess
        });
      } catch (error) {
        logger.error("Error processing task update (MongoDB skipped)", {
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

    // Step 9: Store new tasks in MongoDB (Jira integration removed - legacy function not used)
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
          isFuturePlan: Boolean(newTask.isFuturePlan)
        };
        
        newTasksForStorage[newTask.participantName][newTask.type].push(taskObject);
      }
      
      // Store tasks without Jira integration (legacy function)
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

    // Step 11: Send enhanced summary to Teams webhook
    logger.info("📢 Step 11: Sending enhanced standup summary to Teams");
    let teamsResult = null;
    
    try {
      // Generate summary data from the complete task processing result
      const summaryData = generateSummaryDataFromTaskResult({
        taskMatching: matchingResult,
        jira: { success: true, skipped: true, message: "Jira integration removed from legacy function" },
        tasks: openaiResult.tasks
      }, mongoResult);
      
      // Determine standup date from target date (meeting date) not fetch date
      const standupDate = transcriptMetadata?.targetDate ? 
        new Date(transcriptMetadata.targetDate).toLocaleDateString("en-GB") : 
        new Date().toLocaleDateString("en-GB");
      
      teamsResult = await sendStandupSummaryToTeams(summaryData, {
        standupDate,
        processingDuration: (Date.now() - startTime) / 1000,
        jiraIntegrationSuccess: false, // Jira integration removed from legacy function
        testRun: processingOptions.testMode || false,
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

    // Step 11.5: Clean up local embeddings after Teams notification
    logger.info("🧹 Cleaning up local embeddings");
    try {
      const { clearLocalEmbeddings } = require("../storage/localEmbeddingCache");
      const cleanupResult = clearLocalEmbeddings(transcriptStorageResult.documentId.toString());
      
      if (cleanupResult.success) {
        logger.info("Local embeddings cleaned up successfully", {
          transcriptId: transcriptStorageResult.documentId.toString(),
          clearedCount: cleanupResult.cleared
        });
      }
    } catch (cleanupError) {
      logger.warn("Failed to clean up local embeddings", {
        error: cleanupError.message,
        transcriptId: transcriptStorageResult.documentId.toString()
      });
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
      jira: { success: true, skipped: true, message: "Jira integration removed from legacy function" },
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

/**
 * Generate summary data for Teams notification from pipeline results
 * @param {Object} pipelineResult - Pipeline processing result
 * @param {Object} mongoResult - MongoDB storage result
 * @param {Array} statusChangeResults - Status change results
 * @param {Array} taskUpdateResults - Task update results
 * @returns {Object} Summary data for Teams
 */
function generatePipelineSummaryData(pipelineResult, mongoResult, statusChangeResults = [], taskUpdateResults = []) {
  const summaryData = {
    participants: {},
    futurePlans: [],
    summary: {
      totalNewTasks: 0,
      totalUpdatedTasks: 0,
      totalFuturePlans: 0,
      totalParticipants: 0,
    }
  };

  console.log("[DEBUG] Pipeline summary generation:", {
    pipelineTasksKeys: Object.keys(pipelineResult.tasks),
    mongoAssignedIds: mongoResult?.assignedTicketIds?.length || 0,
    taskUpdatesCount: pipelineResult.pipelineResults?.stage3?.taskUpdates?.length || 0
  });

  // Process new tasks from pipeline result
  let ticketIdIndex = 0;
  
  for (const [participantName, participantTasks] of Object.entries(pipelineResult.tasks)) {
    console.log("[DEBUG] Processing participant:", {
      participant: participantName,
      codingTasks: participantTasks.Coding?.length || 0,
      nonCodingTasks: participantTasks["Non-Coding"]?.length || 0
    });

    // Handle TBD/future plans separately
    if (participantName === "TBD") {
      for (const taskType of ["Coding", "Non-Coding"]) {
        if (participantTasks[taskType] && Array.isArray(participantTasks[taskType])) {
          for (const task of participantTasks[taskType]) {
            const ticketId = mongoResult?.assignedTicketIds?.[ticketIdIndex] || `SP-TBD-${ticketIdIndex}`;
            ticketIdIndex++;
            
            summaryData.futurePlans.push({
              ticketId,
              title: task.title || task.description,
              description: task.description,
              type: taskType,
              status: task.status || "To-do"
            });
            summaryData.summary.totalFuturePlans++;
          }
        }
      }
    } else {
      // Regular participants
      if (!summaryData.participants[participantName]) {
        summaryData.participants[participantName] = {
          newTasks: [],
          updatedTasks: []
        };
      }
      
      for (const taskType of ["Coding", "Non-Coding"]) {
        if (participantTasks[taskType] && Array.isArray(participantTasks[taskType])) {
          for (const task of participantTasks[taskType]) {
            const ticketId = mongoResult?.assignedTicketIds?.[ticketIdIndex] || `TDS-${ticketIdIndex}`;
            ticketIdIndex++;
            
            summaryData.participants[participantName].newTasks.push({
              ticketId,
              title: task.title || task.description,
              description: task.description,
              type: taskType,
              workType: task.workType || "Task",
              status: task.status || "To-do"
            });
            summaryData.summary.totalNewTasks++;
          }
        }
      }
    }
  }

  // Add actual status changes and task updates that were applied
  // Only include tasks that were actually updated with explicit ticket IDs
  for (const statusChange of statusChangeResults.filter(r => r.success)) {
    const participantName = statusChange.speaker || "Unknown";
    
    if (!summaryData.participants[participantName]) {
      summaryData.participants[participantName] = {
        newTasks: [],
        updatedTasks: []
      };
    }
    
    summaryData.participants[participantName].updatedTasks.push({
      ticketId: statusChange.taskId,
      title: "Task update",
      description: `Status changed from ${statusChange.oldStatus} to ${statusChange.newStatus}`,
      type: "Coding",
      status: statusChange.newStatus
    });
    summaryData.summary.totalUpdatedTasks++;
  }
  
  // Add task description updates that were applied
  for (const taskUpdate of taskUpdateResults.filter(r => r.success)) {
    // Find the speaker from status changes or task finder results
    const relatedStatusChange = statusChangeResults.find(sc => sc.taskId === taskUpdate.taskId);
    const relatedTask = pipelineResult.pipelineResults?.stage1?.foundTasks?.find(t => normalizeTicketId(t.ticketId) === normalizeTicketId(taskUpdate.taskId));
    const participantName = relatedStatusChange?.speaker || relatedTask?.assignee || "Unknown";
    
    if (!summaryData.participants[participantName]) {
      summaryData.participants[participantName] = {
        newTasks: [],
        updatedTasks: []
      };
    }
    
    // Check if we already have an update for this task
    const existingUpdate = summaryData.participants[participantName].updatedTasks.find(
      u => normalizeTicketId(u.ticketId) === normalizeTicketId(taskUpdate.taskId)
    );
    if (!existingUpdate) {
      summaryData.participants[participantName].updatedTasks.push({
        ticketId: taskUpdate.taskId,
        title: "Task description update",
        description: "Task description updated",
        type: "Coding",
        status: "To-do"
      });
      summaryData.summary.totalUpdatedTasks++;
    }
  }

  summaryData.summary.totalParticipants = Object.keys(summaryData.participants).length;
  summaryData.source = "3-stage-pipeline";

  console.log("[DEBUG] Generated summary data:", {
    totalNewTasks: summaryData.summary.totalNewTasks,
    totalUpdatedTasks: summaryData.summary.totalUpdatedTasks,
    totalFuturePlans: summaryData.summary.totalFuturePlans,
    participantCount: summaryData.summary.totalParticipants,
    participantNames: Object.keys(summaryData.participants)
  });

  return summaryData;
}

/**
 * NEW: 3-Stage Pipeline - Process transcript end-to-end using Task Finder, Creator, and Updater
 * @param {Array} transcript - Array of transcript entries
 * @param {Object} transcriptMetadata - Metadata from transcript fetch (optional)
 * @param {Object} processingContext - Context for multi-transcript processing
 * @returns {Promise<Object>} Complete processing result with enhanced task data and storage info
 */
async function processTranscriptToTasksWithPipeline(
  transcript, 
  transcriptMetadata = {}, 
  processingContext = {}, 
  processingOptions = {}
) {
  const startTime = Date.now();
  
  try {
    // Check for test mode from multiple sources
    const isTestMode = processingOptions.testMode || 
                      transcriptMetadata.isTestRun || 
                      transcriptMetadata.sourceFile === "test_transcript.json";
    
    logger.info("Starting 3-Stage Pipeline task processing flow", {
      transcriptEntries: transcript.length,
      hasMetadata: Object.keys(transcriptMetadata).length > 0,
      isMultiTranscript: Boolean(processingContext.isMultiTranscript),
      transcriptIndex: processingContext.transcriptIndex || 1,
      isTestMode: isTestMode,
      timestamp: new Date().toISOString(),
    });

    // Step 1: Store the raw transcript in MongoDB (including test mode with test markers)
    let transcriptStorageResult;
    if (isTestMode) {
      logger.info("🧪 Step 1: Storing test transcript in MongoDB (TEST MODE)");
      // Store transcript even in test mode, but mark it as a test
      const testMetadata = {
        ...transcriptMetadata,
        isTestRun: true,
        testDescription: "🧪 TEST RUN - " + (transcriptMetadata.testDescription || "Test transcript"),
        sourceFile: transcriptMetadata.sourceFile || "test_transcript.json"
      };
      transcriptStorageResult = await storeTranscript(transcript, testMetadata);
    } else {
      logger.info("📁 Step 1: Storing raw transcript in MongoDB");
      transcriptStorageResult = await storeTranscript(transcript, transcriptMetadata);
    }

    // Step 2: REMOVED - No longer need to sync vector database
    // MongoDB embeddings are automatically updated when tasks change
    logger.info("⚡ Step 2: Skipping vector sync (using MongoDB embeddings)");
    
    // Step 3: Get existing tasks for context (with isolation for multi-transcript)
    logger.info("📋 Step 3: Retrieving existing tasks for context");
    let existingTasks;
    
    if (processingContext.isMultiTranscript && processingContext.baselineTasksSnapshot) {
      existingTasks = processingContext.baselineTasksSnapshot;
      logger.info("Using baseline task snapshot for context isolation", {
        baselineTaskCount: existingTasks.length,
        transcriptIndex: processingContext.transcriptIndex
      });
    } else {
      existingTasks = await getActiveTasks();
    }
    
    logger.info("Retrieved existing tasks", {
      count: existingTasks.length,
      participants: [...new Set(existingTasks.map(t => t.participantName))].length,
      contextIsolation: processingContext.isMultiTranscript ? "enabled" : "disabled"
    });

    // Step 3: 3-Stage Pipeline Processing (replaces old OpenAI processing)
    logger.info("🚀 Step 3: 3-Stage Pipeline Processing (Task Finder → Creator → Updater)");
    const pipelineResult = await processTranscriptForTasksWithPipeline(transcript, existingTasks, processingContext);
    
    if (!pipelineResult.success) {
      throw new Error("3-Stage Pipeline processing failed");
    }

    // Step 9: Create Jira issues for all tasks (Coding and Non-Coding) before MongoDB storage
    logger.info("🎫 Step 9: Creating Jira issues for all tasks", {
      newTasksCount: Object.keys(pipelineResult.tasks).length > 0 ? 
        Object.values(pipelineResult.tasks).reduce((sum, pt) => 
          sum + (pt.Coding?.length || 0) + (pt["Non-Coding"]?.length || 0), 0) : 0,
    });
    
    let jiraResult = null;
    let jiraTicketIdMap = {}; // Maps task identifier to Jira ticketId
    
    if (Object.keys(pipelineResult.tasks).length > 0) {
      // Prepare tasks for Jira (tasks are already in the correct format from pipeline)
      const tasksForJira = {};
      
      // Convert pipeline tasks format to Jira format (they're already in the right structure)
      for (const [participant, participantTasks] of Object.entries(pipelineResult.tasks)) {
        if ((participantTasks.Coding && participantTasks.Coding.length > 0) || 
            (participantTasks["Non-Coding"] && participantTasks["Non-Coding"].length > 0)) {
          tasksForJira[participant] = {
            "Coding": (participantTasks.Coding || []).map(task => {
              const mappedTask = {
                description: task.description,
                title: task.title,
                status: task.status || "To-do",
                workType: task.workType || "Task",
                estimatedTime: task.estimatedTime || 0,
                priority: task.priority || null,
                storyPoints: task.storyPoints || null,
                projectCode: task.projectCode || null,
                isFuturePlan: Boolean(task.isFuturePlan)
              };
              
              logger.info("Mapping task for Jira (Coding)", {
                participant,
                title: mappedTask.title,
                workType: mappedTask.workType,
                priority: mappedTask.priority,
                estimatedTime: mappedTask.estimatedTime,
                storyPoints: mappedTask.storyPoints,
                projectCode: mappedTask.projectCode,
                hasPriority: task.priority !== undefined && task.priority !== null,
                hasEstimatedTime: task.estimatedTime !== undefined && task.estimatedTime !== null && task.estimatedTime > 0,
                hasStoryPoints: task.storyPoints !== undefined && task.storyPoints !== null && task.storyPoints > 0,
                hasProjectCode: task.projectCode !== undefined && task.projectCode !== null,
              });
              
              return mappedTask;
            }),
            "Non-Coding": (participantTasks["Non-Coding"] || []).map(task => {
              const mappedTask = {
                description: task.description,
                title: task.title,
                status: task.status || "To-do",
                workType: task.workType || "Task",
                estimatedTime: task.estimatedTime || 0,
                priority: task.priority || null,
                storyPoints: task.storyPoints || null,
                projectCode: task.projectCode || null,
                isFuturePlan: Boolean(task.isFuturePlan)
              };
              
              logger.info("Mapping task for Jira (Non-Coding)", {
                participant,
                title: mappedTask.title,
                workType: mappedTask.workType,
                priority: mappedTask.priority,
                estimatedTime: mappedTask.estimatedTime,
                storyPoints: mappedTask.storyPoints,
                projectCode: mappedTask.projectCode,
                hasPriority: task.priority !== undefined && task.priority !== null,
                hasEstimatedTime: task.estimatedTime !== undefined && task.estimatedTime !== null && task.estimatedTime > 0,
                hasStoryPoints: task.storyPoints !== undefined && task.storyPoints !== null && task.storyPoints > 0,
                hasProjectCode: task.projectCode !== undefined && task.projectCode !== null,
              });
              
              return mappedTask;
            })
          };
        }
      }
      
      // Create Jira issues if there are any tasks
      const hasTasks = Object.keys(tasksForJira).length > 0 && 
          Object.values(tasksForJira).some(pt => 
            (pt.Coding && pt.Coding.length > 0) || 
            (pt["Non-Coding"] && pt["Non-Coding"].length > 0)
          );
      
      if (hasTasks) {
        jiraResult = await createJiraIssuesForCodingTasks(tasksForJira);
        
        // Map Jira results back to tasks by participant and order
        for (const participantResult of jiraResult.participants || []) {
          const participant = participantResult.participant;
          let codingIndex = 0;
          let nonCodingIndex = 0;
          
          // Map successful Jira issues
          for (const issue of participantResult.createdIssues || []) {
            const issueType = issue.type || "Coding";
            
            let taskKey;
            if (issueType === "Coding") {
              taskKey = `${participant}:Coding:${codingIndex}`;
              codingIndex++;
            } else {
              taskKey = `${participant}:Non-Coding:${nonCodingIndex}`;
              nonCodingIndex++;
            }
            
            jiraTicketIdMap[taskKey] = issue.issueKey;
            logger.info("Mapped Jira issue to task", {
              taskKey,
              jiraIssueKey: issue.issueKey,
              participant,
              type: issueType,
            });
          }
        }
        
        logger.info("Jira ticket ID mapping created", {
          totalMappings: Object.keys(jiraTicketIdMap).length,
          participants: Object.keys(tasksForJira).length,
        });
      } else {
        jiraResult = {
          success: true,
          createdIssues: [],
          failedIssues: [],
          participants: [],
          message: "No tasks to create Jira issues for",
        };
      }
    } else {
      jiraResult = {
        success: true,
        createdIssues: [],
        failedIssues: [],
        participants: [],
        message: "No new tasks to create Jira issues for",
      };
    }

    // Step 4: Store new tasks and apply updates (with Jira ticketId mapping)
    // SKIPPED: Database storage and embeddings will be handled elsewhere
    logger.info("⏭️ Step 4: Skipping MongoDB storage and embeddings (handled elsewhere)");
    let mongoResult = null;
    
    if (Object.keys(pipelineResult.tasks).length > 0) {
      // Build assignedTicketIds array from jiraTicketIdMap in the same order as tasks
      const assignedTicketIds = [];
      for (const [participantName, participantTasks] of Object.entries(pipelineResult.tasks)) {
        // Process Coding tasks
        if (participantTasks.Coding && Array.isArray(participantTasks.Coding)) {
          for (let codingIndex = 0; codingIndex < participantTasks.Coding.length; codingIndex++) {
            const taskKey = `${participantName}:Coding:${codingIndex}`;
            const ticketId = jiraTicketIdMap[taskKey] || null;
            if (ticketId) {
              assignedTicketIds.push(ticketId);
            }
          }
        }
        // Process Non-Coding tasks
        if (participantTasks["Non-Coding"] && Array.isArray(participantTasks["Non-Coding"])) {
          for (let nonCodingIndex = 0; nonCodingIndex < participantTasks["Non-Coding"].length; nonCodingIndex++) {
            const taskKey = `${participantName}:Non-Coding:${nonCodingIndex}`;
            const ticketId = jiraTicketIdMap[taskKey] || null;
            if (ticketId) {
              assignedTicketIds.push(ticketId);
            }
          }
        }
      }
      
      mongoResult = {
        success: true,
        documentId: null,
        timestamp: new Date(),
        participantCount: Object.keys(pipelineResult.tasks).length,
        totalTasksWithIds: assignedTicketIds.length,
        assignedTicketIds: assignedTicketIds,
        message: "MongoDB storage skipped - handled elsewhere"
      };
      
      logger.info("Built ticket IDs from Jira without storing to database", {
        totalTicketIds: assignedTicketIds.length,
        ticketIds: assignedTicketIds
      });
    } else {
      mongoResult = {
        success: true,
        documentId: null,
        timestamp: new Date(),
        participantCount: 0,
        assignedTicketIds: [],
        message: "No new tasks to store from pipeline"
      };
    }

    // Step 4.1: Apply status changes to existing tasks
    // SKIPPED: MongoDB updates and embeddings (handled by Jira automation)
    // Still updating Jira directly
    logger.info("🔄 Step 4.1: Applying status changes to Jira (MongoDB skipped)");
    const statusChangeResults = [];
    const statusChanges = pipelineResult.statusChanges || [];
    
    for (const statusChange of statusChanges) {
      try {
        const normalizedStatusTaskId = normalizeTicketId(statusChange.taskId);
        const taskToUpdate = existingTasks.find(task => normalizeTicketId(task.ticketId) === normalizedStatusTaskId);
        
        console.log("[DEBUG] Processing status change:", {
          taskId: statusChange.taskId,
          newStatus: statusChange.newStatus,
          taskFound: !!taskToUpdate,
          currentStatus: taskToUpdate?.status
        });
        
        if (taskToUpdate) {
          let jiraUpdateSuccess = false;
          let jiraUpdateError = null;
          
          // Update Jira if this is a Jira ticket (skip MongoDB)
          if (isJiraTicket(statusChange.taskId)) {
            try {
              const jiraUpdateResult = await updateJiraIssue(statusChange.taskId, {
                status: statusChange.newStatus
              });
              
              jiraUpdateSuccess = jiraUpdateResult.success;
              
              if (jiraUpdateResult.success) {
                logger.info("Jira status updated successfully", {
                  taskId: statusChange.taskId,
                  oldStatus: taskToUpdate.status,
                  newStatus: statusChange.newStatus,
                  statusUpdated: jiraUpdateResult.statusUpdated
                });
              } else {
                jiraUpdateError = jiraUpdateResult.errors?.join(", ") || "Jira update failed";
                logger.warn("Jira status update failed", {
                  taskId: statusChange.taskId,
                  errors: jiraUpdateResult.errors
                });
              }
            } catch (jiraError) {
              jiraUpdateError = jiraError.message;
              logger.error("Error updating Jira status", {
                taskId: statusChange.taskId,
                error: jiraError.message
              });
            }
          } else {
            // Not a Jira ticket, skip update
            logger.info("Status change for non-Jira ticket (skipped)", {
              taskId: statusChange.taskId
            });
          }
          
          statusChangeResults.push({
            success: jiraUpdateSuccess || !isJiraTicket(statusChange.taskId), // Success if Jira updated or not a Jira ticket
            taskId: statusChange.taskId,
            oldStatus: taskToUpdate.status,
            newStatus: statusChange.newStatus,
            confidence: statusChange.confidence,
            speaker: statusChange.speaker,
            jiraUpdated: jiraUpdateSuccess,
            error: jiraUpdateError
          });
          
          logger.info("Status change processed (MongoDB skipped, Jira updated)", {
            taskId: statusChange.taskId,
            oldStatus: taskToUpdate.status,
            newStatus: statusChange.newStatus,
            jiraUpdated: jiraUpdateSuccess,
            speaker: statusChange.speaker
          });
        } else {
          console.log("[DEBUG] Task not found for status change:", {
            taskId: statusChange.taskId,
            availableTaskIds: existingTasks.map(t => t.ticketId).filter(Boolean)
          });
          
          statusChangeResults.push({
            success: false,
            taskId: statusChange.taskId,
            error: "Task not found",
            newStatus: statusChange.newStatus
          });
        }
      } catch (error) {
        console.log("[DEBUG] Status change error:", {
          taskId: statusChange.taskId,
          error: error.message
        });
        
        statusChangeResults.push({
          success: false,
          taskId: statusChange.taskId,
          error: error.message,
          newStatus: statusChange.newStatus
        });
      }
    }

    // Step 4.2: Apply task description updates
    // SKIPPED: MongoDB updates and embeddings (handled by Jira automation)
    // Still updating Jira directly
    logger.info("📝 Step 4.2: Applying task description updates to Jira (MongoDB skipped)");
    const taskUpdateResults = [];
    const taskUpdates = pipelineResult.pipelineResults?.stage3?.taskUpdates || [];
    
    for (const update of taskUpdates) {
      try {
        if (update.updateType && update.updateType !== "none" && update.newInformation) {
          // Find the existing task to get current description
          const normalizedUpdateTaskId = normalizeTicketId(update.taskId);
          const _existingTask = existingTasks.find(task => normalizeTicketId(task.ticketId) === normalizedUpdateTaskId);
          
          // RAG-enhanced description is the complete updated description (not just new info)
          const updatedDescription = update.newInformation;
          
          let jiraUpdateSuccess = false;
          let jiraUpdateError = null;
          
          // Update Jira if this is a Jira ticket (skip MongoDB)
          if (isJiraTicket(update.taskId)) {
            try {
              const jiraUpdateResult = await updateJiraIssue(update.taskId, {
                description: updatedDescription
              });
              
              jiraUpdateSuccess = jiraUpdateResult.success;
              
              if (jiraUpdateResult.success) {
                logger.info("Jira description updated successfully", {
                  taskId: update.taskId,
                  updateType: update.updateType,
                  descriptionUpdated: jiraUpdateResult.descriptionUpdated
                });
              } else {
                jiraUpdateError = jiraUpdateResult.errors?.join(", ") || "Jira update failed";
                logger.warn("Jira description update failed", {
                  taskId: update.taskId,
                  errors: jiraUpdateResult.errors
                });
              }
            } catch (jiraError) {
              jiraUpdateError = jiraError.message;
              logger.error("Error updating Jira description", {
                taskId: update.taskId,
                error: jiraError.message
              });
            }
          } else {
            // Not a Jira ticket, skip update
            logger.info("Description update for non-Jira ticket (skipped)", {
              taskId: update.taskId
            });
          }
          
          taskUpdateResults.push({
            success: jiraUpdateSuccess || !isJiraTicket(update.taskId), // Success if Jira updated or not a Jira ticket
            taskId: update.taskId,
            updateType: update.updateType,
            confidence: update.confidence,
            jiraUpdated: jiraUpdateSuccess,
            error: jiraUpdateError
          });
          
          logger.info("Task description update processed (MongoDB skipped, Jira updated)", {
            taskId: update.taskId,
            updateType: update.updateType,
            jiraUpdated: jiraUpdateSuccess,
            confidence: update.confidence
          });
        }
      } catch (error) {
        console.log("[DEBUG] Task update error:", {
          taskId: update.taskId,
          error: error.message
        });
        
        taskUpdateResults.push({
          success: false,
          taskId: update.taskId,
          error: error.message
        });
      }
    }

    // Step 5: Generate meeting notes and store them with attendees
    logger.info("📝 Step 5: Generating meeting notes");
    let meetingNotesResult = null;
    
    try {
      const { generateMeetingNotes } = require("../pipeline/meetingNotesService");
      
      // console.log("[DEBUG] About to generate meeting notes with attendees:", pipelineResult.attendees);
      // console.log("[DEBUG] mongoResult structure:", Object.keys(mongoResult));
      // console.log("[DEBUG] mongoResult.assignedTicketIds:", mongoResult.assignedTicketIds);
      
      // Build the created tasks array with proper ticket IDs and titles
      const createdTasks = [];
      if (mongoResult.assignedTicketIds && pipelineResult.tasks) {
        let ticketIndex = 0;
        for (const [participantName, participantTasks] of Object.entries(pipelineResult.tasks)) {
          for (const taskType of ["Coding", "Non-Coding"]) {
            if (participantTasks[taskType] && Array.isArray(participantTasks[taskType])) {
              for (const task of participantTasks[taskType]) {
                const ticketId = mongoResult.assignedTicketIds[ticketIndex];
                if (ticketId) {
                  createdTasks.push({
                    ticketId: ticketId,
                    title: task.title || task.description?.substring(0, 50) || "Untitled Task",
                    description: task.description || "",
                    assignee: participantName
                  });
                }
                ticketIndex++;
              }
            }
          }
        }
      }
      
      // console.log("[DEBUG] Created tasks for meeting notes:", createdTasks);
      
      meetingNotesResult = await generateMeetingNotes(
        transcript,
        createdTasks,
        taskUpdateResults.filter(result => result.success).map(result => ({ taskId: result.taskId })) || [],
        pipelineResult.attendees || ""
      );
      
      if (meetingNotesResult.success) {
        // Store meeting notes and attendees in the transcript document (including test mode)
        const { updateTranscriptWithNotesAndAttendees } = require("../storage/mongoService");
        
        // console.log("[DEBUG] About to store meeting notes and attendees:", {
        //   transcriptId: transcriptStorageResult.documentId.toString(),
        //   notesLength: meetingNotesResult.meetingNotes.length,
        //   attendees: pipelineResult.attendees || "",
        //   hasNotes: !!meetingNotesResult.meetingNotes,
        //   hasAttendees: !!(pipelineResult.attendees || "")
        // });
        
        await updateTranscriptWithNotesAndAttendees(
          transcriptStorageResult.documentId.toString(),
          meetingNotesResult.meetingNotes,
          pipelineResult.attendees || ""
        );
        
        logger.info("Meeting notes and attendees stored successfully", {
          transcriptId: transcriptStorageResult.documentId.toString(),
          notesLength: meetingNotesResult.meetingNotes.length,
          attendees: pipelineResult.attendees || "",
          isTestMode: isTestMode
        });
      }
    } catch (notesError) {
      logger.error("Meeting notes generation failed", {
        error: notesError.message
      });
      
      meetingNotesResult = {
        success: false,
        error: notesError.message,
        timestamp: new Date().toISOString(),
      };
    }

    // Step 6: Send Teams notification
    logger.info("📢 Step 6: Sending pipeline summary to Teams");
    let teamsResult = null;
    
    try {
      const summaryData = generatePipelineSummaryData(
        pipelineResult, mongoResult, statusChangeResults, taskUpdateResults
      );
      const standupDate = transcriptMetadata?.targetDate ? 
        new Date(transcriptMetadata.targetDate).toLocaleDateString("en-GB") : 
        new Date().toLocaleDateString("en-GB");
      
      teamsResult = await sendStandupSummaryToTeams(summaryData, {
        standupDate,
        processingDuration: (Date.now() - startTime) / 1000,
        pipelineVersion: "1.0",
        testRun: processingOptions.testMode || false,
      });
    } catch (teamsError) {
      logger.error("Teams webhook processing failed", {
        error: teamsError.message
      });
      
      teamsResult = {
        success: false,
        error: teamsError.message,
        timestamp: new Date().toISOString(),
      };
    }

    // Step 7: Clean up local embeddings after Teams notification
    logger.info("🧹 Step 7: Cleaning up local embeddings");
    try {
      const { clearLocalEmbeddings } = require("../storage/localEmbeddingCache");
      const cleanupResult = clearLocalEmbeddings(transcriptStorageResult.documentId.toString());
      
      if (cleanupResult.success) {
        logger.info("Local embeddings cleaned up successfully", {
          transcriptId: transcriptStorageResult.documentId.toString(),
          clearedCount: cleanupResult.cleared,
          remainingCacheSize: cleanupResult.remainingCacheSize
        });
      }
    } catch (cleanupError) {
      logger.warn("Failed to clean up local embeddings", {
        error: cleanupError.message,
        transcriptId: transcriptStorageResult.documentId.toString()
      });
      // Don't fail the entire process for cleanup errors
    }

    // Prepare complete result
    const completeDuration = (Date.now() - startTime) / 1000;
    
    const result = {
      success: true,
      tasks: pipelineResult.tasks,
      storage: mongoResult,
      transcriptStorage: transcriptStorageResult,
      pipelineResults: pipelineResult.pipelineResults,
      statusChanges: {
        detected: pipelineResult.statusChanges,
        applied: statusChangeResults,
        summary: { 
          total: pipelineResult.statusChanges.length,
          applied: statusChangeResults.filter(r => r.success).length
        }
      },
      jira: jiraResult,
      teams: teamsResult,
      processing: {
        duration: completeDuration,
        pipelineSteps: {
          stage1TaskFinder: true,
          stage2TaskCreator: true,
          stage3TaskUpdater: true
        }
      },
      summary: {
        participantCount: Object.keys(pipelineResult.tasks).length,
        extractedTasks: pipelineResult.metadata.totalTasks,
        newTasksCreated: pipelineResult.metadata.newTasks,
        existingTasksUpdated: pipelineResult.pipelineResults.stage3.taskUpdates.length,
        statusChangesDetected: pipelineResult.statusChanges.length,
        statusChangesApplied: statusChangeResults.filter(r => r.success).length,
        processedAt: new Date().toISOString(),
        pipelineUsed: "3-stage-pipeline-v1.0",
        qualityMetrics: {
          averageDescriptionLength: pipelineResult.metadata.averageDescriptionLength
        }
      }
    };

    logger.info("3-Stage Pipeline task processing completed successfully", {
      participantCount: result.summary.participantCount,
      extractedTasks: result.summary.extractedTasks,
      newTasksCreated: result.summary.newTasksCreated,
      duration: `${completeDuration.toFixed(2)}s`,
      averageDescriptionLength: pipelineResult.metadata.averageDescriptionLength,
      pipelineVersion: "1.0"
    });

    return result;

  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    
    logger.error("3-Stage Pipeline task processing failed", {
      error: error.message,
      stack: error.stack,
      duration: `${duration.toFixed(2)}s`,
      transcriptEntries: transcript.length,
      processingContext
    });

    throw new Error(`3-Stage Pipeline task processing failed: ${error.message}`);
  }
}

module.exports = {
  // NEW: 3-Stage Pipeline Functions
  processTranscriptToTasksWithPipeline,
  generatePipelineSummaryData,
  
  // LEGACY: Original Functions (maintained for backward compatibility)
  processTranscriptToTasks,
  processTranscriptFromFile,
  validateTranscript,
  getTaskSummary,
  formatTasksForDisplay,
};
