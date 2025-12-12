/**
 * Create Jira tickets from sprint_plan.txt
 */

const fs = require("fs");
const path = require("path");
const { createJiraIssue } = require("../services/integrations/jiraService");
const { getJiraAssigneeForParticipant } = require("../config/participantMapping");

require("dotenv").config();

/**
 * Parse sprint plan text and extract tasks
 */
function parseSprintPlan(sprintPlanText) {
  const lines = sprintPlanText.split('\n');
  const tasks = [];
  
  let currentAssignee = null;
  let currentTask = null;
  let inWhatToBuild = false;
  let inTechnicalScope = false;
  let inWhichCodebase = false;
  let inAcceptanceCriteria = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // Check for assignee headers
    if (trimmedLine === "Azmain Morshed" || trimmedLine === "Shafkat Kabir" || trimmedLine === "Faiyaz Rahman") {
      currentAssignee = trimmedLine;
      continue;
    }
    
    // Check for task title (Task N: ...)
    const taskMatch = trimmedLine.match(/^Task \d+:\s*(.+)$/);
    if (taskMatch && currentAssignee) {
      // Save previous task if exists
      if (currentTask) {
        tasks.push(currentTask);
      }
      
      // Start new task
      currentTask = {
        assignee: currentAssignee,
        title: taskMatch[1].trim(),
        whatToBuild: "",
        technicalScope: "",
        whichCodebase: "",
        acceptanceCriteria: [],
        points: 0
      };
      inWhatToBuild = false;
      inTechnicalScope = false;
      inWhichCodebase = false;
      inAcceptanceCriteria = false;
      continue;
    }
    
    // Check for "What to build:" (with or without content on same line)
    if (trimmedLine.toLowerCase().startsWith("what to build:")) {
      inWhatToBuild = true;
      inTechnicalScope = false;
      inWhichCodebase = false;
      inAcceptanceCriteria = false;
      
      // Extract content if it's on the same line
      const whatToBuildContent = trimmedLine.substring(trimmedLine.indexOf(":") + 1).trim();
      if (whatToBuildContent && currentTask) {
        currentTask.whatToBuild = whatToBuildContent;
      }
      continue;
    }
    
    // Check for "Technical scope:"
    if (trimmedLine.toLowerCase().startsWith("technical scope:")) {
      inWhatToBuild = false;
      inTechnicalScope = true;
      inWhichCodebase = false;
      inAcceptanceCriteria = false;
      continue;
    }
    
    // Check for "Which codebase:"
    if (trimmedLine.toLowerCase().startsWith("which codebase:")) {
      inWhatToBuild = false;
      inTechnicalScope = false;
      inWhichCodebase = true;
      inAcceptanceCriteria = false;
      
      // Extract content if it's on the same line
      const whichCodebaseContent = trimmedLine.substring(trimmedLine.indexOf(":") + 1).trim();
      if (whichCodebaseContent && currentTask) {
        currentTask.whichCodebase = whichCodebaseContent;
      }
      continue;
    }
    
    // Check for "Acceptance criteria:"
    if (trimmedLine.toLowerCase().startsWith("acceptance criteria:")) {
      inWhatToBuild = false;
      inTechnicalScope = false;
      inWhichCodebase = false;
      inAcceptanceCriteria = true;
      continue;
    }
    
    // Check for Points
    const pointsMatch = trimmedLine.match(/^Points:\s*(\d+)$/);
    if (pointsMatch && currentTask) {
      currentTask.points = parseInt(pointsMatch[1]);
      inWhatToBuild = false;
      inTechnicalScope = false;
      inWhichCodebase = false;
      inAcceptanceCriteria = false;
      continue;
    }
    
    // Collect "What to build" content
    if (inWhatToBuild && currentTask && trimmedLine && !trimmedLine.startsWith("Focus") && !trimmedLine.startsWith("Goal")) {
      currentTask.whatToBuild += (currentTask.whatToBuild ? " " : "") + trimmedLine;
    }
    
    // Collect "Technical scope" content
    if (inTechnicalScope && currentTask && trimmedLine) {
      currentTask.technicalScope += (currentTask.technicalScope ? " " : "") + trimmedLine;
    }
    
    // Collect acceptance criteria
    if (inAcceptanceCriteria && currentTask && trimmedLine) {
      currentTask.acceptanceCriteria.push(trimmedLine);
    }
  }
  
  // Add last task
  if (currentTask) {
    tasks.push(currentTask);
  }
  
  return tasks;
}

/**
 * Build Jira description from task data
 */
