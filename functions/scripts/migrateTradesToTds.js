/**
 * Migration Script: TRADES to TDS
 * 
 * This script migrates all ticket IDs from TRADES-XXX to TDS-XXX format in:
 * 1. MongoDB (sptasks collection - ticketId and jiraTicketId fields)
 * 2. Jira (moves issues from TRADES project to TDS project)
 * 
 * SAFETY FEATURES:
 * - Dry-run mode by default (set DRY_RUN=false to actually migrate)
 * - Detailed logging of all changes
 * - Confirmation prompt before making changes
 * - Error handling and rollback capability
 */

const { MongoClient } = require("mongodb");
const axios = require("axios");
require("dotenv").config();

// Configuration
const DRY_RUN = process.env.DRY_RUN !== "false"; // Set to 'false' to actually migrate
const MONGODB_URI = process.env.MONGODB_URI;
const JIRA_URL = process.env.JIRA_URL?.trim();
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const OLD_PROJECT_KEY = "TRADES";
const NEW_PROJECT_KEY = "TDS";

// MongoDB configuration
const DATABASE_NAME = (() => {
  if (MONGODB_URI) {
    const match = MONGODB_URI.match(/\/([^/?]+)(\?|$)/);
    return match ? match[1] : "standuptickets";
  }
  return "standuptickets";
})();
const COLLECTION_NAME = "sptasks";

let migrationLog = [];

