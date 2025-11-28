# TRADES to TDS Migration Guide

## Overview

This guide helps you migrate all ticket IDs from `TRADES-XXX` format to `TDS-XXX` format in both Jira and MongoDB.

## What's Changed

All code references have been updated from TRADES to TDS:
- ✅ `jiraService.js` - Updated ticket ID validation and defaults
- ✅ `taskFinderService.js` - Updated all documentation and examples
- ✅ `statusChangeDetectionService.js` - Updated comments and patterns
- ✅ `taskProcessor.js` - Updated log messages
- ✅ `taskSchemas.js` - Updated comments
- ✅ `README.md` - Updated documentation
- ✅ `JIRA_INTEGRATION_GUIDE.md` - Updated examples
- ✅ `MEETING_PARTICIPANT_GUIDELINES.md` - Updated all examples
- ✅ `.env` - You already changed `JIRA_PROJECT_KEY=TDS`

## Migration Script

A safe migration script has been created at:
```
functions/scripts/migrateTradesToTds.js
```

### Features

✅ **Safe by default**: Runs in dry-run mode first  
✅ **Detailed logging**: Shows exactly what will change  
✅ **MongoDB migration**: Updates all `ticketId` and `jiraTicketId` fields  
✅ **Jira migration**: Adds migration notes to Jira issues  
✅ **Error handling**: Graceful error handling with detailed reporting  

## Migration Steps

### Step 1: Dry Run (RECOMMENDED)

First, run the script in dry-run mode to see what will change:

```bash
cd /Users/azmainmorshed/Uw/prompt/standup-tickets-sp/functions
node scripts/migrateTradesToTds.js
```

This will:
- Show you all tickets that will be updated
- Display the changes without making them
- Generate a detailed report

### Step 2: Review the Output

The dry run will show you:
- Number of MongoDB tasks to update
- Number of Jira issues to update
- Exact changes for each ticket

Example output:
```
[2025-01-15T10:30:00.000Z] Found 45 tasks with TRADES ticket IDs
[2025-01-15T10:30:01.000Z] [DRY RUN] Updating task 507f1f77bcf86cd799439011
  old: { ticketId: "TRADES-123", jiraTicketId: "TRADES-123" }
  new: { ticketId: "TDS-123", jiraTicketId: "TDS-123" }
```

### Step 3: Run Actual Migration

Once you're satisfied with the dry run, run the actual migration:

```bash
cd /Users/azmainmorshed/Uw/prompt/standup-tickets-sp/functions
DRY_RUN=false node scripts/migrateTradesToTds.js
```

This will:
- Update all MongoDB ticket IDs from TRADES-XXX to TDS-XXX
- Add migration notes to Jira issues
- Generate a final report

**Note**: You'll have a 5-second countdown to cancel if needed.

## What Gets Migrated

### MongoDB Changes
- `ticketId` field: `TRADES-XXX` → `TDS-XXX`
- `jiraTicketId` field: `TRADES-XXX` → `TDS-XXX`
- Collections affected: `sptasks`

### Jira Changes
- Adds migration note to issue descriptions
- Note indicates the old and new ticket ID format
- **Important**: Jira doesn't support changing project keys via API
  - Issues will remain in the TRADES project in Jira
  - But new tickets will be created in TDS project going forward
  - Old TRADES tickets will have migration notes added

## Important Notes

### About Jira Project Migration

⚠️ **Jira Limitation**: Jira's API doesn't support moving issues between projects automatically.

**Your Options:**

1. **Keep Both Projects** (Recommended for now)
   - Old TRADES issues remain in Jira TRADES project
   - New issues will be created in TDS project
   - Migration script adds notes to TRADES issues referencing TDS format
   - System will work with both formats

2. **Manual Jira Migration** (Optional)
   - You can manually move issues from TRADES to TDS in Jira UI
   - Go to each issue → Move → Select TDS project
   - This changes the issue key from TRADES-XXX to TDS-XXX in Jira

3. **Fresh Start** (Simplest)
   - Keep old TRADES issues as-is in Jira
   - All new tickets use TDS format
   - MongoDB is fully migrated to use TDS

### Recommendation

For minimal risk, we recommend:
1. Run the migration script (it only updates MongoDB and adds notes to Jira)
2. Continue using the system normally (it will create new TDS tickets)
3. Optionally, manually migrate critical TRADES tickets in Jira UI later

## Verification

After migration, verify:

### MongoDB
```bash
# Connect to MongoDB and check
db.sptasks.find({ ticketId: /^TRADES-/ }).count()  # Should be 0
db.sptasks.find({ ticketId: /^TDS-/ }).count()      # Should show migrated count
```

### System Behavior
- New tickets created in meetings should have TDS-XXX format
- Participants can reference tickets as "TDS-XXX" in meetings
- System will recognize both SP-XXX and TDS-XXX formats

## Rollback (If Needed)

If something goes wrong, you can rollback MongoDB changes:

```javascript
// Run this in MongoDB shell
db.sptasks.updateMany(
  { ticketId: /^TDS-/ },
  [{ $set: { 
    ticketId: { $replaceOne: { input: "$ticketId", find: "TDS-", replacement: "TRADES-" } },
    jiraTicketId: { $replaceOne: { input: "$jiraTicketId", find: "TDS-", replacement: "TRADES-" } }
  }}]
);
```

And update your `.env`:
```
JIRA_PROJECT_KEY=TRADES
```

## Testing

After migration, test the system:

1. **Create a new task in a meeting**
   - Should get TDS-XXX ticket ID
   
2. **Update an existing migrated task**
   - Reference it as "TDS-XXX" in meeting
   - Should update correctly

3. **Check Jira integration**
   - New tasks should create in TDS project
   - Updates should work correctly

## Support

If you encounter issues:
1. Check the migration log output
2. Verify MongoDB connection
3. Verify Jira credentials
4. Check that JIRA_PROJECT_KEY=TDS in .env

## Summary

✅ Code updated: All references changed from TRADES to TDS  
✅ Migration script created: Safe, dry-run enabled by default  
✅ MongoDB will be fully migrated: All ticket IDs updated  
✅ Jira will have migration notes: Issues stay in place with notes  
✅ New system behavior: Creates TDS-XXX tickets going forward  

The migration is designed to be **very simple and safe**. Start with the dry run, review carefully, then apply when ready!

