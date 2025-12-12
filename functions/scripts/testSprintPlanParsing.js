/**
 * Test script to verify sprint_plan.txt parsing
 * This will NOT create any Jira tickets - it just shows what would be created
 */

const fs = require("fs");
const path = require("path");

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
    
    // Collect "Which codebase" content (already handled inline above)
    
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
 * Test the parsing
 */
function testParsing() {
  console.log("========================================");
  console.log("🧪 TESTING SPRINT PLAN PARSING");
  console.log("========================================\n");
  
  try {
    // Read sprint plan
    const sprintPlanPath = path.join(__dirname, "..", "..", "sprint_plan.txt");
    console.log(`📁 Reading sprint plan from: ${sprintPlanPath}\n`);
    
    if (!fs.existsSync(sprintPlanPath)) {
      throw new Error(`Sprint plan not found at: ${sprintPlanPath}`);
    }
    
    const sprintPlanText = fs.readFileSync(sprintPlanPath, "utf8");
    
    // Parse tasks
    const tasks = parseSprintPlan(sprintPlanText);
    
    console.log(`✅ Found ${tasks.length} total tasks\n`);
    
    // Group by assignee
    const tasksByAssignee = {};
    tasks.forEach(task => {
      if (!tasksByAssignee[task.assignee]) {
        tasksByAssignee[task.assignee] = [];
      }
      tasksByAssignee[task.assignee].push(task);
    });
    
    console.log("========================================");
    console.log("📊 TASKS BREAKDOWN BY ASSIGNEE");
    console.log("========================================\n");
    
    for (const [assignee, assigneeTasks] of Object.entries(tasksByAssignee)) {
      console.log(`👤 ${assignee}: ${assigneeTasks.length} tasks`);
    }
    console.log("");
    
    // Calculate total points
    let totalPoints = 0;
    for (const [assignee, assigneeTasks] of Object.entries(tasksByAssignee)) {
      const assigneePoints = assigneeTasks.reduce((sum, task) => sum + task.points, 0);
      totalPoints += assigneePoints;
      console.log(`   ${assignee}: ${assigneePoints} points`);
    }
    console.log(`\n   TOTAL: ${totalPoints} points\n`);
    
    // Display each task in detail
    console.log("========================================");
    console.log("📋 DETAILED TASK LIST");
    console.log("========================================\n");
    
    for (const [assignee, assigneeTasks] of Object.entries(tasksByAssignee)) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`👤 ${assignee.toUpperCase()}`);
      console.log(`${"=".repeat(60)}\n`);
      
      assigneeTasks.forEach((task, index) => {
        console.log(`[Task ${index + 1}/${assigneeTasks.length}]`);
        console.log(`${"─".repeat(60)}`);
        console.log(`📌 Title: ${task.title}`);
        console.log(`⭐ Points: ${task.points}`);
        
        if (task.whatToBuild) {
          console.log(`\n📝 What to Build:`);
          console.log(`   ${task.whatToBuild}`);
        } else {
          console.log(`\n⚠️  WARNING: No "What to Build" content found!`);
        }
        
        if (task.technicalScope) {
          console.log(`\n🔧 Technical Scope:`);
          console.log(`   ${task.technicalScope}`);
        }
        
        if (task.whichCodebase) {
          console.log(`\n💻 Which Codebase:`);
          console.log(`   ${task.whichCodebase}`);
        }
        
        if (task.acceptanceCriteria.length > 0) {
          console.log(`\n✅ Acceptance Criteria (${task.acceptanceCriteria.length} items):`);
          task.acceptanceCriteria.forEach((criterion, i) => {
            console.log(`   ${i + 1}. ${criterion}`);
          });
        } else {
          console.log(`\n⚠️  WARNING: No acceptance criteria found!`);
        }
        
        console.log("");
      });
    }
    
    // Validation summary
    console.log("\n========================================");
    console.log("✅ VALIDATION SUMMARY");
    console.log("========================================\n");
    
    let hasWarnings = false;
    let warningCount = 0;
    
    tasks.forEach(task => {
      const issues = [];
      
      if (!task.title) {
        issues.push("Missing title");
      }
      if (!task.whatToBuild || task.whatToBuild.trim() === "") {
        issues.push("Missing 'What to Build'");
      }
      if (task.acceptanceCriteria.length === 0) {
        issues.push("Missing acceptance criteria");
      }
      if (task.points === 0) {
        issues.push("Missing points (0)");
      }
      
      if (issues.length > 0) {
        hasWarnings = true;
        warningCount++;
        console.log(`⚠️  Task: "${task.title || 'UNTITLED'}"`);
        console.log(`   Assignee: ${task.assignee}`);
        issues.forEach(issue => {
          console.log(`   - ${issue}`);
        });
        console.log("");
      }
    });
    
    if (!hasWarnings) {
      console.log("✅ All tasks have complete information!");
      console.log("");
    } else {
      console.log(`⚠️  Found ${warningCount} task(s) with missing information\n`);
    }
    
    // Final summary
    console.log("========================================");
    console.log("📊 FINAL SUMMARY");
    console.log("========================================");
    console.log(`Total Tasks: ${tasks.length}`);
    console.log(`Total Points: ${totalPoints}`);
    console.log(`Assignees: ${Object.keys(tasksByAssignee).length}`);
    console.log("");
    
    console.log("Tasks per assignee:");
    for (const [assignee, assigneeTasks] of Object.entries(tasksByAssignee)) {
      console.log(`  - ${assignee}: ${assigneeTasks.length} tasks, ${assigneeTasks.reduce((sum, t) => sum + t.points, 0)} points`);
    }
    console.log("");
    
    if (!hasWarnings) {
      console.log("🎉 All tasks parsed successfully with complete information!");
      console.log("✅ Ready to create Jira tickets!");
    } else {
      console.log("⚠️  Some tasks have missing information - please review the warnings above");
    }
    console.log("");
    
  } catch (error) {
    console.error("\n❌ ERROR!");
    console.error("================");
    console.error(`Error: ${error.message}`);
    
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testParsing();
}

module.exports = { testParsing, parseSprintPlan };

