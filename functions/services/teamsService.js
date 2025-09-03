/**
 * Teams Service for sending standup summary to Microsoft Teams channel
 * 
 * This service handles:
 * 1. Formatting standup summary with new and updated tasks per participant
 * 2. Sending formatted summary to Teams webhook
 * 3. Including task details (ticket ID, title, coding/non-coding classification)
 */

const axios = require("axios");
const {logger} = require("firebase-functions");

// Load environment variables
require("dotenv").config();

/**
 * Send standup summary to Teams channel via webhook
 * @param {Object} summaryData - Summary data containing new and updated tasks per participant
 * @param {Object} metadata - Additional metadata (date, processing time, etc.)
 * @returns {Promise<Object>} Teams webhook result
 */
async function sendStandupSummaryToTeams(summaryData, metadata = {}) {
  try {
    const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
    
    if (!webhookUrl) {
      logger.warn("TEAMS_WEBHOOK_URL environment variable not set, skipping Teams notification");
      return {
        success: false,
        message: "Teams webhook URL not configured",
        skipped: true
      };
    }

    logger.info("Sending standup summary to Teams", {
      participantCount: Object.keys(summaryData.participants || {}).length,
      totalNewTasks: summaryData.summary?.totalNewTasks || 0,
      totalUpdatedTasks: summaryData.summary?.totalUpdatedTasks || 0,
      timestamp: new Date().toISOString(),
    });

    // Format the message according to the specified template
    const formattedMessage = formatStandupSummary(summaryData, metadata);
    
    // Prepare Teams webhook payload
    const teamsPayload = {
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      "themeColor": "0076D7",
      "summary": "Daily Standup Summary",
      "sections": [
        {
          "activityTitle": "📋 Daily Standup Summary",
          "activitySubtitle": `Standup Date: ${metadata.standupDate || new Date().toLocaleDateString("en-GB")}`,
          "text": formattedMessage,
          "markdown": true
        }
      ],
      "potentialAction": [
        {
          "@type": "OpenUri",
          "name": "View Tasks in Admin Panel",
          "targets": [
            {
              "os": "default",
              "uri": "https://sherpaprompt-admin.vercel.app/dashboard/tasks"
            }
          ]
        }
      ]
    };

    // Send to Teams webhook
    const response = await axios.post(webhookUrl, teamsPayload, {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    logger.info("Standup summary sent to Teams successfully", {
      status: response.status,
      statusText: response.statusText,
      participantCount: Object.keys(summaryData.participants || {}).length,
      totalNewTasks: summaryData.summary?.totalNewTasks || 0,
      totalUpdatedTasks: summaryData.summary?.totalUpdatedTasks || 0,
    });

    return {
      success: true,
      status: response.status,
      statusText: response.statusText,
      messageLength: formattedMessage.length,
      timestamp: new Date().toISOString(),
    };

  } catch (error) {
    logger.error("Failed to send standup summary to Teams", {
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
      stack: error.stack,
    });

    return {
      success: false,
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Format standup summary according to the specified template
 * @param {Object} summaryData - Summary data with participant tasks
 * @param {Object} metadata - Additional metadata
 * @returns {string} Formatted message for Teams
 */
function formatStandupSummary(summaryData, metadata = {}) {
  let message = "";

  const participants = summaryData.participants || {};
  
  // Check if there are any tasks to report
  const hasAnyTasks = Object.values(participants).some(participant => 
    (participant.newTasks?.length > 0) || (participant.updatedTasks?.length > 0)
  );

  if (!hasAnyTasks) {
    message += "**No new or updated tasks reported in today's standup.**\n\n";
  } else {
    // Process each participant
    for (const [participantName, participantData] of Object.entries(participants)) {
      const newTasks = participantData.newTasks || [];
      const updatedTasks = participantData.updatedTasks || [];
      
      // Only include participants who have tasks
      if (newTasks.length > 0 || updatedTasks.length > 0) {
        message += `**${participantName}:**\n`;
        
        // New Tasks section
        if (newTasks.length > 0) {
          message += "**New Tasks**\n";
          newTasks.forEach((task, index) => {
            const taskType = task.type === "Coding" ? "Coding" : "Non-Coding";
            const ticketId = task.ticketId || "SP-??";
            const title = task.title || task.description;
            message += `${index + 1}. ${ticketId}: ${title} (${taskType})\n`;
          });
          message += "\n";
        }
        
        // Updated Tasks section
        if (updatedTasks.length > 0) {
          message += "**Updated Tasks**\n";
          updatedTasks.forEach((task, index) => {
            const taskType = task.type === "Coding" ? "Coding" : "Non-Coding";
            const ticketId = task.ticketId || "SP-XX";
            const title = task.title || task.description;
            message += `${index + 1}. ${ticketId}: ${title} (${taskType})\n`;
          });
          message += "\n";
        }
      }
    }
  }

  // Add admin panel link
  message += "**Please check [Admin Panel](https://sherpaprompt-admin.vercel.app/dashboard/tasks) to see the new and updated tasks.**";

  return message;
}

/**
 * Generate summary data structure from task processing results
 * @param {Object} taskResult - Complete task processing result from processTranscriptToTasks
 * @param {Object} mongoResult - MongoDB storage result with assigned ticket IDs  
 * @returns {Object} Structured summary data for Teams notification
 */
function generateSummaryDataFromTaskResult(taskResult, mongoResult = null) {
  const summaryData = {
    participants: {},
    summary: {
      totalNewTasks: 0,
      totalUpdatedTasks: 0,
      totalParticipants: 0,
    }
  };

  try {
    // Process new tasks from the task matching results with ticket IDs from MongoDB result
    if (taskResult.taskMatching?.tasksToCreate) {
      for (const newTask of taskResult.taskMatching.tasksToCreate) {
        const participantName = newTask.participantName;
        
        if (!summaryData.participants[participantName]) {
          summaryData.participants[participantName] = {
            newTasks: [],
            updatedTasks: []
          };
        }
        
        // Try to find the ticket ID from MongoDB storage result
        let ticketId = newTask.ticketId;
        if (mongoResult?.assignedTicketIds) {
          // Map new task to assigned ticket ID by index
          const taskIndex = summaryData.summary.totalNewTasks;
          if (taskIndex < mongoResult.assignedTicketIds.length) {
            ticketId = mongoResult.assignedTicketIds[taskIndex];
          }
        }
        
        summaryData.participants[participantName].newTasks.push({
          ticketId: ticketId || null,
          title: newTask.title || newTask.description,
          description: newTask.description,
          type: newTask.type, // 'Coding' or 'Non-Coding'
          status: newTask.status
        });
        
        summaryData.summary.totalNewTasks++;
      }
    }

    // Process updated tasks from the task matching results
    if (taskResult.taskMatching?.tasksToUpdate) {
      for (const taskUpdate of taskResult.taskMatching.tasksToUpdate) {
        const participantName = taskUpdate.originalTask.participantName;
        
        if (!summaryData.participants[participantName]) {
          summaryData.participants[participantName] = {
            newTasks: [],
            updatedTasks: []
          };
        }
        
        summaryData.participants[participantName].updatedTasks.push({
          ticketId: taskUpdate.originalTask.ticketId || null,
          title: taskUpdate.originalTask.title || taskUpdate.originalTask.description,
          description: taskUpdate.originalTask.description,
          type: taskUpdate.originalTask.type, // 'Coding' or 'Non-Coding'
          status: taskUpdate.updates.status || taskUpdate.originalTask.status,
          updates: taskUpdate.updates
        });
        
        summaryData.summary.totalUpdatedTasks++;
      }
    }

    summaryData.summary.totalParticipants = Object.keys(summaryData.participants).length;

    logger.info("Generated summary data from task result", {
      totalNewTasks: summaryData.summary.totalNewTasks,
      totalUpdatedTasks: summaryData.summary.totalUpdatedTasks,
      totalParticipants: summaryData.summary.totalParticipants,
      participants: Object.keys(summaryData.participants),
    });

    return summaryData;

  } catch (error) {
    logger.error("Error generating summary data from task result", {
      error: error.message,
      stack: error.stack,
    });
    
    return summaryData; // Return empty structure
  }
}

/**
 * Test Teams webhook connection
 * @returns {Promise<boolean>} True if webhook is reachable
 */
async function testTeamsWebhook() {
  try {
    const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
    
    if (!webhookUrl) {
      logger.error("TEAMS_WEBHOOK_URL environment variable is not set");
      return false;
    }

    // Send a simple test message
    const testPayload = {
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      "themeColor": "0078D4",
      "summary": "Test Message",
      "sections": [
        {
          "activityTitle": "🧪 Teams Webhook Test",
          "activitySubtitle": `Test performed at ${new Date().toISOString()}`,
          "text": "This is a test message to verify the Teams webhook connection is working correctly.",
          "markdown": true
        }
      ]
    };

    const response = await axios.post(webhookUrl, testPayload, {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    logger.info("Teams webhook test successful", {
      status: response.status,
      statusText: response.statusText,
    });

    return true;

  } catch (error) {
    logger.error("Teams webhook test failed", {
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
    });
    return false;
  }
}

module.exports = {
  sendStandupSummaryToTeams,
  formatStandupSummary,
  generateSummaryDataFromTaskResult,
  testTeamsWebhook,
};
