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

# Jira Configuration
JIRA_URL=https://your-domain.atlassian.net/
JIRA_EMAIL=your-email@domain.com
JIRA_API_TOKEN=your-api-token
JIRA_PROJECT_KEY=YOUR_PROJECT_KEY

# Environment
NODE_ENV=production
```

### 2. Jira Setup

#### Creating Jira API Token
1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Give it a label (e.g., "Standup Tickets SP Integration")
4. Copy the generated token and use it for `JIRA_API_TOKEN`

#### Jira Project Configuration
1. Ensure you have access to a Jira project
2. Get the project key (visible in project settings, e.g., "PROM")
3. Verify your user has permission to create issues in the project
4. Make sure the project uses "Task" issue type (or modify the code for your issue type)

#### Participant Email Mapping
**Important**: You must configure participant-to-email mapping for proper issue assignment.

1. Edit `functions/config/participantMapping.js`
2. Map transcript participant names to their Jira email addresses:

```javascript
const PARTICIPANT_TO_JIRA_MAPPING = {
  "Azmain Morshed": "azmainmorshed03@gmail.com",
  "Doug Whitewolff": "doug@yourcompany.com",
  "Shafkat Kabir": "shafkat@yourcompany.com",
  
  // Add variations for better matching
  "Azmain": "azmainmorshed03@gmail.com",
  "Doug": "doug@yourcompany.com",
  "Shafkat": "shafkat@yourcompany.com",
};
```

3. Set a default assignee for unknown participants:
```javascript
const DEFAULT_ASSIGNEE = "azmainmorshed03@gmail.com"; // or null for unassigned
```

**Why is this needed?**
- Microsoft Teams transcripts use display names (e.g., "Azmain Morshed")
- Jira requires email addresses or usernames for assignment
- Without mapping, all issues would be created unassigned

### 3. Install Dependencies

```bash
cd functions
npm install
```

### 4. Test the Setup

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

#### Test Participant Mapping
```bash
cd functions
# Test participant mapping configuration
node tests/testParticipantMapping.js

# Test specific participant name
node tests/testParticipantMapping.js "Azmain Morshed"
node tests/testParticipantMapping.js "Doug"
```

This will validate email formats, test name matching, and show assignment results.

#### Test Jira Integration Only
```bash
cd functions
# Test with default file (test_transcript.json)
node tests/testJiraIntegration.js

# Test with specific transcript file
node tests/testJiraIntegration.js 2025-08-25_dailystandup.json

# Test Jira connection and issue creation only (without OpenAI processing)
node tests/testJiraIntegration.js --jira-only