function buildDescription(task) {
  let description = "";
  
  if (task.whatToBuild) {
    description += "*What to Build:*\n" + task.whatToBuild + "\n\n";
  }
  
  if (task.technicalScope) {
    description += "*Technical Scope:*\n" + task.technicalScope + "\n\n";
  }
  
  if (task.whichCodebase) {
    description += "*Which Codebase:*\n" + task.whichCodebase + "\n\n";
  }
  
  if (task.acceptanceCriteria.length > 0) {
    description += "*Acceptance Criteria:*\n";
    task.acceptanceCriteria.forEach(criterion => {
      description += "• " + criterion + "\n";
    });
  }
  
  return description;
}

/**
 * Main function to create Jira tickets
 */
async function createSprintTickets() {
  console.log("========================================");
  console.log("🎫 CREATING SPRINT TICKETS");
  console.log("========================================\n");
  
  const startTime = Date.now();
  
  try {
    // Read sprint plan
    const sprintPlanPath = path.join(__dirname, "..", "..", "sprint_plan.txt");
    console.log(`📁 Reading sprint plan from: ${sprintPlanPath}`);
    
    if (!fs.existsSync(sprintPlanPath)) {
      throw new Error(`Sprint plan not found at: ${sprintPlanPath}`);
    }
    
    const sprintPlanText = fs.readFileSync(sprintPlanPath, "utf8");
    console.log("✅ Sprint plan loaded\n");
    
    // Parse tasks
    console.log("🔍 Parsing tasks...");
    const tasks = parseSprintPlan(sprintPlanText);
    console.log(`✅ Found ${tasks.length} tasks\n`);
    
    // Group by assignee for display
    const tasksByAssignee = {};
    tasks.forEach(task => {
      if (!tasksByAssignee[task.assignee]) {
        tasksByAssignee[task.assignee] = [];
      }
      tasksByAssignee[task.assignee].push(task);
    });
    
    console.log("📋 Tasks breakdown:");
    for (const [assignee, assigneeTasks] of Object.entries(tasksByAssignee)) {
      console.log(`   ${assignee}: ${assigneeTasks.length} tasks`);
    }
    console.log("");
    
    // Create Jira issues
    console.log("🚀 Creating Jira issues...\n");
    
    const results = {
      created: [],
      failed: []
    };
    
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      console.log(`[${i + 1}/${tasks.length}] Creating: ${task.title}`);
      console.log(`   Assignee: ${task.assignee}`);
      console.log(`   Points: ${task.points}`);
      
      try {
        // Get Jira account ID for assignee
        const jiraAccountId = getJiraAssigneeForParticipant(task.assignee);
        
        // Build description
        const description = buildDescription(task);
        
        // Create Jira issue
        const issueData = {
          title: task.title,
          description: description,
          participant: task.assignee,
          assignee: jiraAccountId,
          type: "Coding",
          workType: "Task",
          isFuturePlan: false,
          storyPoints: task.points,
          priority: "Medium"
        };
        
        const result = await createJiraIssue(issueData);
        
        if (result.success) {
          console.log(`   ✅ Created: ${result.issueKey}`);
          console.log(`   🔗 ${result.issueUrl}\n`);
          results.created.push({
            task: task.title,
            issueKey: result.issueKey,
            issueUrl: result.issueUrl
          });
        } else {
          console.log(`   ❌ Failed: ${result.error}\n`);
          results.failed.push({
            task: task.title,
            error: result.error
          });
        }
        
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}\n`);
        results.failed.push({
          task: task.title,
          error: error.message
        });
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log("========================================");
    console.log("📊 SUMMARY");
    console.log("========================================");
    console.log(`Total tasks processed: ${tasks.length}`);
    console.log(`Successfully created: ${results.created.length}`);
    console.log(`Failed: ${results.failed.length}`);
    console.log(`Duration: ${duration}s`);
    console.log("");
    
    if (results.failed.length > 0) {
      console.log("❌ Failed tasks:");
      results.failed.forEach(f => {
        console.log(`   - ${f.task}`);
        console.log(`     Error: ${f.error}`);
      });
      console.log("");
    }
    
    if (results.created.length > 0) {
      console.log("✅ Created issues:");
      results.created.forEach(c => {
        console.log(`   ${c.issueKey}: ${c.task}`);
      });
      console.log("");
    }
    
    console.log("✅ Done!");
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.error("\n❌ FAILED!");
    console.error("================");
    console.error(`Error: ${error.message}`);
    console.error(`Duration: ${duration}s`);
    
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  createSprintTickets()
    .then(() => {
      console.log("\n✅ Script completed!\n");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Script failed:", error.message);
      process.exit(1);
    });
}

module.exports = { createSprintTickets };

