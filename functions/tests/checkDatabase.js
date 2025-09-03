const { getActiveTasks } = require("../services/mongoService");
require("dotenv").config();

async function checkDatabase() {
  try {
    console.log("=== CHECKING DATABASE FOR TICKET IDs ===");
    
    const activeTasks = await getActiveTasks();
    console.log(`Total active tasks: ${activeTasks.length}\n`);
    
    // Check tasks with ticket IDs
    const tasksWithTicketIds = activeTasks.filter(task => task.ticketId);
    console.log(`Tasks WITH ticket IDs: ${tasksWithTicketIds.length}`);
    
    tasksWithTicketIds.forEach((task, i) => {
      console.log(`  ${i + 1}. ${task.ticketId}: ${task.description?.substring(0, 60) || "No description"}...`);
      console.log(`     Participant: ${task.participantName}, Status: ${task.status}`);
    });
    
    // Check tasks without ticket IDs
    const tasksWithoutTicketIds = activeTasks.filter(task => !task.ticketId);
    console.log(`\nTasks WITHOUT ticket IDs: ${tasksWithoutTicketIds.length}`);
    
    tasksWithoutTicketIds.slice(0, 5).forEach((task, i) => {
      console.log(`  ${i + 1}. ${task.description?.substring(0, 60) || "No description"}...`);
      console.log(`     Participant: ${task.participantName}, Status: ${task.status}`);
    });
    
    // Test ticket ID normalization
    console.log("\n=== TESTING TICKET ID NORMALIZATION ===");
    const testIds = ["SP3", "SP 12", "SP-13", "sp4", "SP 15", "SP-7"];
    testIds.forEach(id => {
      const normalized = normalizeTicketId(id);
      console.log(`"${id}" -> "${normalized}"`);
    });
    
  } catch (error) {
    console.error("Error:", error);
  }
}

function normalizeTicketId(ticketId) {
  if (!ticketId) return null;
  
  // Remove spaces, convert to uppercase, ensure dash format
  return ticketId.toString()
    .replace(/\s+/g, "") // Remove all spaces
    .toUpperCase()
    .replace(/^(SP)(\d+)$/, "$1-$2"); // Add dash if missing: SP3 -> SP-3
}

checkDatabase();
