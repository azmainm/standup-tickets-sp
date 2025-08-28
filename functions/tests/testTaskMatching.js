/**
 * Test Task Matching Functionality
 * 
 * This test file validates the new task matching and update functionality
 * Run with: node tests/testTaskMatching.js
 */

const { matchTasksWithDatabase, findMatchingTask, checkTaskSimilarityWithGPT, parseTimeEstimate, parseTimeSpent, parseStatusUpdate } = require('../services/taskMatcher');
const { getActiveTasks } = require('../services/mongoService');

// Load environment variables
require('dotenv').config();

/**
 * Test the string similarity and parsing functions
 */
function testParsingFunctions() {
  console.log('\n🧪 TESTING PARSING FUNCTIONS');
  console.log('=' .repeat(50));
  
  // Test time estimate parsing
  console.log('\n📊 Time Estimate Parsing Tests:');
  const timeEstimateTests = [
    'This task will take 5 hours to complete',
    'Estimated 3.5 hours for this feature',
    'Should take about 8 hours',
    'Might need 2 days',
    'No time mentioned here',
    'Complete in 4 hrs'
  ];
  
  timeEstimateTests.forEach(test => {
    const result = parseTimeEstimate(test);
    console.log(`  "${test}" → ${result} hours`);
  });
  
  // Test time spent parsing
  console.log('\n⏱️  Time Spent Parsing Tests:');
  const timeSpentTests = [
    'I spent 4 hours on this task',
    'Took me 2.5 hours to finish',
    'Worked for 6 hours yesterday',
    'Completed in 3 hours',
    'No time information',
    'Spent 1 hr debugging'
  ];
  
  timeSpentTests.forEach(test => {
    const result = parseTimeSpent(test);
    console.log(`  "${test}" → ${result} hours`);
  });
  
  // Test status parsing
  console.log('\n📋 Status Parsing Tests:');
  const statusTests = [
    'I have completed the login feature',
    'Started working on the dashboard',
    'Currently implementing the API',
    'Finished the database setup',
    'Am working on the frontend',
    'Just discussing the requirements'
  ];
  
  statusTests.forEach(test => {
    const result = parseStatusUpdate(test);
    console.log(`  "${test}" → ${result || 'No status detected'}`);
  });
}

/**
 * Test GPT-based task similarity
 */
async function testGPTSimilarity() {
  console.log('\n🤖 TESTING GPT TASK SIMILARITY');
  console.log('=' .repeat(50));
  
  const testCases = [
    {
      task1: 'Implement user authentication system',
      task2: 'Add login functionality',
      expectedMatch: true
    },
    {
      task1: 'Build payment gateway',
      task2: 'Fix login bug',
      expectedMatch: false
    },
    {
      task1: 'Create admin dashboard',
      task2: 'Add user management to admin panel',
      expectedMatch: true
    },
    {
      task1: 'Write project documentation',
      task2: 'Update API docs',
      expectedMatch: true
    },
    {
      task1: 'Deploy to production',
      task2: 'Set up database',
      expectedMatch: false
    }
  ];
  
  console.log('\n🔄 Running GPT similarity tests...');
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n${i + 1}. Testing:`);
    console.log(`   Task 1: "${testCase.task1}"`);
    console.log(`   Task 2: "${testCase.task2}"`);
    console.log(`   Expected: ${testCase.expectedMatch ? 'MATCH' : 'NO MATCH'}`);
    
    try {
      const result = await checkTaskSimilarityWithGPT(testCase.task1, testCase.task2);
      console.log(`   GPT Result: ${result.isMatch ? 'MATCH' : 'NO MATCH'} (confidence: ${result.confidence})`);
      console.log(`   Reasoning: ${result.reasoning}`);
      
      const correct = result.isMatch === testCase.expectedMatch;
      console.log(`   ✅ ${correct ? 'CORRECT' : 'INCORRECT'} prediction`);
    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}`);
    }
  }
}

/**
 * Test task matching with mock data
 */
