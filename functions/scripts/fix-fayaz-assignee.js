const { MongoClient } = require('mongodb');

// Load environment variables
require('dotenv').config();

// MongoDB connection configuration
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = 'standuptickets';
const COLLECTION_NAME = 'sptasks';

async function fixFayazAssigneeNames() {
  let client;
  
  try {
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not set. Please set it in your .env file or environment.');
    }
    
    console.log('🔗 Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    const db = client.db(DATABASE_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    console.log('📊 Checking for documents with "Fayaz Rahman" as participant key...');
    
    // Find documents that have "Fayaz Rahman" as a top-level key
    const documentsWithFayaz = await collection.find({
      "Fayaz Rahman": { $exists: true }
    }).toArray();
    
    console.log(`Found ${documentsWithFayaz.length} documents with "Fayaz Rahman" as participant key`);
    
    if (documentsWithFayaz.length === 0) {
      console.log('✅ No documents found with "Fayaz Rahman" participant key. Nothing to update.');
      return;
    }
    
    let updatedCount = 0;
    
    for (const doc of documentsWithFayaz) {
      console.log(`🔄 Processing document ${doc._id}...`);
      
      // Get the Fayaz Rahman data
      const fayazData = doc["Fayaz Rahman"];
      
      // Check if Faiyaz Rahman already exists in this document
      if (doc["Faiyaz Rahman"]) {
        console.log(`⚠️  Document ${doc._id} already has "Faiyaz Rahman" key. Merging tasks...`);
        
        // Merge the tasks from Fayaz into Faiyaz
        const updates = {};
        
        // Merge Coding tasks
        if (fayazData.Coding && Array.isArray(fayazData.Coding)) {
          const existingCoding = doc["Faiyaz Rahman"].Coding || [];
          updates["Faiyaz Rahman.Coding"] = [...existingCoding, ...fayazData.Coding];
        }
        
        // Merge Non-Coding tasks
        if (fayazData["Non-Coding"] && Array.isArray(fayazData["Non-Coding"])) {
          const existingNonCoding = doc["Faiyaz Rahman"]["Non-Coding"] || [];
          updates["Faiyaz Rahman.Non-Coding"] = [...existingNonCoding, ...fayazData["Non-Coding"]];
        }
        
        // Update the document with merged data and remove old key
        await collection.updateOne(
          { _id: doc._id },
          {
            $set: updates,
            $unset: { "Fayaz Rahman": "" }
          }
        );
        
        console.log(`✅ Merged and removed "Fayaz Rahman" from document ${doc._id}`);
      } else {
        // Simply rename the key from "Fayaz Rahman" to "Faiyaz Rahman"
        await collection.updateOne(
          { _id: doc._id },
          {
            $set: { "Faiyaz Rahman": fayazData },
            $unset: { "Fayaz Rahman": "" }
          }
        );
        
        console.log(`✅ Renamed "Fayaz Rahman" to "Faiyaz Rahman" in document ${doc._id}`);
      }
      
      updatedCount++;
    }
    
    // Verify the changes
    console.log('🔍 Verifying changes...');
    const remainingFayaz = await collection.countDocuments({
      "Fayaz Rahman": { $exists: true }
    });
    
    const countFaiyaz = await collection.countDocuments({
      "Faiyaz Rahman": { $exists: true }
    });
    
    console.log('📊 Results:');
    console.log(`  Documents with "Fayaz Rahman" remaining: ${remainingFayaz}`);
    console.log(`  Documents with "Faiyaz Rahman": ${countFaiyaz}`);
    console.log(`  Total documents processed: ${updatedCount}`);
    
    if (remainingFayaz === 0) {
      console.log('✅ Successfully updated all "Fayaz Rahman" participant keys to "Faiyaz Rahman"');
    } else {
      console.log('⚠️  Some "Fayaz Rahman" participant keys may still remain. Please check manually.');
    }
    
  } catch (error) {
    console.error('❌ Error updating assignee names:', error);
    throw error;
  } finally {
    if (client) {
      await client.close();
      console.log('🔌 MongoDB connection closed');
    }
  }
}

// Run the script
if (require.main === module) {
  fixFayazAssigneeNames()
    .then(() => {
      console.log('🎉 Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Script failed:', error);
      process.exit(1);
    });
}

module.exports = { fixFayazAssigneeNames };