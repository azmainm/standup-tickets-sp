/**
 * Jira Service for creating issues/tickets for coding tasks
 * 
 * This service handles:
 * 1. Authentication with Jira using API tokens
 * 2. Creating issues for coding tasks
 * 3. Assigning issues to appropriate users
 */

const axios = require("axios");
const {logger} = require("firebase-functions");
const { getJiraAssigneeForParticipant } = require("../config/participantMapping");

// Load environment variables
require("dotenv").config();

/**
 * Test Jira API connection
 * @returns {Promise<boolean>} True if connection successful
 */
async function testJiraConnection() {
  try {
    const { JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
    
    if (!JIRA_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
      logger.error("Missing Jira environment variables", {
        hasJiraUrl: !!JIRA_URL,
        hasJiraEmail: !!JIRA_EMAIL,
        hasJiraToken: !!JIRA_API_TOKEN,
      });
      return false;
    }

    // Create authentication header
    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
    
    // Test API connection by getting user info
    const response = await axios.get(`${JIRA_URL}/rest/api/2/myself`, {
      headers: {
        "Authorization": `Basic ${auth}`,
        "Accept": "application/json",
      },
      timeout: 10000,
    });
    
    logger.info("Jira connection test successful", {
      user: response.data.displayName,
      accountType: response.data.accountType,
    });
    
    return true;
    
  } catch (error) {
    logger.error("Jira connection test failed", {
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
    });
    return false;
  }
}

/**
 * Get Jira project information
 * @param {string} projectKey - The project key (e.g., 'PROM')
 * @returns {Promise<Object|null>} Project information or null if not found
 */
async function getProjectInfo(projectKey) {
  try {
    const { JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
    
    const response = await axios.get(`${JIRA_URL}/rest/api/2/project/${projectKey}`, {
      headers: {
        "Authorization": `Basic ${auth}`,
        "Accept": "application/json",
      },
      timeout: 10000,
    });
    
    logger.info("Project information retrieved", {
      projectKey: response.data.key,
      projectName: response.data.name,
      projectType: response.data.projectTypeKey,
    });
    
    return response.data;
    
  } catch (error) {
    logger.error("Failed to get project information", {
      projectKey,
      error: error.message,
      status: error.response?.status,
    });
    return null;
  }
}

/**
 * Create a Jira issue for a coding task
 * @param {Object} taskData - Task data containing title, description, and assignee
 * @param {string} taskData.title - Issue title (summary)
 * @param {string} taskData.description - Issue description
 * @param {string} taskData.assignee - Assignee name/email
 * @param {string} taskData.participant - Original participant name from transcript
 * @returns {Promise<Object>} Jira issue creation result
 */
async function createJiraIssue(taskData) {
  try {
    const { JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY } = process.env;
    
    if (!JIRA_URL || !JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_PROJECT_KEY) {
      throw new Error("Missing required Jira environment variables");
    }

    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
    
    // Prepare the issue data
    const issueData = {
      fields: {
        project: {
          key: JIRA_PROJECT_KEY,
        },
        summary: taskData.title,
        description: taskData.description,
        issuetype: {
          name: "Task", // Default issue type
        },
      },
    };

    // Try to assign the issue using the participant mapping
    if (taskData.assignee) {
      try {
        // Search for user by email/username
        const userSearchResponse = await axios.get(
          `${JIRA_URL}/rest/api/2/user/search?query=${encodeURIComponent(taskData.assignee)}`,
          {
            headers: {
              "Authorization": `Basic ${auth}`,
              "Accept": "application/json",
            },
            timeout: 5000,
          }
        );
        
        if (userSearchResponse.data && userSearchResponse.data.length > 0) {
          // Find exact match by email or accountId
          const exactMatch = userSearchResponse.data.find(user => 
            user.emailAddress?.toLowerCase() === taskData.assignee.toLowerCase() ||
            user.name?.toLowerCase() === taskData.assignee.toLowerCase()
          );
          
          const userToAssign = exactMatch || userSearchResponse.data[0];
          
          issueData.fields.assignee = {
            accountId: userToAssign.accountId,
          };
          
          logger.info("Found and assigned Jira user", {
            participantName: taskData.participant,
            assigneeEmail: taskData.assignee,
            jiraAccountId: userToAssign.accountId,
            jiraDisplayName: userToAssign.displayName,
            jiraEmail: userToAssign.emailAddress,
            exactMatch: !!exactMatch,
          });
        } else {
          logger.warn("No Jira user found for assignee", {
            participantName: taskData.participant,
            assigneeEmail: taskData.assignee,
          });
        }
      } catch (assigneeError) {
        logger.warn("Could not search for assignee in Jira", {
          participantName: taskData.participant,
          assigneeEmail: taskData.assignee,
          error: assigneeError.message,
          status: assigneeError.response?.status,
        });
        // Continue creating the issue without assignee
      }
    }

    // Create the issue
    const response = await axios.post(`${JIRA_URL}/rest/api/2/issue`, issueData, {
      headers: {
        "Authorization": `Basic ${auth}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    const createdIssue = response.data;
    
    logger.info("Jira issue created successfully", {
      issueKey: createdIssue.key,
      issueId: createdIssue.id,
      title: taskData.title,
      participant: taskData.participant,
      assignee: taskData.assignee || "Unassigned",
    });

    return {
      success: true,
      issueKey: createdIssue.key,
      issueId: createdIssue.id,
      issueUrl: `${JIRA_URL}/browse/${createdIssue.key}`,
      title: taskData.title,
      participant: taskData.participant,
      assignee: taskData.assignee,
    };

  } catch (error) {
    logger.error("Failed to create Jira issue", {
      title: taskData.title,
      participant: taskData.participant,
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
    });

    return {
      success: false,
      error: error.message,
      title: taskData.title,
      participant: taskData.participant,
    };
  }
}

/**
 * Create multiple Jira issues for coding tasks from all participants
 * @param {Object} tasksData - Structured task data organized by participant
 * @returns {Promise<Object>} Results of issue creation for all coding tasks
 */
async function createJiraIssuesForCodingTasks(tasksData) {
  const startTime = Date.now();
  
  try {
    logger.info("Starting Jira issue creation for coding tasks", {
      participantCount: Object.keys(tasksData).length,
      timestamp: new Date().toISOString(),
    });

    const results = {
      success: true,
      totalCodingTasks: 0,
      createdIssues: [],
      failedIssues: [],
      participants: [],
    };

    // Process each participant's coding tasks
    for (const [participant, participantTasks] of Object.entries(tasksData)) {
      const codingTasks = participantTasks.Coding || [];
      
      if (codingTasks.length === 0) {
        logger.info("No coding tasks found for participant", { participant });
        continue;
      }

      logger.info("Processing coding tasks for participant", {
        participant,
        codingTaskCount: codingTasks.length,
      });

      const participantResults = {
        participant,
        codingTaskCount: codingTasks.length,
        createdIssues: [],
        failedIssues: [],
      };

      // Process each coding task for this participant
      for (let i = 0; i < codingTasks.length; i++) {
        const task = codingTasks[i];
        const taskDescription = typeof task === "string" ? task : task.description;
        
        try {
          // First, generate a title for the task using GPT
          const taskTitle = await generateTaskTitle(taskDescription);
          
          // Get the appropriate Jira assignee for this participant
          const jiraAssignee = getJiraAssigneeForParticipant(participant);
          
          // Create the Jira issue
          const issueResult = await createJiraIssue({
            title: taskTitle,
            description: taskDescription,
            participant: participant,
            assignee: jiraAssignee, // Use mapped email/username for assignment
          });

          if (issueResult.success) {
            participantResults.createdIssues.push(issueResult);
            results.createdIssues.push(issueResult);
          } else {
            participantResults.failedIssues.push(issueResult);
            results.failedIssues.push(issueResult);
          }

          results.totalCodingTasks++;

        } catch (taskError) {
          logger.error("Error processing individual coding task", {
            participant,
            taskIndex: i,
            taskDescription: taskDescription.substring(0, 100),
            error: taskError.message,
          });

          const failedIssue = {
            success: false,
            error: taskError.message,
            participant,
            description: taskDescription,
          };

          participantResults.failedIssues.push(failedIssue);
          results.failedIssues.push(failedIssue);
          results.totalCodingTasks++;
        }
      }

      results.participants.push(participantResults);
    }

    const duration = (Date.now() - startTime) / 1000;
    
    // Determine overall success
    results.success = results.failedIssues.length === 0;
    results.processingTime = `${duration.toFixed(2)}s`;
    results.summary = {
      totalCodingTasks: results.totalCodingTasks,
      successfulIssues: results.createdIssues.length,
      failedIssues: results.failedIssues.length,
      participantCount: results.participants.length,
    };

    logger.info("Jira issue creation completed", {
      totalCodingTasks: results.totalCodingTasks,
      successfulIssues: results.createdIssues.length,
      failedIssues: results.failedIssues.length,
      participantCount: results.participants.length,
      duration: results.processingTime,
      overallSuccess: results.success,
    });

    return results;

  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    
    logger.error("Jira issue creation process failed", {
      error: error.message,
      stack: error.stack,
      duration: `${duration.toFixed(2)}s`,
    });

    return {
      success: false,
      error: error.message,
      processingTime: `${duration.toFixed(2)}s`,
      totalCodingTasks: 0,
      createdIssues: [],
      failedIssues: [],
      participants: [],
    };
  }
}

/**
 * Generate a concise title for a task using GPT
 * @param {string} taskDescription - The full task description
 * @returns {Promise<string>} Generated title (max 5 words)
 */
async function generateTaskTitle(taskDescription) {
  const { processTranscriptForTasks } = require("./openaiService");
  const OpenAI = require("openai");
  
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const prompt = `Generate a concise title (maximum 5 words) for this coding task:

Task Description: ${taskDescription}

Requirements:
- Maximum 5 words
- Should capture the essence of the task
- Use simple, clear language
- Focus on the main action/outcome
- No special characters or punctuation

Examples:
- "Build user authentication system" → "Build Authentication System"
- "Implement payment processing feature" → "Implement Payment Processing"
- "Fix database connection bug" → "Fix Database Connection"

Title:`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a project management assistant that creates concise, clear titles for coding tasks. Always respond with exactly what is requested - just the title, nothing else."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 50,
    });

    let title = response.choices[0].message.content.trim();
    
    // Clean up the title - remove quotes, extra punctuation
    title = title.replace(/^["']|["']$/g, ""); // Remove quotes
    title = title.replace(/[.!?]*$/, ""); // Remove trailing punctuation
    
    // Ensure it's not longer than 5 words
    const words = title.split(" ");
    if (words.length > 5) {
      title = words.slice(0, 5).join(" ");
    }

    logger.info("Generated task title using GPT", {
      originalDescription: taskDescription.substring(0, 100),
      generatedTitle: title,
      tokensUsed: response.usage.total_tokens,
    });

    return title;

  } catch (error) {
    logger.error("Failed to generate task title with GPT", {
      taskDescription: taskDescription.substring(0, 100),
      error: error.message,
    });

    // Fallback: create a simple title from the description
    const words = taskDescription.split(" ").slice(0, 5);
    const fallbackTitle = words.join(" ").replace(/[^\w\s]/g, "");
    
    logger.info("Using fallback title generation", {
      originalDescription: taskDescription.substring(0, 100),
      fallbackTitle,
    });

    return fallbackTitle;
  }
}

module.exports = {
  testJiraConnection,
  getProjectInfo,
  createJiraIssue,
  createJiraIssuesForCodingTasks,
  generateTaskTitle,
};
