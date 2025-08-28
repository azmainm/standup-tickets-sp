/**
 * Standup Tickets SP - Firebase Functions
 * 
 * This Firebase Functions app handles:
 * - Scheduled transcript fetching from Microsoft Teams
 * - Manual transcript fetch endpoints
 * - Health check endpoints
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {logger} = require("firebase-functions");
const express = require("express");
const cors = require("cors");

// Load environment variables
require("dotenv").config();

// Import our services
const {getMeetingTranscript} = require("./services/getTranscript");
const {processTranscriptToTasks} = require("./services/taskProcessor");
const {getMeetingUrlWithFallback, shouldHaveMeetingOnDay} = require("./services/meetingUrlService");

// For cost control, set maximum container instances
setGlobalOptions({maxInstances: 10});

// Create Express app for HTTP endpoints
const app = express();
app.use(cors({origin: true}));
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    message: "Standup Tickets SP Service is running",
    timestamp: new Date().toISOString(),
    timezone: "Asia/Dhaka",
  });
});

// Manual transcript fetch endpoint
app.post("/fetch-transcript", async (req, res) => {
  try {
    // Use provided URL or determine from current day
    const meetingUrl = req.body?.meetingUrl || getMeetingUrlWithFallback();

    if (!meetingUrl) {
      const currentDay = new Date().toLocaleDateString('en-US', { 
        weekday: 'long', 
        timeZone: 'Asia/Dhaka' 
      });
      
      return res.status(400).json({
        error: "Meeting URL is required",
        message: `No meeting URL available for ${currentDay}. Provide meetingUrl in request body or set DAILY_STANDUP_URL_MWF/DAILY_STANDUP_URL_TT environment variables.`,
        currentDay,
        hasMeetingToday: shouldHaveMeetingOnDay(new Date()),
      });
    }

    logger.info("Manual transcript fetch requested", {
      meetingUrl: meetingUrl.substring(0, 50) + "...",
      timestamp: new Date().toISOString(),
    });

    const result = await getMeetingTranscript(meetingUrl);

    if (!result) {
      return res.status(404).json({
        message: "No transcript found for the meeting",
        timestamp: new Date().toISOString(),
      });
    }

    logger.info("Transcript fetched successfully", {
      entryCount: result.metadata.entryCount,
      meetingId: result.metadata.meetingId,
    });

    // Process transcript for tasks
    try {
      logger.info("Processing transcript for tasks");
      const taskResult = await processTranscriptToTasks(result.transcript, result.metadata);
      
      res.json({
        message: "Transcript fetched and processed successfully",
        transcript: result,
        tasks: taskResult,
        timestamp: new Date().toISOString(),
      });
      
    } catch (taskError) {
      logger.error("Task processing failed, returning transcript only", {
        error: taskError.message,
      });
      
      // Return transcript even if task processing fails
      res.json({
        message: "Transcript fetched successfully, but task processing failed",
        transcript: result,
        taskProcessingError: taskError.message,
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

// Scheduled function that runs daily at 2 AM Bangladesh time (GMT+6)
// Cron: "0 2 * * 1-5" - runs Monday through Friday only (skips weekends)
// This fetches the previous day's meeting transcript
exports.dailyTranscriptFetch = onSchedule({
  schedule: "0 2 * * 1-5", // Monday-Friday only at 2 AM Bangladesh time
  timeZone: "Asia/Dhaka",
  memory: "256MiB",
  timeoutSeconds: 300,
}, async (event) => {
  const startTime = Date.now();
  const currentTime = new Date();
  
  logger.info("Starting daily transcript fetch", {
    scheduledTime: event.scheduleTime,
    timestamp: currentTime.toISOString(),
    timezone: "Asia/Dhaka",
    dayOfWeek: currentTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Dhaka' }),
  });

  try {
    // Check if we should have a meeting today (based on previous day logic)
    if (!shouldHaveMeetingOnDay(currentTime)) {
      logger.info("No meeting scheduled for this day, skipping transcript fetch", {
        currentDay: currentTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Dhaka' }),
        date: currentTime.toISOString().split('T')[0],
      });
      return null;
    }
    
    // Get the appropriate meeting URL for the day
    const meetingUrl = getMeetingUrlWithFallback(currentTime);

    if (!meetingUrl) {
      const currentDay = currentTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Dhaka' });
      logger.error("No meeting URL available for the current day", {
        currentDay,
        date: currentTime.toISOString().split('T')[0],
        message: "Set DAILY_STANDUP_URL_MWF and DAILY_STANDUP_URL_TT environment variables",
      });
      throw new Error(`No meeting URL available for ${currentDay}. Set DAILY_STANDUP_URL_MWF and DAILY_STANDUP_URL_TT environment variables.`);
    }

    logger.info("Fetching transcript for daily standup", {
      meetingUrlPrefix: meetingUrl.substring(0, 50) + "...",
    });

    const result = await getMeetingTranscript(meetingUrl);

    if (result) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      logger.info("Transcript fetched successfully", {
        entryCount: result.metadata.entryCount,
        meetingId: result.metadata.meetingId,
        duration: `${duration}s`,
      });

      // Process transcript for tasks
      try {
        logger.info("Processing transcript for tasks in scheduled function");
        const taskResult = await processTranscriptToTasks(result.transcript, result.metadata);
        
        logger.info("Tasks processed and stored successfully", {
          participantCount: taskResult.summary.participantCount,
          totalTasks: taskResult.summary.totalTasks,
          mongoDocumentId: taskResult.storage.documentId,
        });
        
      } catch (taskError) {
        logger.error("Task processing failed in scheduled function", {
          error: taskError.message,
          stack: taskError.stack,
        });
        // Don't throw error here, just log it - transcript was successful
      }

    } else {
      logger.warn("No transcript found for today", {
        date: new Date().toISOString().slice(0, 10),
        possibleReasons: [
          "Meeting hasn't occurred yet",
          "No transcript was generated", 
          "Transcription is still processing",
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
