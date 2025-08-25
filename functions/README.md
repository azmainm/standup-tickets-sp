# Standup Tickets SP - Firebase Functions

This Firebase Functions project automatically fetches Microsoft Teams meeting transcripts for daily standups, processes them with AI to extract actionable tasks, and stores the results in MongoDB for further processing.

## Setup Instructions

### 1. Environment Variables

Create a `.env` file in the `functions/` directory with the following variables:

```env
# Azure/Microsoft Graph API Configuration
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
AZURE_AUTHORITY=

# Meeting Configuration
DAILY_STANDUP_URL=

# Firebase
FIREBASE_PROJECT_ID=

# MongoDB Configuration
MONGODB_URI=

# OpenAI Configuration
OPENAI_API_KEY=

# Environment
NODE_ENV=production
```

### 2. Install Dependencies

```bash
cd functions
npm install
```

### 3. Test the Setup

#### Test Transcript Fetching Only
```bash
cd functions
node tests/testTranscript.js
```

This will:
- Check Microsoft Graph API environment variables
- Test the Microsoft Graph API connection
- Fetch a transcript if available
- Show detailed output and troubleshooting tips

#### Test OpenAI Processing Only
```bash
cd functions
# Use most recent transcript file
node tests/testOpenAI.js

# Use specific transcript file
node tests/testOpenAI.js 2025-08-25_dailystandup.json

# Use environment variable to specify file
TRANSCRIPT_FILE=2025-08-25_dailystandup.json node tests/testOpenAI.js
```

This will:
- Check OpenAI environment variables
- Test OpenAI API connection
- Process an existing transcript JSON file with AI
- Extract and display tasks by participant
- Show processing statistics

#### Test Transcript Parsing
```bash
cd functions
# Test how transcript is being parsed
node tests/testTranscriptParsing.js

# Test specific file parsing
node tests/testTranscriptParsing.js 2025-08-25_dailystandup.json
```

This will:
- Show raw transcript entries
- Display parsed participant names and text (extracted from `<v ParticipantName>` tags)
- Show what GPT receives as input
- Analyze participant identification
- Display formatting statistics

**Note**: Participant names are extracted from the `text` field using `<v ParticipantName>content</v>` format, not from the `speaker` field.

#### Test Complete Flow
```bash
cd functions
node tests/testFullFlow.js
```

This will:
- Check all environment variables
- Test all service connections (Microsoft Graph, OpenAI, MongoDB)
- Fetch transcript from Microsoft Teams
- Process with OpenAI to extract tasks
- Store results in MongoDB
- Show complete processing statistics

### 4. Deploy to Firebase

```bash
# From the project root
firebase deploy --only functions
```

## Functions

### `dailyTranscriptFetch` (Scheduled)
- **Schedule**: Daily at 2:00 AM Bangladesh time (Asia/Dhaka)
- **Purpose**: Automatically fetches the daily standup transcript
- **Processing**: 
  - Fetches transcript from Microsoft Teams
  - Processes with OpenAI to extract tasks by participant
  - Stores structured task data in MongoDB
  - Categorizes tasks as "Coding" or "Non-Coding"

### `transcriptApi` (HTTP)
- **Endpoints**:
  - `GET /health` - Health check
  - `POST /fetch-transcript` - Manual transcript fetch and processing

#### Manual Transcript Fetch and Processing
The `/fetch-transcript` endpoint now performs the complete flow:
1. Fetches transcript from Microsoft Teams
2. Processes with OpenAI to extract tasks
3. Stores results in MongoDB

```bash
# Using the default meeting URL from environment
curl -X POST https://your-region-your-project.cloudfunctions.net/transcriptApi/fetch-transcript

# Using a custom meeting URL
curl -X POST https://your-region-your-project.cloudfunctions.net/transcriptApi/fetch-transcript \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl": "your_custom_meeting_url"}'
```

**Response Format:**
```json
{
  "message": "Transcript fetched and processed successfully",
  "transcript": { /* transcript data */ },
  "tasks": {
    "success": true,
    "tasks": {
      "Participant Name": {
        "Coding": ["Task 1", "Task 2"],
        "Non-Coding": ["Task 3", "Task 4"]
      }
    },
    "storage": { /* MongoDB storage info */ },
    "summary": { /* processing summary */ }
  },
  "timestamp": "2024-..."
}
```

## File Structure