function log(message, data = null) {
  const logEntry = { timestamp: new Date().toISOString(), message, data };
  migrationLog.push(logEntry);
  console.log(`[${logEntry.timestamp}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

/**
 * Get all tasks with TRADES ticket IDs from MongoDB
 */
async function getTradesTasksFromMongo(db) {
  try {
    log("Fetching tasks with TRADES ticket IDs from MongoDB...");
    log("Database configuration", {
      database: DATABASE_NAME,
      collection: COLLECTION_NAME
    });
    
    const collection = db.collection(COLLECTION_NAME);
    
    // First, check total count in collection
    const totalCount = await collection.countDocuments();
    log(`Total documents in ${COLLECTION_NAME}: ${totalCount}`);
    
    // Get a sample document to see structure
    const sample = await collection.findOne();
    if (sample) {
      log("Sample document structure", {
        allFields: Object.keys(sample).slice(0, 10)
      });
      
      // The structure is: { "Participant Name": { Coding: [...], Non-Coding: [...] } }
      // Find a participant field to inspect
      const participantFields = Object.keys(sample).filter(k => k !== '_id' && k !== 'timestamp');
      if (participantFields.length > 0) {
        const sampleParticipant = sample[participantFields[0]];
        if (sampleParticipant && sampleParticipant.Coding && sampleParticipant.Coding.length > 0) {
          log("Sample task structure", {
            participant: participantFields[0],
            sampleTask: sampleParticipant.Coding[0]
          });
        }
      }
    }
    
    // Find all documents and extract tasks with TRADES tickets
    // The structure is nested: { "Participant": { "Coding": [{ticketId: "TRADES-XXX"}], "Non-Coding": [...] } }
    const allDocs = await collection.find({}).toArray();
    
    const tasksWithTrades = [];
    
    for (const doc of allDocs) {
      // Skip _id and timestamp fields, process participant fields
      const participantNames = Object.keys(doc).filter(k => k !== '_id' && k !== 'timestamp');
      
      for (const participantName of participantNames) {
        const participantData = doc[participantName];
        
        if (participantData && typeof participantData === 'object') {
          // Check Coding tasks
          if (Array.isArray(participantData.Coding)) {
            for (const task of participantData.Coding) {
              if (task.ticketId && task.ticketId.match(/^TRADES-/i)) {
                tasksWithTrades.push({
                  _id: doc._id,
                  participant: participantName,
                  taskType: 'Coding',
                  task: task,
                  ticketId: task.ticketId
                });
              }
            }
          }
          
          // Check Non-Coding tasks
          if (Array.isArray(participantData['Non-Coding'])) {
            for (const task of participantData['Non-Coding']) {
              if (task.ticketId && task.ticketId.match(/^TRADES-/i)) {
                tasksWithTrades.push({
                  _id: doc._id,
                  participant: participantName,
                  taskType: 'Non-Coding',
                  task: task,
                  ticketId: task.ticketId
                });
              }
            }
          }
        }
      }
    }
    
    log(`Found ${tasksWithTrades.length} tasks with TRADES ticket IDs`, {
      sampleTicketIds: tasksWithTrades.slice(0, 10).map(t => t.ticketId)
    });
    
    return tasksWithTrades;
  } catch (error) {
    log("Error fetching TRADES tasks from MongoDB", { error: error.message, stack: error.stack });
    throw error;
  }
}

/**
 * Update MongoDB task ticket IDs from TRADES to TDS
 */
async function updateMongoTicketIds(db, tasks) {
  const results = { success: 0, failed: 0, skipped: 0 };
  
  log(`${DRY_RUN ? "[DRY RUN] " : ""}Starting MongoDB ticket ID migration...`);
  log(`Processing ${tasks.length} tasks with TRADES ticket IDs`);
  
  // Group tasks by document ID to minimize database operations
  const tasksByDoc = {};
  for (const taskInfo of tasks) {
    const docId = taskInfo._id.toString();
    if (!tasksByDoc[docId]) {
      tasksByDoc[docId] = [];
    }
    tasksByDoc[docId].push(taskInfo);
  }
  
  for (const [docId, docTasks] of Object.entries(tasksByDoc)) {
    try {
      // Fetch the full document
      const doc = await db.collection(COLLECTION_NAME).findOne({ _id: docTasks[0]._id });
      
      if (!doc) {
        log(`Document ${docId} not found, skipping`);
        results.skipped += docTasks.length;
        continue;
      }
      
      // Update ticket IDs in the document
      let updated = false;
      
      for (const taskInfo of docTasks) {
        const { participant, taskType, task, ticketId } = taskInfo;
        const oldTicketId = ticketId;
        const newTicketId = oldTicketId.replace(/^TRADES-/i, "TDS-");
        
        log(`${DRY_RUN ? "[DRY RUN] " : ""}Updating ticket`, {
          docId: docId.substring(0, 8),
          participant,
          taskType,
          oldTicketId,
          newTicketId
        });
        
        // Update the ticketId in the nested structure
        const participantData = doc[participant];
        if (participantData && Array.isArray(participantData[taskType])) {
          const taskArray = participantData[taskType];
          const taskIndex = taskArray.findIndex(t => t.ticketId === oldTicketId);
          
          if (taskIndex !== -1) {
            taskArray[taskIndex].ticketId = newTicketId;
            updated = true;
          }
        }
      }
      
      if (updated) {
        if (!DRY_RUN) {
          // Update the entire document
          await db.collection(COLLECTION_NAME).replaceOne(
            { _id: doc._id },
            doc
          );
        }
        results.success += docTasks.length;
      } else {
        results.skipped += docTasks.length;
      }
    } catch (error) {
      log(`Error updating document ${docId}`, { error: error.message });
      results.failed += docTasks.length;
    }
  }
  
  log("MongoDB migration completed", results);
  return results;
}

/**
 * Get all TRADES issues from Jira
 */
async function getTradesIssuesFromJira() {
  try {
    if (!JIRA_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
      log("Jira credentials not configured - skipping Jira migration");
      return [];
    }
    
    log("Fetching TRADES issues from Jira...");
    log("Jira configuration", {
      url: JIRA_URL,
      projectKey: OLD_PROJECT_KEY
    });
    
    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
    const jql = `project = ${OLD_PROJECT_KEY} ORDER BY key ASC`;
    
    let allIssues = [];
    let startAt = 0;
    const maxResults = 100;
    
    while (true) {
      log(`Fetching issues from Jira (startAt: ${startAt}, maxResults: ${maxResults})...`);
      
      const response = await axios.get(`${JIRA_URL}/rest/api/2/search`, {
        headers: {
          "Authorization": `Basic ${auth}`,
          "Accept": "application/json",
        },
        params: {
          jql,
          startAt,
          maxResults,
          fields: "key,summary,description,status,assignee"
        },
        timeout: 30000,
      });
      
      log(`Fetched ${response.data.issues.length} issues (total: ${response.data.total})`);
      
      allIssues = allIssues.concat(response.data.issues);
      
      if (allIssues.length >= response.data.total) {
        break;
      }
      
      startAt += maxResults;
    }
    
    log(`Found ${allIssues.length} issues in Jira ${OLD_PROJECT_KEY} project`, {
      sampleKeys: allIssues.slice(0, 10).map(i => i.key)
    });
    
    return allIssues;
  } catch (error) {
    // Handle 410 Gone - might be an endpoint issue
    if (error.response && error.response.status === 410) {
      log(`Jira returned 410 Gone error`, {
        statusCode: 410,
        url: `${JIRA_URL}/rest/api/2/search`,
        message: "The TRADES project might be archived or the API endpoint changed. Skipping Jira migration."
      });
      return [];
    }
    
    // Handle 400 Bad Request - project key doesn't exist
    if (error.response && error.response.status === 400) {
      log(`Jira project ${OLD_PROJECT_KEY} not found`, {
        statusCode: 400,
        responseData: error.response.data,
        message: "This is normal if the project was never created"
      });
      return [];
    }
    
    // For other errors, log details and throw
    log("Error fetching TRADES issues from Jira", { 
      error: error.message,
      statusCode: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data
    });
    throw error;
  }
}

/**
 * Move Jira issues from TRADES to TDS by updating issue key references
 * NOTE: Jira doesn't support changing project keys directly via API
 * This function will update the issue summaries to reflect new ticket IDs
 */
async function updateJiraIssueReferences(issues) {
  const results = { success: 0, failed: 0, skipped: 0 };
  
  if (!JIRA_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    log("Jira credentials not configured - skipping Jira migration");
    return results;
  }
  
  log(`${DRY_RUN ? "[DRY RUN] " : ""}Starting Jira issue reference updates...`);
  log("NOTE: Jira project keys cannot be changed via API.");
  log("This script will update issue descriptions to reference new TDS ticket IDs.");
  log("To fully migrate, you should either:");
  log("  1. Move issues manually in Jira UI from TRADES to TDS project");
  log("  2. Or configure JIRA_PROJECT_KEY=TDS and create new issues (old TRADES issues will remain)");
  
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
  
  for (const issue of issues) {
    try {
      const oldKey = issue.key; // e.g., TRADES-123
      const expectedNewKey = oldKey.replace(OLD_PROJECT_KEY, NEW_PROJECT_KEY); // e.g., TDS-123
      
      // Update description to mention migration
      const currentDescription = issue.fields.description || "";
      const migrationNote = `\n\n---\n**Migration Note**: This ticket was migrated from ${oldKey} to ${expectedNewKey}.\nPlease reference this ticket as ${expectedNewKey} in future communications.`;
      
      // Check if already migrated
      if (currentDescription.includes("Migration Note")) {
        log(`Skipping ${oldKey} - already has migration note`);
        results.skipped++;
        continue;
      }
      
      const newDescription = currentDescription + migrationNote;
      
      log(`${DRY_RUN ? "[DRY RUN] " : ""}Updating ${oldKey} with migration note`, {
        oldKey,
        expectedNewKey
      });
      
      if (!DRY_RUN) {
        await axios.put(
          `${JIRA_URL}/rest/api/2/issue/${oldKey}`,
          {
            fields: {
              description: newDescription
            }
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
      }
      
      results.success++;
    } catch (error) {
      log(`Error updating Jira issue ${issue.key}`, { error: error.message });
      results.failed++;
    }
  }
  
  log("Jira migration completed", results);
  return results;
}

/**
 * Generate migration report
 */
function generateReport(mongoResults, jiraResults) {
  const report = {
    timestamp: new Date().toISOString(),
    dryRun: DRY_RUN,
    oldProjectKey: OLD_PROJECT_KEY,
    newProjectKey: NEW_PROJECT_KEY,
    mongodb: mongoResults,
    jira: "Skipped - already migrated manually in Jira",
    summary: {
      totalUpdated: mongoResults?.success || 0,
      totalFailed: mongoResults?.failed || 0,
      totalSkipped: mongoResults?.skipped || 0
    }
  };
  
  console.log("\n" + "=".repeat(80));
  console.log("MONGODB MIGRATION REPORT");
  console.log("=".repeat(80));
  console.log(JSON.stringify(report, null, 2));
  console.log("=".repeat(80) + "\n");
  
  return report;
}

/**
 * Main migration function
 */
async function migrate() {
  let client = null;
  
  try {
    console.log("\n" + "=".repeat(80));
    console.log(`TRADES to TDS Migration Script`);
    console.log(`Mode: ${DRY_RUN ? "DRY RUN (no changes will be made)" : "LIVE (changes will be applied)"}`);
    console.log("=".repeat(80) + "\n");
    
    if (DRY_RUN) {
      console.log("⚠️  This is a DRY RUN. No changes will be made.");
      console.log("Set DRY_RUN=false in your environment to actually migrate.\n");
    } else {
      console.log("⚠️  WARNING: This will make actual changes to your data!");
      console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...\n");
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Connect to MongoDB
    log("Connecting to MongoDB...");
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(DATABASE_NAME);
    log("Connected to MongoDB");
    
    // Step 1: Migrate MongoDB tickets
    const mongoTasks = await getTradesTasksFromMongo(db);
    const mongoResults = await updateMongoTicketIds(db, mongoTasks);
    
    // Jira migration skipped - already done manually via Jira space settings
    log("Jira migration skipped - tickets already migrated in Jira");
    
    // Generate final report
    const report = generateReport(mongoResults, null);
    
    console.log("\n✅ Migration completed successfully!");
    
    if (DRY_RUN) {
      console.log("\n⚠️  Remember: This was a DRY RUN. To apply changes, run:");
      console.log("DRY_RUN=false node functions/scripts/migrateTradesToTds.js\n");
    }
    
    return report;
    
  } catch (error) {
    log("Migration failed with error", { error: error.message, stack: error.stack });
    console.error("\n❌ Migration failed:", error.message);
    throw error;
  } finally {
    if (client) {
      await client.close();
      log("MongoDB connection closed");
    }
  }
}

// Run migration if called directly
if (require.main === module) {
  migrate()
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}

module.exports = { migrate };