async function testTaskMatching() {
  console.log('\n🔍 TESTING TASK MATCHING');
  console.log('=' .repeat(50));
  
  // Mock existing tasks
  const existingTasks = [
    {
      participantName: 'Azmain',
      description: 'Implement user authentication system',
      status: 'In-progress',
      type: 'Coding',
      estimatedTime: 5,
      timeTaken: 2,
      documentId: 'mock123',
      taskPath: 'Azmain.Coding.0'
    },
    {
      participantName: 'Azmain',
      description: 'Write project documentation',
      status: 'To-do',
      type: 'Non-Coding',
      estimatedTime: 3,
      timeTaken: 0,
      documentId: 'mock123',
      taskPath: 'Azmain.Non-Coding.0'
    }
  ];
  
  // Mock new tasks to test matching
  const newTasks = [
    {
      assignee: 'Azmain',
      description: 'Add validation to user authentication',
      type: 'Coding'
    },
    {
      assignee: 'Azmain',
      description: 'Create API documentation',
      type: 'Non-Coding'
    },
    {
      assignee: 'Azmain',
      description: 'Build payment processing system',
      type: 'Coding'
    }
  ];
  
  console.log('\n📝 Existing Tasks:');
  existingTasks.forEach((task, i) => {
    console.log(`  ${i + 1}. ${task.description} (${task.type}) - ${task.status}`);
  });
  
  console.log('\n🆕 New Tasks to Match:');
  newTasks.forEach((task, i) => {
    console.log(`  ${i + 1}. ${task.description} (${task.type})`);
  });
  
  console.log('\n🔄 Matching Results:');
  
  for (let i = 0; i < newTasks.length; i++) {
    const newTask = newTasks[i];
    const participantTasks = existingTasks.filter(t => t.participantName === newTask.assignee);
    
    try {
      const match = await findMatchingTask(newTask, participantTasks);
      
      if (match) {
        console.log(`  ${i + 1}. MATCH FOUND: "${newTask.description}" matches "${match.description}" (confidence: ${match.similarityScore.toFixed(2)})`);
        console.log(`     Reasoning: ${match.reasoning}`);
      } else {
        console.log(`  ${i + 1}. NO MATCH: "${newTask.description}" is a new task`);
      }
    } catch (error) {
      console.log(`  ${i + 1}. ERROR: Failed to check "${newTask.description}" - ${error.message}`);
    }
  }
}

/**
 * Test the complete database integration (if MongoDB is available)
 */
async function testDatabaseIntegration() {
  console.log('\n💾 TESTING DATABASE INTEGRATION');
  console.log('=' .repeat(50));
  
  try {
    // Test getting active tasks from database
    console.log('\n📊 Fetching active tasks from database...');
    const activeTasks = await getActiveTasks();
    
    console.log(`Found ${activeTasks.length} active tasks in database:`);
    activeTasks.slice(0, 5).forEach((task, i) => {
      console.log(`  ${i + 1}. ${task.participantName}: ${task.description.substring(0, 50)}... (${task.status})`);
    });
    
    if (activeTasks.length > 5) {
      console.log(`  ... and ${activeTasks.length - 5} more tasks`);
    }
    
    // Test with mock new tasks
    const mockExtractedTasks = {
      'Azmain': {
        'Coding': [
          {
            description: 'Implement new search functionality',
            status: 'To-do',
            estimatedTime: 4,
            timeTaken: 0,
            taskType: 'NEW TASK'
          }
        ],
        'Non-Coding': []
      }
    };
    
    console.log('\n🔄 Testing task matching with database...');
    const matchingResult = await matchTasksWithDatabase(mockExtractedTasks);
    
    console.log('\n📊 Matching Results:');
    console.log(`  New tasks to create: ${matchingResult.summary.newTasks}`);
    console.log(`  Existing tasks to update: ${matchingResult.summary.updatedTasks}`);
    console.log(`  Total processed: ${matchingResult.summary.totalProcessed}`);
    
    if (matchingResult.tasksToCreate.length > 0) {
      console.log('\n✨ New tasks to create:');
      matchingResult.tasksToCreate.forEach((task, i) => {
        console.log(`  ${i + 1}. ${task.participantName}: ${task.description}`);
      });
    }
    
    if (matchingResult.tasksToUpdate.length > 0) {
      console.log('\n🔄 Tasks to update:');
      matchingResult.tasksToUpdate.forEach((update, i) => {
        console.log(`  ${i + 1}. Updating: ${update.originalTask.description}`);
        console.log(`     Updates: ${JSON.stringify(update.updates, null, 2)}`);
      });
    }
    
  } catch (error) {
    console.log('\n❌ Database test failed:');
    console.log(`   Error: ${error.message}`);
    
    if (error.message.includes('MONGODB_URI')) {
      console.log('   💡 Tip: Make sure MongoDB environment variables are set in .env file');
    } else {
      console.log('   💡 Tip: Check your MongoDB connection and environment setup');
    }
  }
}

/**
 * Main test function
 */
async function runTests() {
  console.log('🚀 TASK MATCHING FUNCTIONALITY TESTS');
  console.log('=' .repeat(60));
  
  try {
    // Run parsing function tests
    testParsingFunctions();
    
    // Run GPT similarity tests
    await testGPTSimilarity();
    
    // Run task matching tests
    await testTaskMatching();
    
    // Run database integration tests
    await testDatabaseIntegration();
    
    console.log('\n✅ ALL TESTS COMPLETED!');
    console.log('=' .repeat(60));
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    // Close any database connections
    try {
      const { closeMongoDB } = require('../services/mongoService');
      await closeMongoDB();
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}

module.exports = {
  testParsingFunctions,
  testGPTSimilarity,
  testTaskMatching,
  testDatabaseIntegration,
  runTests
};
