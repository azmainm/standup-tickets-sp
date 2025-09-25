# Fetch Yesterday's Transcripts Script

This script fetches yesterday's Teams meeting transcripts and saves them to the MongoDB transcripts collection exactly as done in `testrealflow`/`testfakeflow`.

## Purpose

- Fetches all meetings for `TARGET_USER_ID` from yesterday
- Downloads all available transcripts 
- Saves transcripts to MongoDB `transcripts` collection
- Uses existing services for consistency
- No additional processing - just fetch and save

## Usage

### Option 1: Using npm script (recommended)
```bash
cd functions
npm run fetch:yesterday
```

### Option 2: Direct node execution
```bash
cd functions
node scripts/fetchYesterdayTranscripts.js
```

## Requirements

### Environment Variables
The following environment variables must be set in your `.env` file:

- `AZURE_CLIENT_ID` - Azure app client ID
- `AZURE_CLIENT_SECRET` - Azure app client secret  
- `AZURE_AUTHORITY` - Azure authority URL
- `TARGET_USER_ID` - User ID to fetch meetings for
- `MONGODB_URI` - MongoDB connection string

### Dependencies
All required dependencies are already included in the project's `package.json`.

## How It Works

1. **Environment Validation**: Checks all required environment variables
2. **Service Validation**: Validates All Meetings service configuration  
3. **MongoDB Connection**: Tests MongoDB connectivity
4. **Date Calculation**: Calculates yesterday's date automatically
5. **Transcript Fetching**: Uses `fetchAllMeetingsForUser()` to get all meetings from yesterday
6. **MongoDB Storage**: Uses `storeTranscript()` to save each transcript to the `transcripts` collection

## Output

The script provides detailed console output showing:
- Environment validation status
- Number of meetings/transcripts found
- Individual transcript details (meeting subject, entry count, etc.)
- MongoDB save results with document IDs
- Final summary with execution time

## Error Handling

The script includes comprehensive error handling for:
- Missing environment variables
- Azure authentication failures
- MongoDB connection issues
- Meeting fetch errors
- Transcript save errors

## Database Structure

Transcripts are saved to:
- **Database**: `standuptickets`
- **Collection**: `transcripts`
- **Document Structure**:
  ```json
  {
    "timestamp": "2024-01-01T12:00:00.000Z",
    "date": "2024-01-01",
    "transcript_data": "[compressed JSON string]",
    "entry_count": 25,
    "meeting_id": "meeting_id_here",
    "transcript_id": "transcript_id_here",
    "targetDate": "2024-01-01",
    "scriptExecutedAt": "2024-01-01T12:00:00.000Z", 
    "source": "fetchYesterdayTranscripts.js"
  }
  ```

## Integration with Existing System

This script uses the exact same services and functions as the existing codebase:
- `allMeetingsService.js` for fetching transcripts
- `mongoService.js` for database operations
- Same environment variable requirements
- Same error handling patterns
- Same database collections and structure

## Troubleshooting

If the script fails, check:

1. **Environment Variables**: Ensure all required variables are set
2. **Azure Permissions**: Verify the app has access to Microsoft Graph API
3. **MongoDB Access**: Check database connectivity and permissions  
4. **User Access**: Ensure `TARGET_USER_ID` has meeting access
5. **Meeting Transcription**: Verify meetings had transcription enabled

The script provides detailed error messages and troubleshooting tips on failure.