# Use environment variable to specify file
TRANSCRIPT_FILE=2025-08-25_dailystandup.json node tests/testJiraIntegration.js
```

This will:
- Check Jira environment variables
- Test Jira API connection and project access
- Create mock coding tasks from transcript participants
- Generate titles using GPT and create Jira issues
- Optionally run full OpenAI processing with Jira integration

#### Test Complete Flow
```bash
cd functions
node tests/testFullFlow.js
```

This will:
- Check all environment variables (including Jira)
- Test all service connections (Microsoft Graph, OpenAI, MongoDB, Jira)
- Fetch transcript from Microsoft Teams
- Process with OpenAI to extract tasks
- Store results in MongoDB
- Create Jira issues for coding tasks
- Show complete processing statistics

### 5. Deploy to Firebase

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
  - Creates Jira issues for coding tasks with AI-generated titles

### `transcriptApi` (HTTP)
- **Endpoints**:
  - `GET /health` - Health check
  - `POST /fetch-transcript` - Manual transcript fetch and processing

#### Manual Transcript Fetch and Processing
The `/fetch-transcript` endpoint now performs the complete flow:
1. Fetches transcript from Microsoft Teams
2. Processes with OpenAI to extract tasks
3. Stores results in MongoDB
4. Creates Jira issues for coding tasks

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
    "jira": {
      "success": true,
      "totalCodingTasks": 3,
      "createdIssues": [
        {
          "issueKey": "PROM-123",
          "issueUrl": "https://your-domain.atlassian.net/browse/PROM-123",
          "title": "Implement User Authentication",
          "participant": "Participant Name"
        }
      ],
      "failedIssues": [],
      "processingTime": "2.34s"
    },
    "summary": { /* processing summary with Jira statistics */ }
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
│   ├── jiraService.js          # Jira API integration service
│   └── taskProcessor.js        # Task processing orchestration
├── config/
│   └── participantMapping.js   # Participant name to email mapping
├── tests/
│   ├── testTranscript.js       # Test transcript fetching only
│   ├── testOpenAI.js          # Test OpenAI processing only
│   ├── testTranscriptParsing.js # Test transcript parsing/formatting
│   ├── testParticipantMapping.js # Test participant email mapping
│   ├── testJiraIntegration.js  # Test Jira integration only
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
7. **Transcript Storage**: Stores raw transcript data in MongoDB collection 'transcripts'
8. **Task Storage**: Stores structured task data in MongoDB collection 'sptasks'
9. **Jira Integration**: Creates Jira issues for coding tasks only
   - Maps participant names to email addresses using configuration
   - Generates concise titles (max 5 words) using GPT
   - Creates issues in the configured Jira project
   - Assigns issues to participants using email mapping
   - Uses original task descriptions as issue descriptions
10. **Local Backup**: Saves transcript to local file for reference
11. **Logging**: Comprehensive logging for monitoring and debugging

### MongoDB Data Structure

#### Tasks Collection ('sptasks')
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

#### Transcripts Collection ('transcripts')
Each document in the 'transcripts' collection stores the raw transcript data:
```json
{
  "_id": "ObjectId(...)",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "date": "2024-01-15",
  "transcript_data": "[{\"speaker\":\"00:00:16.499\",\"startTime\":\"-->\",\"text\":\"<v Azmain Morshed>Hi, guys.</v>\"}...]",
  "entry_count": 424,
  "meeting_id": "MSo1MGE2NjM5NS1mMzFiLTRkZWUtYTQ1ZS1lZjQxZjM5MjBjOWI...",
  "transcript_id": "MiMjMTUwYTY2Mzk1LWYzMWItNGRlZS1hNDVlLWVmNDFmMzkyMGM5YmJjYjU5...",
  "source": "microsoft_teams",
  "original_filename": "2024-01-15_dailystandup.json"
}
```

**Fields Explanation:**
- `timestamp`: When the transcript was stored
- `date`: The date this transcript is for (YYYY-MM-DD format)
- `transcript_data`: Raw transcript stored as compressed JSON string for efficiency
- `entry_count`: Number of transcript entries
- `meeting_id`: Microsoft Teams meeting identifier
- `transcript_id`: Microsoft Teams transcript identifier
- `source`: Source of the transcript (e.g., "microsoft_teams")
- `original_filename`: Name of the local backup file

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

6. **Jira integration errors**
   - Verify Jira URL, email, and API token are correct
   - Check if the project key exists and is accessible
   - Ensure your user has permission to create issues in the project
   - Verify the issue type "Task" exists in your project
   - Check if participant names match Jira user accounts for assignment

### Testing

Test individual components or the complete flow:

```bash
# Test transcript fetching only
cd functions
node tests/testTranscript.js

# Test OpenAI processing only (requires existing transcript)
node tests/testOpenAI.js

# Test Jira integration only
node tests/testJiraIntegration.js

# Test complete flow (transcript + OpenAI + MongoDB + Jira)
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
- Check your Jira project for created issues and their status
- Track OpenAI token usage in processing logs
- Monitor Jira API rate limits and errors in logs

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

### Retrieve Transcripts from MongoDB
```javascript
const { getTranscripts, getLatestTranscript, getTranscriptByDate } = require('./services/mongoService');

// Get latest transcript
const latestTranscript = await getLatestTranscript();

// Get transcript for specific date
const transcript = await getTranscriptByDate('2024-01-15');

// Get all transcripts (with pagination)
const allTranscripts = await getTranscripts({}, { limit: 5 });

// The transcript_data field contains the raw transcript as parsed JSON array
console.log(transcript.transcript_data); // Array of transcript entries
```

### Process Transcript from File
```javascript
const { processTranscriptFromFile } = require('./services/taskProcessor');

// Process a specific transcript JSON file (includes Jira integration)
const result = await processTranscriptFromFile('./output/2024-01-15_dailystandup.json');

// Access Jira integration results
if (result.jira) {
  console.log(`Created ${result.jira.createdIssues.length} Jira issues`);
  result.jira.createdIssues.forEach(issue => {
    console.log(`${issue.issueKey}: ${issue.title} - ${issue.issueUrl}`);
  });
}
```
