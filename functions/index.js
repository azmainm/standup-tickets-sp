/**
 * Standup Tickets SP - Firebase Functions
 * 
 * This Firebase Functions app handles:
 * - Scheduled transcript fetching from Microsoft Teams (with NEW all meetings support)
 * - Manual transcript fetch endpoints (with NEW all meetings support)
 * - Health check endpoints
 * 
 * NEW FEATURES:
 * - All Meetings Approach: If TARGET_USER_ID is configured, fetches all meetings for user
 * - Legacy Fallback: Maintains backward compatibility with specific meeting URLs
 * - Multiple Transcript Processing: Each transcript goes through complete processing pipeline
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {logger} = require("firebase-functions");
const express = require("express");
const cors = require("cors");

// Load environment variables
require("dotenv").config();

// For Firebase deployment, map Firebase config to environment variables if needed
if (process.env.NODE_ENV === "production" && !process.env.OPENAI_API_KEY) {
  const functions = require("firebase-functions");
  
  // Map Firebase config to process.env for backward compatibility
  process.env.AZURE_CLIENT_ID = functions.config().azure?.client_id;
  process.env.AZURE_CLIENT_SECRET = functions.config().azure?.client_secret;
  process.env.AZURE_AUTHORITY = functions.config().azure?.authority;
  process.env.DAILY_STANDUP_URL_MWF = functions.config().daily_standup?.url_mwf;
  process.env.DAILY_STANDUP_URL_TT = functions.config().daily_standup?.url_tt;
  process.env.FIREBASE_PROJECT_ID = functions.config().project?.id;
  process.env.MONGODB_URI = functions.config().mongodb?.uri;
  process.env.OPENAI_API_KEY = functions.config().openai?.api_key;
  process.env.NODE_ENV = functions.config().node?.env;
  process.env.JIRA_URL = functions.config().jira?.url;
  process.env.JIRA_EMAIL = functions.config().jira?.email;
  process.env.JIRA_API_TOKEN = functions.config().jira?.api_token;
  process.env.JIRA_PROJECT_KEY = functions.config().jira?.project_key;
  process.env.TEAMS_WEBHOOK_URL = functions.config().teams?.webhook_url;
  // NEW: All meetings support
  process.env.TARGET_USER_ID = functions.config().target?.user_id;
}

// Import our services
const {processTranscriptToTasks, processTranscriptToTasksWithPipeline} = require("./services/taskProcessor");
const {getBangladeshTimeComponents} = require("./services/meetingUrlService");
// Main service: All meetings approach
const {fetchAllMeetingsForUser} = require("./services/allMeetingsService");

// For cost control, set maximum container instances
setGlobalOptions({maxInstances: 10});

// Create Express app for HTTP endpoints
const app = express();
app.use(cors({origin: true}));
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    message: "Standup Tickets SP Service is running - All Meetings Approach",
    timestamp: new Date().toISOString(),
    timezone: "Asia/Dhaka",
    targetUserId: process.env.TARGET_USER_ID ? process.env.TARGET_USER_ID.substring(0, 20) + "..." : "Not configured",
    approach: "ALL_MEETINGS"
  });
});

// Manual transcript fetch endpoint - All Meetings Approach
app.post("/fetch-transcript", async (req, res) => {
  try {
    // Validate TARGET_USER_ID is configured
    if (!process.env.TARGET_USER_ID) {
      return res.status(400).json({
        error: "All Meetings approach requires configuration",
        message: "TARGET_USER_ID environment variable must be set to use All Meetings approach",
        approach: "ALL_MEETINGS",
        timestamp: new Date().toISOString(),
      });
    }

    // Calculate target date for processing
    const bdTimeForFile = getBangladeshTimeComponents(new Date());
    let targetDateForFile = bdTimeForFile.dateString;
    
    if (bdTimeForFile.hour >= 0 && bdTimeForFile.hour < 6) {
      // Early morning - use previous day for filename
      // Fix: Use dateString directly to avoid timezone issues
      const targetDateObj = new Date(bdTimeForFile.dateString);
      targetDateObj.setDate(targetDateObj.getDate() - 1);
      targetDateForFile = targetDateObj.toISOString().slice(0, 10);
    }

    // Enhanced logging for manual fetch
    const currentTime = new Date();
    const bangladeshTime = new Date(currentTime.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const currentDayName = dayNames[bangladeshTime.getDay()];

    logger.info("🆕 Manual fetch using ALL MEETINGS approach", {
      targetUserId: process.env.TARGET_USER_ID.substring(0, 20) + "...",
      targetDate: targetDateForFile,
      requestedAt: currentTime.toISOString(),
      bangladeshTime: bangladeshTime.toISOString(),
      currentDay: currentDayName,
      isWeekend: bangladeshTime.getDay() === 0 || bangladeshTime.getDay() === 6
    });
    
    let allTranscriptsResults = [];
    
    try {
      const allTranscripts = await fetchAllMeetingsForUser(process.env.TARGET_USER_ID, targetDateForFile);
      
      if (allTranscripts.length > 0) {
        logger.info("Manual fetch: All meetings fetched successfully", {
          transcriptCount: allTranscripts.length,
          targetDate: targetDateForFile,
        });
        allTranscriptsResults = allTranscripts;
      } else {
        logger.info("Manual fetch: No transcripts found", {
          targetDate: targetDateForFile,
          userId: process.env.TARGET_USER_ID.substring(0, 20) + "...",
        });
      }
    } catch (allMeetingsError) {
      logger.error("Manual fetch: All meetings approach failed", {
        error: allMeetingsError.message,
        targetDate: targetDateForFile,
      });
      throw allMeetingsError;
    }

    // Process all transcripts
    if (allTranscriptsResults.length > 0) {
      logger.info("🆕 Manual fetch processing ALL MEETINGS transcripts", {
        transcriptCount: allTranscriptsResults.length,
        targetDate: targetDateForFile,
      });

      const allTaskResults = [];
      let totalSuccessfulProcessing = 0;
      let totalFailedProcessing = 0;

      // 🚀 NEW: Create processing context for multi-transcript 3-Stage Pipeline
      const processingContext = {
        isMultiTranscript: allTranscriptsResults.length > 1,
        totalTranscripts: allTranscriptsResults.length,
        sessionStartTime: new Date().toISOString()
      };

      for (let i = 0; i < allTranscriptsResults.length; i++) {
        const transcriptData = allTranscriptsResults[i];
        
        logger.info(`🚀 Pipeline processing transcript ${i + 1}/${allTranscriptsResults.length}`, {
          meetingSubject: transcriptData.metadata.meetingSubject,
          entries: transcriptData.metadata.entryCount,
          filename: transcriptData.metadata.filename,
          pipelineVersion: "1.0"
        });

        // Set transcript-specific context
        const transcriptContext = {
          ...processingContext,
          transcriptIndex: i + 1
        };

        try {
          const taskResult = await processTranscriptToTasksWithPipeline(
            transcriptData.transcript, 
            transcriptData.metadata,
            transcriptContext
          );
          
          allTaskResults.push({
            transcript: transcriptData,
            tasks: taskResult,
            success: true,
          });
          totalSuccessfulProcessing++;
          
        } catch (taskError) {
          logger.error(`Manual fetch transcript ${i + 1} processing failed`, {
            meetingSubject: transcriptData.metadata.meetingSubject,
            filename: transcriptData.metadata.filename,
            error: taskError.message,
          });
          allTaskResults.push({
            transcript: transcriptData,
            tasks: null,
            success: false,
            error: taskError.message,
          });
          totalFailedProcessing++;
        }
      }

      res.json({
        message: `All meetings fetched and processed - ${totalSuccessfulProcessing} successful, ` +
          `${totalFailedProcessing} failed`,
        approach: "ALL_MEETINGS",
        targetDate: targetDateForFile,
        totalTranscripts: allTranscriptsResults.length,
        successfullyProcessed: totalSuccessfulProcessing,
        failedProcessing: totalFailedProcessing,
        results: allTaskResults,
        timestamp: new Date().toISOString(),
      });

    } else {
      return res.status(404).json({
        message: "No transcripts found for the target date",
        targetDate: targetDateForFile,
        approach: "ALL_MEETINGS",
        targetUserId: process.env.TARGET_USER_ID.substring(0, 20) + "...",
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    logger.error("Error in manual transcript fetch", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: "Failed to fetch transcript",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Export HTTP function
exports.transcriptApi = onRequest(app);

// Scheduled function with ALL MEETINGS approach only
// Runs daily at 2 AM Bangladesh time (GMT+6)
// Cron: "0 2 * * 2-6" - runs Tuesday through Saturday only (skips weekends)
// This fetches the previous day's meeting transcript(s) for all meetings
exports.dailyTranscriptFetch = onSchedule({
  schedule: "0 2 * * 2-6", // Tuesday through Saturday only at 2 AM Bangladesh time
  timeZone: "Asia/Dhaka",
  memory: "256MiB",
  timeoutSeconds: 300,
}, async (event) => {
  const startTime = Date.now();
  const currentTime = new Date();
  
  // Enhanced day and meeting URL logging
  const bangladeshTime = new Date(currentTime.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
  const hour = bangladeshTime.getHours();
  const dayOfWeek = bangladeshTime.getDay();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const currentDayName = dayNames[dayOfWeek];
  
  // Determine target day (if early morning, use previous day)
  let targetDate = new Date(bangladeshTime);
  let targetDayName = currentDayName;
  if (hour >= 0 && hour < 6) {
    targetDate.setDate(targetDate.getDate() - 1);
    targetDayName = dayNames[targetDate.getDay()];
  }
  
  logger.info("🗓️ DAILY TRANSCRIPT FETCH - ALL MEETINGS APPROACH", {
    scheduledTime: event.scheduleTime,
    timestamp: currentTime.toISOString(),
    timezone: "Asia/Dhaka",
    currentHour: hour,
    currentDay: currentDayName,
    targetDay: targetDayName,
    isEarlyMorning: hour >= 0 && hour < 6,
    usingPreviousDay: hour >= 0 && hour < 6,
    approach: "ALL_MEETINGS"
  });

  logger.info("🆕 Starting daily transcript fetch - All Meetings approach", {
    scheduledTime: event.scheduleTime,
    timestamp: currentTime.toISOString(),
    timezone: "Asia/Dhaka",
    dayOfWeek: currentTime.toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Dhaka" }),
  });

  try {
    // Validate TARGET_USER_ID is configured
    if (!process.env.TARGET_USER_ID) {
      logger.error("TARGET_USER_ID not configured for All Meetings approach", {
        message: "Set TARGET_USER_ID environment variable to enable All Meetings approach",
        currentDay: currentDayName,
        date: currentTime.toISOString().split("T")[0],
      });
      throw new Error("TARGET_USER_ID environment variable must be set for All Meetings approach");
    }

    // Calculate target date for filename and processing
    const bdTimeForFile = getBangladeshTimeComponents(new Date());
    let targetDateForFile = bdTimeForFile.dateString;
    if (bdTimeForFile.hour >= 0 && bdTimeForFile.hour < 6) {
      // Early morning - use previous day for filename
      // Fix: Use dateString directly to avoid timezone issues
      const targetDateObj = new Date(bdTimeForFile.dateString);
      targetDateObj.setDate(targetDateObj.getDate() - 1);
      targetDateForFile = targetDateObj.toISOString().slice(0, 10);
    }

    // ALL MEETINGS APPROACH: Fetch all meetings for the user
    logger.info("🆕 Using ALL MEETINGS approach", {
      targetUserId: process.env.TARGET_USER_ID.substring(0, 20) + "...",
      targetDate: targetDateForFile,
      explanation: "Fetching all meetings for user"
    });
    
    let allTranscriptsResults = [];
    
    try {
      const allTranscripts = await fetchAllMeetingsForUser(process.env.TARGET_USER_ID, targetDateForFile);
      
      if (allTranscripts.length > 0) {
        logger.info("All meetings fetched successfully", {
          transcriptCount: allTranscripts.length,
          targetDate: targetDateForFile,
        });
        allTranscriptsResults = allTranscripts;
      } else {
        logger.info("No transcripts found for target date", {
          targetDate: targetDateForFile,
          userId: process.env.TARGET_USER_ID.substring(0, 20) + "...",
          possibleReasons: [
            "No meetings occurred on the target date",
            "No transcripts were generated", 
            "Transcription is still processing",
            "User calendar access issues"
          ]
        });
      }
    } catch (allMeetingsError) {
      logger.error("All meetings approach failed", {
        error: allMeetingsError.message,
        targetDate: targetDateForFile,
        stack: allMeetingsError.stack,
      });
      throw allMeetingsError;
    }

    // Process all transcripts found
    if (allTranscriptsResults.length > 0) {
      // Process each transcript from all meetings
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      logger.info("🆕 Processing ALL MEETINGS transcripts", {
        transcriptCount: allTranscriptsResults.length,
        targetDate: targetDateForFile,
        duration: `${duration}s`,
      });

      let totalSuccessfulProcessing = 0;
      let totalFailedProcessing = 0;

      // 🚀 NEW: Create processing context for multi-transcript 3-Stage Pipeline
      const processingContext = {
        isMultiTranscript: allTranscriptsResults.length > 1,
        totalTranscripts: allTranscriptsResults.length,
        sessionStartTime: new Date().toISOString()
      };

      for (let i = 0; i < allTranscriptsResults.length; i++) {
        const transcriptData = allTranscriptsResults[i];
        
        logger.info(`🚀 Pipeline processing transcript ${i + 1}/${allTranscriptsResults.length}`, {
          meetingSubject: transcriptData.metadata.meetingSubject,
          entries: transcriptData.metadata.entryCount,
          filename: transcriptData.metadata.filename,
          pipelineVersion: "1.0"
        });

        // Set transcript-specific context
        const transcriptContext = {
          ...processingContext,
          transcriptIndex: i + 1
        };

        try {
          const taskResult = await processTranscriptToTasksWithPipeline(
            transcriptData.transcript, 
            transcriptData.metadata,
            transcriptContext
          );
          
          logger.info(`Transcript ${i + 1} processed successfully`, {
            meetingSubject: transcriptData.metadata.meetingSubject,
            participantCount: taskResult.summary.participantCount,
            extractedTasks: taskResult.summary.extractedTasks,
            newTasksCreated: taskResult.summary.newTasksCreated,
            existingTasksUpdated: taskResult.summary.existingTasksUpdated,
            jiraIssuesCreated: taskResult.summary.jiraIssuesCreated,
            mongoDocumentId: taskResult.storage?.documentId,
          });
          
          totalSuccessfulProcessing++;
          
        } catch (taskError) {
          logger.error(`Transcript ${i + 1} processing failed`, {
            meetingSubject: transcriptData.metadata.meetingSubject,
            filename: transcriptData.metadata.filename,
            error: taskError.message,
            stack: taskError.stack,
          });
          totalFailedProcessing++;
          // Continue processing other transcripts
        }
      }

      logger.info("🆕 ALL MEETINGS processing completed", {
        totalTranscripts: allTranscriptsResults.length,
        successfullyProcessed: totalSuccessfulProcessing,
        failedProcessing: totalFailedProcessing,
        targetDate: targetDateForFile,
        duration: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
      });

    } else {
      logger.warn("No transcripts found for target date", {
        date: targetDateForFile,
        targetUserId: process.env.TARGET_USER_ID.substring(0, 20) + "...",
        approach: "ALL_MEETINGS",
        possibleReasons: [
          "No meetings occurred on the target date",
          "No transcripts were generated", 
          "Transcription is still processing",
          "User calendar access issues",
        ],
      });
    }

    return null;
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    logger.error("Error in scheduled transcript fetch", {
      error: error.message,
      stack: error.stack,
      duration: `${duration}s`,
      timestamp: new Date().toISOString(),
    });

    // Optionally send error notifications
    // You can add error reporting to Slack, email, etc. here

    throw error; // Re-throw to mark the function as failed
  }
});