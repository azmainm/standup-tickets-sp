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
const { getJiraAssigneeForParticipant } = require("../../config/participantMapping");

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

    // Validate JIRA_URL format
    const trimmedUrl = JIRA_URL.trim();
    if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
      logger.error("Invalid JIRA_URL format - must start with http:// or https://", {
        providedUrl: JIRA_URL,
        trimmedUrl: trimmedUrl,
        suggestion: `https://${trimmedUrl}`,
      });
      return false;
    }

    // Create authentication header
    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
    
    // Test API connection by getting user info
    const response = await axios.get(`${trimmedUrl}/rest/api/2/myself`, {
      headers: {
        "Authorization": `Basic ${auth}`,
        "Accept": "application/json",
      },
      timeout: 10000,
    });
    
    logger.info("Jira connection test successful", {
      user: response.data.displayName,
      accountType: response.data.accountType,
      jiraUrl: trimmedUrl,
    });
    
    return true;
    
  } catch (error) {
    logger.error("Jira connection test failed", {
      error: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
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
    const trimmedJiraUrl = JIRA_URL.trim();
    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
    
    const response = await axios.get(`${trimmedJiraUrl}/rest/api/2/project/${projectKey}`, {
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
 * Check if a ticketId is a Jira issue key (TDS-XXX format)
 * Note: SP-XXX are MongoDB ticket IDs, not Jira issue keys
 * @param {string} ticketId - The ticket ID to check (e.g., "TDS-123")
 * @returns {boolean} True if the ticketId is a Jira issue key
 */
function isJiraTicket(ticketId) {
  if (!ticketId) return false;
  
  // Only TDS-XXX format are direct Jira issue keys
  const normalizedTicketId = ticketId.toString().toUpperCase();
  return normalizedTicketId.startsWith("TDS-");
}

/**
 * Check if a ticketId is a MongoDB ticket ID (SP-XXX format)
 * @param {string} ticketId - The ticket ID to check (e.g., "SP-456")
 * @returns {boolean} True if the ticketId is a MongoDB ticket ID
 */
function isMongoTicket(ticketId) {
  if (!ticketId) return false;
  
  const normalizedTicketId = ticketId.toString().toUpperCase();
  return normalizedTicketId.startsWith("SP-");
}

/**
 * Update Jira issue description
 * @param {string} issueKey - The issue key (e.g., "TDS-123")
 * @param {string} description - The new description (complete replacement)
 * @returns {Promise<boolean>} True if update successful
 */
async function updateJiraIssueDescription(issueKey, description) {
  try {
    const { JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
    
    if (!JIRA_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
      logger.error("Missing required Jira environment variables for description update");
      return false;
    }

    const trimmedJiraUrl = JIRA_URL.trim();
    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
    
    // Update the issue description
    await axios.put(
      `${trimmedJiraUrl}/rest/api/2/issue/${issueKey}`,
      {
        fields: {
          description: description || "",
        },
      },
      {
        headers: {
          "Authorization": `Basic ${auth}`,
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );
    
    logger.info("Jira issue description updated successfully", {
      issueKey,
      descriptionLength: description ? description.length : 0,
    });
    
    return true;
    
  } catch (error) {
    logger.error("Failed to update Jira issue description", {
      issueKey,
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
    });
    return false;
  }
}

/**
 * Transition a Jira issue to move it from backlog to board
 * This function attempts to move the issue to the board's active "To Do" column
 * Enhanced to support "in-progress" and "done" statuses
 * @param {string} issueKey - The issue key (e.g., "PROJ-123")
 * @param {string} targetStatusName - The target status name (default: "To Do")
 * @returns {Promise<boolean>} True if transition successful
 */
async function transitionIssueToStatus(issueKey, targetStatusName = "To Do") {
  try {
    const { JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
    const trimmedJiraUrl = JIRA_URL.trim();
    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
    
    // Get current issue status
    const issueResponse = await axios.get(
      `${trimmedJiraUrl}/rest/api/2/issue/${issueKey}?fields=status`,
      {
        headers: {
          "Authorization": `Basic ${auth}`,
          "Accept": "application/json",
        },
        timeout: 10000,
      }
    );
    
    const currentStatus = issueResponse.data.fields.status.name;
    
    // Get available transitions for the issue
    const transitionsResponse = await axios.get(
      `${trimmedJiraUrl}/rest/api/2/issue/${issueKey}/transitions`,
      {
        headers: {
          "Authorization": `Basic ${auth}`,
          "Accept": "application/json",
        },
        timeout: 10000,
      }
    );
    
    const availableTransitions = transitionsResponse.data.transitions || [];
    
    // Priority order for transitions to move to board:
    // 1. Look for transitions that explicitly go to "To Do" status
    // 2. Look for "Start Progress" or "Move to Board" type transitions
    // 3. Look for any transition that moves to the target status
    
    let targetTransition = null;
    
    // First, try to find exact match to target status
    targetTransition = availableTransitions.find(transition => {
      const transitionToStatus = transition.to?.name?.toLowerCase();
      return transitionToStatus === targetStatusName.toLowerCase();
    });
    
    // If not found, look for common board transition names
    if (!targetTransition) {
      const commonBoardTransitions = ["start progress", "move to board", "begin work", "move to sprint"];
      targetTransition = availableTransitions.find(transition => {
        const transitionName = transition.name?.toLowerCase();
        return commonBoardTransitions.some(commonName => transitionName.includes(commonName));
      });
    }
    
    // If target is "in-progress", look for specific in-progress transitions
    if (!targetTransition && targetStatusName.toLowerCase() === "in-progress") {
      const inProgressTransitions = ["start progress", "in progress", "begin work", "work in progress"];
      targetTransition = availableTransitions.find(transition => {
        const transitionName = transition.name?.toLowerCase();
        const toStatus = transition.to?.name?.toLowerCase();
        return inProgressTransitions.some(progressName => 
          transitionName.includes(progressName) || toStatus.includes("progress")
        );
      });
    }
    
    // If target is "done", look for specific done/complete transitions
    if (!targetTransition && targetStatusName.toLowerCase() === "done") {
      const doneTransitions = ["done", "complete", "close", "resolve"];
      targetTransition = availableTransitions.find(transition => {
        const transitionName = transition.name?.toLowerCase();
        const toStatus = transition.to?.name?.toLowerCase();
        return doneTransitions.some(doneName => 
          transitionName.includes(doneName) || toStatus.includes(doneName)
        );
      });
    }
    
    // If still not found, try to find any transition that's not "Backlog" or "Closed"
    if (!targetTransition) {
      targetTransition = availableTransitions.find(transition => {
        const toStatus = transition.to?.name?.toLowerCase();
        return toStatus !== "backlog" && toStatus !== "closed" && toStatus !== "done";
      });
    }
    
    if (!targetTransition) {
      logger.warn("Could not find suitable transition to move issue to board", {
        issueKey,
        currentStatus,
        targetStatusName,
        availableTransitions: availableTransitions.map(t => ({
          id: t.id,
          name: t.name,
          toStatus: t.to?.name,
        })),
      });
      return false;
    }
    
    // Execute the transition
    await axios.post(
      `${trimmedJiraUrl}/rest/api/2/issue/${issueKey}/transitions`,
      {
        transition: {
          id: targetTransition.id,
        },
      },
      {
        headers: {
          "Authorization": `Basic ${auth}`,
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );
    
    logger.info("Issue transitioned successfully", {
      issueKey,
      currentStatus,
      transitionName: targetTransition.name,
      transitionToStatus: targetTransition.to?.name,
      transitionId: targetTransition.id,
    });
    
    return true;
    
  } catch (error) {
    logger.error("Failed to transition issue", {
      issueKey,
      targetStatusName,
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
    });
    return false;
  }
}

/**
 * Create a Jira issue for a task (Coding or Non-Coding) or bug
 * @param {Object} taskData - Task data containing title, description, assignee, type, and labels
 * @param {string} taskData.title - Issue title (summary)
 * @param {string} taskData.description - Issue description
 * @param {string} taskData.assignee - Assignee name/email (null/undefined for future tasks)
 * @param {string} taskData.participant - Original participant name from transcript
 * @param {string} taskData.type - Task type: "Coding" or "Non-Coding"
 * @param {string} taskData.workType - Work type: "Task" or "Bug" (defaults to "Task")
 * @param {boolean} taskData.isFuturePlan - Whether this is a future plan task (no assignee)
 * @param {Array<string>} taskData.labels - Optional labels to add to the issue
 * @param {string} taskData.priority - Priority value (Highest/High/Medium/Low/Lowest), defaults to Medium if not provided
 * @param {number} taskData.estimatedTime - Estimated time in hours, will be converted to seconds for Jira
 * @param {number} taskData.storyPoints - Optional story points value, only added if provided and > 0
 * @returns {Promise<Object>} Jira issue creation result
 */
async function createJiraIssue(taskData) {
  try {
    const { JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY } = process.env;
    
    if (!JIRA_URL || !JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_PROJECT_KEY) {
      throw new Error("Missing required Jira environment variables");
    }

    // Trim whitespace from JIRA_URL to prevent "Invalid URL" errors
    const trimmedJiraUrl = JIRA_URL.trim();
    
    if (!trimmedJiraUrl.startsWith("http://") && !trimmedJiraUrl.startsWith("https://")) {
      throw new Error(`Invalid JIRA_URL format: "${JIRA_URL}". Must start with http:// or https://`);
    }

    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
    
    // Build labels array
    const labels = [];
    if (taskData.type === "Coding") {
      labels.push("coding");
    } else if (taskData.type === "Non-Coding") {
      labels.push("non-coding");
    }
    if (taskData.isFuturePlan) {
      labels.push("future-plan");
    }
    // Add bug label if this is a bug
    if (taskData.workType === "Bug") {
      labels.push("bug");
    }
    // Add any additional labels from taskData
    if (taskData.labels && Array.isArray(taskData.labels)) {
      labels.push(...taskData.labels);
    }
    
    // Determine work type (Task or Bug)
    const workType = taskData.workType === "Bug" ? "Bug" : "Task";
    
    // Prepare the issue data
    const issueData = {
      fields: {
        project: {
          key: JIRA_PROJECT_KEY,
        },
        summary: taskData.title,
        description: taskData.description,
        issuetype: {
          name: workType, // Task or Bug based on workType
        },
      },
    };
    
    // Add labels if any
    if (labels.length > 0) {
      issueData.fields.labels = labels;
    }

    // Add priority field with fallback to Medium
    const validPriorities = ["Highest", "High", "Medium", "Low", "Lowest"];
    let priority = taskData.priority || null;
    
    // Validate and normalize priority
    if (priority) {
      // Normalize: trim whitespace, handle case variations
      priority = String(priority).trim();
      const lowerPriority = priority.toLowerCase();
      
      // Map common variations to standard values
      if (lowerPriority === "highest" || lowerPriority === "highest priority") {
        priority = "Highest";
      } else if (lowerPriority === "high" || lowerPriority === "high priority") {
        priority = "High";
      } else if (lowerPriority === "medium" || lowerPriority === "medium priority" || lowerPriority === "normal" || lowerPriority === "standard") {
        priority = "Medium";
      } else if (lowerPriority === "low" || lowerPriority === "low priority") {
        priority = "Low";
      } else if (lowerPriority === "lowest" || lowerPriority === "lowest priority" || lowerPriority === "minimal") {
        priority = "Lowest";
      } else {
        // Try exact match with case normalization
        priority = priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase();
      }
      
      // Final validation
      if (!validPriorities.includes(priority)) {
        logger.warn("Invalid priority value, defaulting to Medium", {
          providedPriority: taskData.priority,
          normalizedPriority: priority,
        });
        priority = "Medium";
      }
    } else {
      // Default to Medium if not provided
      priority = "Medium";
    }
    
    // Set priority in issue data
    issueData.fields.priority = {
      name: priority,
    };

    // Add estimated time (timetracking) if provided
    // Jira expects time in format like "1h" or "3600s"
    const estimatedTimeHours = taskData.estimatedTime || 0;
    if (estimatedTimeHours > 0) {
      // Format as "Xh" (hours) or "Xs" (seconds) - Jira prefers hours format
      const timeString = estimatedTimeHours >= 1 
        ? `${Math.round(estimatedTimeHours)}h` 
        : `${Math.round(estimatedTimeHours * 60)}m`;
      
      issueData.fields.timetracking = {
        originalEstimate: timeString
      };
      
      logger.info("Added estimated time to Jira issue", {
        estimatedTimeHours: estimatedTimeHours,
        timeString: timeString,
        participant: taskData.participant,
        title: taskData.title,
      });
    } else {
      logger.info("No estimated time provided for Jira issue", {
        participant: taskData.participant,
        title: taskData.title,
        estimatedTimeHours: estimatedTimeHours,
      });
    }

    // Add story points to custom field 10166 if provided
    const storyPoints = taskData.storyPoints;
    if (storyPoints !== undefined && storyPoints !== null && storyPoints > 0) {
      issueData.fields.customfield_10166 = storyPoints;
      
      logger.info("Added story points to Jira issue", {
        storyPoints: storyPoints,
        participant: taskData.participant,
        title: taskData.title,
      });
    }

    // Try to assign the issue using the participant mapping
    // Skip assignee for future plans
    // taskData.assignee now contains the Jira accountId directly from mapping
    // No need to search via API - use it directly
    if (taskData.assignee && !taskData.isFuturePlan) {
      issueData.fields.assignee = {
        accountId: taskData.assignee,
      };
      
      logger.info("Assigned Jira issue using accountId from mapping", {
        participantName: taskData.participant,
        jiraAccountId: taskData.assignee,
      });
    }

    // Create the issue
    const response = await axios.post(`${trimmedJiraUrl}/rest/api/2/issue`, issueData, {
      headers: {
        "Authorization": `Basic ${auth}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    const createdIssue = response.data;
    
    // Transition non-future tasks to board's "To Do" column
    // Future tasks stay in backlog's "To Do" (default location)
    let transitioned = false;
    if (!taskData.isFuturePlan) {
      try {
        transitioned = await transitionIssueToStatus(createdIssue.key, "To Do");
        if (transitioned) {
          logger.info("Issue transitioned to board's To Do", {
            issueKey: createdIssue.key,
          });
        }
      } catch (transitionError) {
        // Log but don't fail the issue creation if transition fails
        logger.warn("Failed to transition issue to board To Do (non-critical)", {
          issueKey: createdIssue.key,
          error: transitionError.message,
        });
      }
    }
    
    logger.info("Jira issue created successfully", {
      issueKey: createdIssue.key,
      issueId: createdIssue.id,
      workType: workType,
      title: taskData.title,
      participant: taskData.participant,
      assignee: taskData.assignee || "Unassigned",
      type: taskData.type,
      isFuturePlan: taskData.isFuturePlan,
      priority: priority,
      estimatedTimeHours: estimatedTimeHours,
      estimatedTimeSeconds: estimatedTimeHours > 0 ? Math.round(estimatedTimeHours * 3600) : 0,
      storyPoints: storyPoints || null,
      labels: labels,
      transitionedToBoard: transitioned,
    });

    return {
      success: true,
      issueKey: createdIssue.key,
      issueId: createdIssue.id,
      issueUrl: `${trimmedJiraUrl}/browse/${createdIssue.key}`,
      title: taskData.title,
      participant: taskData.participant,
      assignee: taskData.assignee,
      type: taskData.type,
      isFuturePlan: taskData.isFuturePlan,
      priority: priority,
      estimatedTimeHours: estimatedTimeHours,
      storyPoints: storyPoints || null,
      labels: labels,
      transitionedToBoard: transitioned,
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
 * Create multiple Jira issues for tasks (both Coding and Non-Coding) from all participants
 * @param {Object} tasksData - Structured task data organized by participant
 * @returns {Promise<Object>} Results of issue creation for all tasks
 */
async function createJiraIssuesForCodingTasks(tasksData) {
  const startTime = Date.now();
  
  try {
    logger.info("Starting Jira issue creation for tasks", {
      participantCount: Object.keys(tasksData).length,
      timestamp: new Date().toISOString(),
    });

    const results = {
      success: true,
      totalTasks: 0,
      totalCodingTasks: 0,
      totalNonCodingTasks: 0,
      createdIssues: [],
      failedIssues: [],
      participants: [],
    };

    // Process each participant's tasks
    for (const [participant, participantTasks] of Object.entries(tasksData)) {
      const codingTasks = participantTasks.Coding || [];
      const nonCodingTasks = participantTasks["Non-Coding"] || [];
      const totalTasksForParticipant = codingTasks.length + nonCodingTasks.length;
      
      if (totalTasksForParticipant === 0) {
        logger.info("No tasks found for participant", { participant });
        continue;
      }

      logger.info("Processing tasks for participant", {
        participant,
        codingTaskCount: codingTasks.length,
        nonCodingTaskCount: nonCodingTasks.length,
      });

      const participantResults = {
        participant,
        codingTaskCount: codingTasks.length,
        nonCodingTaskCount: nonCodingTasks.length,
        createdIssues: [],
        failedIssues: [],
      };

      // Process Coding tasks
      for (let i = 0; i < codingTasks.length; i++) {
        const task = codingTasks[i];
        const taskDescription = typeof task === "string" ? task : task.description;
        const isFuturePlan = typeof task === "object" ? Boolean(task.isFuturePlan) : false;
        const priority = typeof task === "object" ? (task.priority || null) : null;
        const estimatedTime = typeof task === "object" ? (task.estimatedTime || 0) : 0;
        const storyPoints = typeof task === "object" ? (task.storyPoints || null) : null;
        const workType = typeof task === "object" ? (task.workType || "Task") : "Task";
        
        logger.info("Extracting task data for Jira issue creation (Coding)", {
          participant,
          taskIndex: i,
          workType: workType,
          priority: priority,
          estimatedTimeHours: estimatedTime,
          storyPoints: storyPoints,
          hasTitle: typeof task === "object" && !!task.title,
          taskKeys: typeof task === "object" ? Object.keys(task) : "string task",
        });

        try {
          // Use existing title if available (from pipeline), otherwise generate fallback
          const taskTitle = task.title || taskDescription.substring(0, 50).replace(/[^\w\s]/g, "").trim() || "Untitled Task";
          
          // Get the appropriate Jira assignee for this participant (null for future plans)
          const jiraAssignee = isFuturePlan ? null : getJiraAssigneeForParticipant(participant);
          
          // Create the Jira issue
          const issueResult = await createJiraIssue({
            title: taskTitle,
            description: taskDescription,
            participant: participant,
            assignee: jiraAssignee,
            type: "Coding",
            workType: workType,
            isFuturePlan: isFuturePlan,
            priority: priority,
            estimatedTime: estimatedTime,
            storyPoints: storyPoints,
          });

          if (issueResult.success) {
            participantResults.createdIssues.push(issueResult);
            results.createdIssues.push(issueResult);
          } else {
            participantResults.failedIssues.push(issueResult);
            results.failedIssues.push(issueResult);
          }

          results.totalTasks++;
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
            type: "Coding",
            description: taskDescription,
          };

          participantResults.failedIssues.push(failedIssue);
          results.failedIssues.push(failedIssue);
          results.totalTasks++;
          results.totalCodingTasks++;
        }
      }

      // Process Non-Coding tasks
      for (let i = 0; i < nonCodingTasks.length; i++) {
        const task = nonCodingTasks[i];
        const taskDescription = typeof task === "string" ? task : task.description;
        const isFuturePlan = typeof task === "object" ? Boolean(task.isFuturePlan) : false;
        const priority = typeof task === "object" ? (task.priority || null) : null;
        const estimatedTime = typeof task === "object" ? (task.estimatedTime || 0) : 0;
        const storyPoints = typeof task === "object" ? (task.storyPoints || null) : null;
        const workType = typeof task === "object" ? (task.workType || "Task") : "Task";
        
        logger.info("Extracting task data for Jira issue creation (Non-Coding)", {
          participant,
          taskIndex: i,
          workType: workType,
          priority: priority,
          estimatedTimeHours: estimatedTime,
          storyPoints: storyPoints,
          hasTitle: typeof task === "object" && !!task.title,
          taskKeys: typeof task === "object" ? Object.keys(task) : "string task",
        });
        
        try {
          // Use existing title if available (from pipeline), otherwise generate fallback
          const taskTitle = task.title || taskDescription.substring(0, 50).replace(/[^\w\s]/g, "").trim() || "Untitled Task";
          
          // Get the appropriate Jira assignee for this participant (null for future plans)
          const jiraAssignee = isFuturePlan ? null : getJiraAssigneeForParticipant(participant);
          
          // Create the Jira issue
          const issueResult = await createJiraIssue({
            title: taskTitle,
            description: taskDescription,
            participant: participant,
            assignee: jiraAssignee,
            type: "Non-Coding",
            workType: workType,
            isFuturePlan: isFuturePlan,
            priority: priority,
            estimatedTime: estimatedTime,
            storyPoints: storyPoints,
          });

          if (issueResult.success) {
            participantResults.createdIssues.push(issueResult);
            results.createdIssues.push(issueResult);
          } else {
            participantResults.failedIssues.push(issueResult);
            results.failedIssues.push(issueResult);
          }

          results.totalTasks++;
          results.totalNonCodingTasks++;

        } catch (taskError) {
          logger.error("Error processing individual non-coding task", {
            participant,
            taskIndex: i,
            taskDescription: taskDescription.substring(0, 100),
            error: taskError.message,
          });

          const failedIssue = {
            success: false,
            error: taskError.message,
            participant,
            type: "Non-Coding",
            description: taskDescription,
          };

          participantResults.failedIssues.push(failedIssue);
          results.failedIssues.push(failedIssue);
          results.totalTasks++;
          results.totalNonCodingTasks++;
        }
      }

      results.participants.push(participantResults);
    }

    const duration = (Date.now() - startTime) / 1000;
    
    // Determine overall success
    results.success = results.failedIssues.length === 0;
    results.processingTime = `${duration.toFixed(2)}s`;
    results.summary = {
      totalTasks: results.totalTasks,
      totalCodingTasks: results.totalCodingTasks,
      totalNonCodingTasks: results.totalNonCodingTasks,
      successfulIssues: results.createdIssues.length,
      failedIssues: results.failedIssues.length,
      participantCount: results.participants.length,
    };

    logger.info("Jira issue creation completed", {
      totalTasks: results.totalTasks,
      totalCodingTasks: results.totalCodingTasks,
      totalNonCodingTasks: results.totalNonCodingTasks,
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
      totalTasks: 0,
      totalCodingTasks: 0,
      totalNonCodingTasks: 0,
      createdIssues: [],
      failedIssues: [],
      participants: [],
    };
  }
}

/**
 * Update a Jira issue (both status and description)
 * @param {string} issueKey - The issue key (e.g., "TDS-123")
 * @param {Object} updateData - Update data containing status and/or description
 * @param {string} updateData.status - New status (optional, will be mapped: "In-progress" → "in-progress", "Completed" → "done")
 * @param {string} updateData.description - New description (optional, complete replacement)
 * @returns {Promise<Object>} Update result with success status for each operation
 */
async function updateJiraIssue(issueKey, updateData) {
  const result = {
    success: true,
    issueKey,
    statusUpdated: false,
    descriptionUpdated: false,
    errors: [],
  };
  
  try {
    // Map MongoDB status to Jira status
    const statusMapping = {
      "In-progress": "in-progress",
      "Completed": "done",
    };
    
    // Update status if provided
    if (updateData.status !== undefined) {
      const jiraStatus = statusMapping[updateData.status] || updateData.status;
      const statusSuccess = await transitionIssueToStatus(issueKey, jiraStatus);
      result.statusUpdated = statusSuccess;
      
      if (!statusSuccess) {
        result.success = false;
        result.errors.push(`Failed to update status to ${jiraStatus}`);
      }
    }
    
    // Update description if provided
    if (updateData.description !== undefined) {
      const descriptionSuccess = await updateJiraIssueDescription(issueKey, updateData.description);
      result.descriptionUpdated = descriptionSuccess;
      
      if (!descriptionSuccess) {
        result.success = false;
        result.errors.push("Failed to update description");
      }
    }
    
    logger.info("Jira issue update completed", {
      issueKey,
      statusUpdated: result.statusUpdated,
      descriptionUpdated: result.descriptionUpdated,
      success: result.success,
    });
    
    return result;
    
  } catch (error) {
    logger.error("Failed to update Jira issue", {
      issueKey,
      updateData,
      error: error.message,
      stack: error.stack,
    });
    
    result.success = false;
    result.errors.push(error.message);
    return result;
  }
}

/**
 * Search Jira issues by title/summary to find tickets containing a specific ticket ID
 * @param {string} ticketId - The ticket ID to search for (e.g., "SP-456")
 * @returns {Promise<Object|null>} Jira issue if found, null otherwise
 */
async function findJiraIssueByTitle(ticketId) {
  try {
    const { JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY } = process.env;
    
    if (!JIRA_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
      logger.error("Missing Jira credentials for title search");
      return null;
    }
    
    const trimmedJiraUrl = JIRA_URL.trim();
    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
    
    // Search for issues with the ticket ID in the summary/title
    // Using JQL to search within the project
    const projectKey = JIRA_PROJECT_KEY || "TDS";
    const jql = `project = ${projectKey} AND summary ~ "${ticketId}"`;
    
    const response = await axios.get(`${trimmedJiraUrl}/rest/api/2/search`, {
      headers: {
        "Authorization": `Basic ${auth}`,
        "Accept": "application/json",
      },
      params: {
        jql: jql,
        maxResults: 1,
        fields: "summary,status,description,key"
      },
      timeout: 10000,
    });
    
    if (response.data.issues && response.data.issues.length > 0) {
      const issue = response.data.issues[0];
      logger.info("Found Jira issue by title search", {
        searchTicketId: ticketId,
        foundIssueKey: issue.key,
        issueSummary: issue.fields.summary
      });
      return {
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        description: issue.fields.description
      };
    }
    
    logger.info("No Jira issue found with ticket ID in title", {
      ticketId: ticketId,
      jql: jql
    });
    return null;
    
  } catch (error) {
    logger.error("Error searching Jira by title", {
      ticketId: ticketId,
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText
    });
    return null;
  }
}

module.exports = {
  testJiraConnection,
  getProjectInfo,
  transitionIssueToStatus,
  createJiraIssue,
  createJiraIssuesForCodingTasks,
  isJiraTicket,
  isMongoTicket,
  findJiraIssueByTitle,
  updateJiraIssueDescription,
  updateJiraIssue,
};
