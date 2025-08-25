/**
 * Test file for complete task processing flow
 * 
 * This test file runs the complete flow:
 * 1. Fetch transcript from Microsoft Teams
 * 2. Process with OpenAI to extract tasks
 * 3. Store in MongoDB
 * 
 * Usage: node tests/testFullFlow.js
 */

const { getMeetingTranscript } = require('../services/getTranscript');
const { processTranscriptToTasks } = require('../services/taskProcessor');
const { testOpenAIConnection } = require('../services/openaiService');
const { testMongoConnection, getCollectionStats } = require('../services/mongoService');
require('dotenv').config();

async function testCompleteFlow() {
  console.log('='.repeat(80));
  console.log('TESTING COMPLETE TASK PROCESSING FLOW');
  console.log('='.repeat(80));
  
  // Check environment variables
  console.log('\n1. Checking environment variables...');
  const requiredEnvVars = [
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET', 
    'AZURE_AUTHORITY',
    'DAILY_STANDUP_URL',
    'OPENAI_API_KEY',
    'MONGODB_URI'
  ];
  
  const missingVars = [];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      missingVars.push(envVar);
    } else {
      const displayValue = envVar.includes('SECRET') || envVar.includes('KEY') ? '[HIDDEN]' : 
                          process.env[envVar].substring(0, 30) + '...';
      console.log(`✓ ${envVar}: ${displayValue}`);
    }
  }
  
  if (missingVars.length > 0) {
    console.error('\n❌ Missing environment variables:');
    missingVars.forEach(envVar => console.error(`   - ${envVar}`));
    console.error('\nPlease check your .env file in the functions directory.');
    process.exit(1);
  }
  
  console.log('\n✓ All environment variables found');
  
  // Test service connections
  console.log('\n2. Testing service connections...');
  
  console.log('   🤖 Testing OpenAI connection...');
  const openaiTest = await testOpenAIConnection();
  if (!openaiTest) {
    console.error('   ❌ OpenAI connection test failed');
    process.exit(1);
  }
  console.log('   ✓ OpenAI connection successful');
  
  console.log('   🍃 Testing MongoDB connection...');
  const mongoTest = await testMongoConnection();
  if (!mongoTest) {
    console.error('   ❌ MongoDB connection test failed');
    process.exit(1);
  }
  console.log('   ✓ MongoDB connection successful');
  
  // Get MongoDB collection stats
  try {
    const stats = await getCollectionStats();
    console.log(`   📊 MongoDB collection has ${stats.documentCount} existing documents`);
  } catch (error) {
    console.log('   📊 MongoDB collection stats unavailable (collection may not exist yet)');
  }
  
  // Step 1: Fetch transcript
  console.log('\n3. Fetching transcript from Microsoft Teams...');
  console.log(`   📅 Meeting URL: ${process.env.DAILY_STANDUP_URL.substring(0, 60)}...`);
  
  let transcriptResult;
  try {
    console.log('   🔄 Starting transcript fetch...');
    const startTime = Date.now();
    
    transcriptResult = await getMeetingTranscript(process.env.DAILY_STANDUP_URL);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (transcriptResult) {
      console.log('   ✅ Transcript fetched successfully');
      console.log(`   ⏱️  Duration: ${duration} seconds`);
      console.log(`   📊 Entries: ${transcriptResult.metadata.entryCount}`);
      console.log(`   🆔 Meeting ID: ${transcriptResult.metadata.meetingId}`);
      console.log(`   💾 Saved to: ${transcriptResult.metadata.savedToFile}`);
      
      // Show sample entries
      if (transcriptResult.transcript.length > 0) {
        console.log('\n   📝 Sample entries (first 3):');
        transcriptResult.transcript.slice(0, 3).forEach((entry, index) => {
          const speaker = entry.speaker?.replace(/<[^>]*>/g, '').trim() || 'Unknown';
          const text = entry.text?.replace(/<[^>]*>/g, '').substring(0, 80) || '';
          console.log(`      ${index + 1}. ${speaker}: ${text}${text.length >= 80 ? '...' : ''}`);
        });
      }
      
    } else {
      console.log('   ⚠️  No transcript found for this meeting');
      console.log('   This could mean:');
      console.log('      - The meeting hasn\'t occurred yet');
      console.log('      - No transcript was generated'); 
      console.log('      - Transcription is still processing');
      console.log('\n   ❌ Cannot proceed with task processing without transcript');
      process.exit(1);
    }
    
  } catch (error) {
    console.log('\n   ❌ ERROR occurred during transcript fetch:');
    console.error(`      Message: ${error.message}`);
    
    if (error.response) {
      console.error(`      HTTP Status: ${error.response.status}`);
    }
    
    console.log('\n   Cannot proceed with task processing without transcript');
    process.exit(1);
  }
  
  // Step 2: Process transcript with complete flow (OpenAI + MongoDB)
  console.log('\n4. Processing transcript with complete flow...');
  console.log('   🔄 Starting OpenAI processing and MongoDB storage...');
  
  try {
    const startTime = Date.now();
    
    const taskResult = await processTranscriptToTasks(
      transcriptResult.transcript, 
      transcriptResult.metadata
    );
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (taskResult.success) {
      console.log('   ✅ Complete flow successful!');
      console.log(`   ⏱️  Total duration: ${duration} seconds`);
      
      // Show OpenAI processing details
      console.log('\n   🤖 OpenAI Processing:');
      console.log(`      - Model: ${taskResult.processing.metadata.model}`);
      console.log(`      - Tokens used: ${taskResult.processing.metadata.tokensUsed}`);
      
      // Show MongoDB storage details
      console.log('\n   🍃 MongoDB Storage:');
      console.log(`      - Document ID: ${taskResult.storage.documentId}`);
      console.log(`      - Timestamp: ${taskResult.storage.timestamp}`);
      
      // Show task summary
      console.log('\n   📋 Task Summary:');
      console.log(`      - Participants: ${taskResult.summary.participantCount}`);
      console.log(`      - Total tasks: ${taskResult.summary.totalTasks}`);
      
      // Display extracted tasks
      console.log('\n5. EXTRACTED AND STORED TASKS:');
      console.log('='.repeat(60));
      
      const tasks = taskResult.tasks;
      
      for (const [participant, participantTasks] of Object.entries(tasks)) {
        console.log(`\n👤 ${participant}'s Tasks:`);
        
        if (participantTasks.Coding && participantTasks.Coding.length > 0) {
          console.log('   💻 Coding Tasks:');
          participantTasks.Coding.forEach((task, index) => {
            const taskText = typeof task === 'string' ? task : task.description;
            const taskStatus = typeof task === 'object' ? task.status : 'To-do';
            console.log(`      ${index + 1}. ${taskText} (${taskStatus})`);
          });
        }
        
        if (participantTasks['Non-Coding'] && participantTasks['Non-Coding'].length > 0) {
          console.log('   📝 Non-Coding Tasks:');
          participantTasks['Non-Coding'].forEach((task, index) => {
            const taskText = typeof task === 'string' ? task : task.description;
            const taskStatus = typeof task === 'object' ? task.status : 'To-do';
            console.log(`      ${index + 1}. ${taskText} (${taskStatus})`);
          });
        }
        
        if ((!participantTasks.Coding || participantTasks.Coding.length === 0) && 
            (!participantTasks['Non-Coding'] || participantTasks['Non-Coding'].length === 0)) {
          console.log('   (No tasks identified)');
        }
      }
      
      // Show final statistics
      console.log('\n📈 FINAL STATISTICS:');
      console.log(`   - Transcript entries processed: ${transcriptResult.metadata.entryCount}`);
      console.log(`   - Participants identified: ${taskResult.summary.participantCount}`);
      console.log(`   - Total tasks extracted: ${taskResult.summary.totalTasks}`);
      console.log(`   - OpenAI tokens used: ${taskResult.processing.metadata.tokensUsed}`);
      console.log(`   - Total processing time: ${taskResult.processing.metadata.totalProcessingTime}`);
      console.log(`   - MongoDB document ID: ${taskResult.storage.documentId}`);
      
      // Show updated collection stats
      try {
        const finalStats = await getCollectionStats();
        console.log(`   - MongoDB documents (after): ${finalStats.documentCount}`);
      } catch (error) {
        console.log('   - MongoDB final stats unavailable');
      }
      
    } else {
      console.error('   ❌ Task processing failed');
      process.exit(1);
    }
    
  } catch (error) {
    console.log('\n   ❌ ERROR occurred during task processing:');
    console.error(`      Message: ${error.message}`);
    
    if (error.stack) {
      console.error(`      Stack: ${error.stack.substring(0, 200)}...`);
    }
    
    console.log('\nTroubleshooting tips:');
    console.log('   1. Check OpenAI API key and credits');
    console.log('   2. Verify MongoDB connection and permissions');
    console.log('   3. Check if transcript format is valid');
    console.log('   4. Review service logs for detailed error information');
    
    process.exit(1);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('COMPLETE FLOW TEST COMPLETED SUCCESSFULLY! 🎉');
  console.log('='.repeat(80));
  console.log('\nNext steps:');
  console.log('- Check MongoDB to verify data was stored correctly');
  console.log('- Review the transcript file in the output directory');
  console.log('- Test the Firebase Functions deployment');
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Run the test
if (require.main === module) {
  console.log('Starting complete flow test...\n');
  testCompleteFlow().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

module.exports = {
  testCompleteFlow
};
