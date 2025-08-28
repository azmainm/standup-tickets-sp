/**
 * Reset Ticket Counter Script
 * 
 * This script resets the ticket counter to start from SP-1
 * Run this after clearing the database to reset the counter
 * 
 * Usage: node resetTicketCounter.js
 */

const { resetTicketCounter, getCurrentTicketCount, testMongoConnection } = require('./services/mongoService');
require('dotenv').config();

async function resetCounter() {
  console.log('='.repeat(50));
  console.log('RESETTING TICKET COUNTER TO START FROM SP-1');
  console.log('='.repeat(50));
  
  try {
    // Test MongoDB connection
    console.log('\n1. Testing MongoDB connection...');
    const mongoConnected = await testMongoConnection();
    if (!mongoConnected) {
      console.error('❌ MongoDB connection failed');
      process.exit(1);
    }
    console.log('✅ MongoDB connection successful');
    
    // Get current counter value (if any)
    console.log('\n2. Checking current counter value...');
    try {
      const currentCount = await getCurrentTicketCount();
      console.log(`📊 Current counter value: ${currentCount}`);
      console.log(`📊 Current next ticket ID would be: SP-${currentCount + 1}`);
    } catch (error) {
      console.log('📊 No existing counter found (will be created)');
    }
    
    // Reset counter to 0 (so next ticket will be SP-1)
    console.log('\n3. Resetting counter to start from SP-1...');
    await resetTicketCounter(0); // Set to 0 so next increment gives SP-1
    
    // Verify the reset
    console.log('\n4. Verifying reset...');
    const newCount = await getCurrentTicketCount();
    console.log(`✅ Counter reset successfully!`);
    console.log(`📊 New counter value: ${newCount}`);
    console.log(`🎫 Next ticket ID will be: SP-${newCount + 1}`);
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ TICKET COUNTER RESET COMPLETED!');
    console.log('='.repeat(50));
    console.log('\nThe next tasks created will get ticket IDs:');
    console.log('- SP-1');
    console.log('- SP-2'); 
    console.log('- SP-3');
    console.log('- etc...');
    
    console.log('\nYou can now run your normal flow and new tickets will start from SP-1.');
    
  } catch (error) {
    console.error('\n❌ Error resetting ticket counter:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
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

// Run the reset
if (require.main === module) {
  console.log('Starting ticket counter reset...\n');
  resetCounter().catch(error => {
    console.error('Reset failed:', error);
    process.exit(1);
  });
}

module.exports = {
  resetCounter
};
