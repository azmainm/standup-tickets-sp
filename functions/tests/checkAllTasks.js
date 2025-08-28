const { MongoClient } = require('mongodb');
require('dotenv').config();

async function checkAllTasks() {
  try {
    console.log('=== CHECKING ALL TASKS (INCLUDING COMPLETED) ===');
    
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db('standuptickets');
    const collection = db.collection('sptasks');
    
    const documents = await collection.find({}, { sort: { timestamp: -1 } }).toArray();
    console.log(`Total documents: ${documents.length}\n`);
    
    const allTasks = [];
    const mentionedIds = ['SP-3', 'SP-4', 'SP-10', 'SP-12', 'SP-13', 'SP-15'];
    
    // Extract all tasks from all documents
    for (const doc of documents) {
      console.log(`Document ${doc._id} (${new Date(doc.timestamp).toLocaleDateString()}):`);
      
      for (const [participantName, participantData] of Object.entries(doc)) {
        if (participantName === '_id' || participantName === 'timestamp') continue;
        
        // Process coding tasks
        if (participantData.Coding && Array.isArray(participantData.Coding)) {
          participantData.Coding.forEach((task, i) => {
            if (task && task.ticketId) {
              const taskInfo = {
                ticketId: task.ticketId,
                description: task.description || 'No description',
                status: task.status || 'Unknown',
                participant: participantName,
                type: 'Coding',
                documentId: doc._id
              };
              allTasks.push(taskInfo);
              
              if (mentionedIds.includes(task.ticketId)) {
                console.log(`  ✓ FOUND: ${task.ticketId} - ${taskInfo.description.substring(0, 60)}... (${task.status})`);
              }
            }
          });
        }
        
        // Process non-coding tasks  
        if (participantData['Non-Coding'] && Array.isArray(participantData['Non-Coding'])) {
          participantData['Non-Coding'].forEach((task, i) => {
            if (task && task.ticketId) {
              const taskInfo = {
                ticketId: task.ticketId,
                description: task.description || 'No description', 
                status: task.status || 'Unknown',
                participant: participantName,
                type: 'Non-Coding',
                documentId: doc._id
              };
              allTasks.push(taskInfo);
              
              if (mentionedIds.includes(task.ticketId)) {
                console.log(`  ✓ FOUND: ${task.ticketId} - ${taskInfo.description.substring(0, 60)}... (${task.status})`);
              }
            }
          });
        }
      }
      console.log('');
    }
    
    console.log('=== SUMMARY ===');
    console.log(`Total tasks with ticket IDs: ${allTasks.length}`);
    
    // Check which mentioned IDs were found
    console.log('\nMentioned ticket IDs check:');
    mentionedIds.forEach(id => {
      const found = allTasks.find(task => task.ticketId === id);
      if (found) {
        console.log(`  ✓ ${id}: Found - ${found.description.substring(0, 50)}... (${found.status})`);
      } else {
        console.log(`  ✗ ${id}: NOT FOUND in database`);
      }
    });
    
    // Show all existing ticket IDs
    console.log('\nAll existing ticket IDs in database:');
    const ticketIds = [...new Set(allTasks.map(t => t.ticketId))].sort();
    ticketIds.forEach(id => {
      const task = allTasks.find(t => t.ticketId === id);
      console.log(`  ${id}: ${task.description.substring(0, 50)}... (${task.status})`);
    });
    
    await client.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkAllTasks();