```
functions/
├── index.js                    # Main Firebase Functions entry point
├── services/
│   ├── getTranscript.js        # Microsoft Graph API service
│   ├── openaiService.js        # OpenAI GPT processing service
│   ├── mongoService.js         # MongoDB storage service
│   └── taskProcessor.js        # Task processing orchestration
├── tests/
│   ├── testTranscript.js       # Test transcript fetching only
│   ├── testOpenAI.js          # Test OpenAI processing only
│   ├── testTranscriptParsing.js # Test transcript parsing/formatting
│   └── testFullFlow.js        # Test complete flow
├── output/                     # Local transcript files (created automatically)
├── .env                        # Environment variables (create this)
├── package.json               # Dependencies
└── README.md                  # This file
```

## How It Works

### Complete Processing Flow
1. **Authentication**: Uses Azure MSAL with client credentials flow
2. **Meeting Discovery**: Extracts organizer info from Teams URL and finds the meeting
3. **Transcript Fetching**: Gets the latest transcript in VTT format
4. **Format Conversion**: Converts VTT to structured JSON
5. **AI Processing**: Sends transcript to OpenAI GPT-4o-mini to extract tasks
6. **Task Categorization**: AI categorizes tasks as "Coding" or "Non-Coding" by participant
7. **Data Storage**: Stores structured task data in MongoDB collection 'sptasks'
8. **Local Backup**: Saves transcript to local file for reference
9. **Logging**: Comprehensive logging for monitoring and debugging

### MongoDB Data Structure
Each document in the 'sptasks' collection follows this structure:
```json
{
  "_id": "ObjectId(...)",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "Azmain": {
    "Coding": [
      {
        "description": "Build a certain feature in the admin panel",
        "status": "To-do"
      }
    ],
    "Non-Coding": [
      {
        "description": "Research on XYZ",
        "status": "To-do"
      }
    ]
  },
  "Doug": {
    "Coding": [
      {
        "description": "Implement user authentication",
        "status": "To-do"
      }
    ],
    "Non-Coding": [
      {
        "description": "Prepare privacy policy",
        "status": "To-do"
      }
    ]
  },
  "Shafkat": {
    "Coding": [
      {
        "description": "Build ABC feature in CAMP",
        "status": "To-do"
      }
    ],
    "Non-Coding": []
  }
}
```

## Troubleshooting

### Common Issues

1. **No transcript found**
   - Meeting hasn't occurred yet
   - Transcription wasn't enabled
   - Transcript is still processing (can take time after meeting ends)

2. **Authentication errors**
   - Check Azure app permissions
   - Verify client ID, secret, and authority URL
   - Ensure the app has Microsoft Graph permissions

3. **Meeting not found**
   - Verify the meeting URL is correct
   - Check that the organizer OID matches the configured user
   - Ensure the meeting exists and is accessible

4. **OpenAI processing errors**
   - Check if your OpenAI API key is valid and has credits
   - Verify the transcript contains actual conversation content
   - Check if the model (gpt-4o-mini) is available in your region

5. **MongoDB connection errors**
   - Verify MongoDB URI is correct and accessible
   - Check if your IP is whitelisted in MongoDB Atlas
   - Ensure database user has read/write permissions

### Testing

Test individual components or the complete flow:

```bash
# Test transcript fetching only
cd functions
node tests/testTranscript.js

# Test OpenAI processing only (requires existing transcript)
node tests/testOpenAI.js

# Test complete flow (transcript + OpenAI + MongoDB)
node tests/testFullFlow.js
```

Each test provides detailed output and troubleshooting information.

### Debugging

Set these environment variables for additional debugging:
```bash
# Show raw GPT responses in OpenAI test
SHOW_RAW_RESPONSE=true

# Enable verbose logging
NODE_ENV=development
```

## Monitoring

- Check Firebase Functions logs: `firebase functions:log`
- Monitor in Firebase Console under Functions section
- Local transcript files are saved in `functions/output/` for reference
- Monitor MongoDB collection 'sptasks' for stored task data
- Track OpenAI token usage in processing logs

## API Usage

The system now provides structured task data that can be consumed by other applications:

### Retrieve Tasks from MongoDB
```javascript
const { getTasks, getLatestTasks, getTasksByParticipant } = require('./services/mongoService');

// Get latest task document
const latest = await getLatestTasks();

// Get tasks for specific participant
const userTasks = await getTasksByParticipant('Azmain', 5);

// Get tasks within date range
const dateTasks = await getTasksByDateRange(startDate, endDate);
```

### Process Transcript from File
```javascript
const { processTranscriptFromFile } = require('./services/taskProcessor');

// Process a specific transcript JSON file
const result = await processTranscriptFromFile('./output/2024-01-15_dailystandup.json');
```
