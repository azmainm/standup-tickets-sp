# Standup Tickets SP - Firebase Functions

This Firebase Functions project automatically fetches Microsoft Teams meeting transcripts for daily standups, processes them with a **3-Stage Pipeline** to extract actionable tasks with enhanced detail and context, and stores the results in MongoDB.

## 🚀 NEW: 3-Stage Pipeline Architecture (Version 5.0)

The system now features a **specialized 3-stage processing pipeline** that dramatically improves task extraction quality:

### Stage 1: Task Finder 🔍
- **Purpose**: Pure extraction of actionable tasks with maximum detail and context
- **Role**: Scrum Task Finder (Analytical, Evidence-oriented, Context-aware)
- **Output**: Rich task descriptions with full conversation context (3-5x longer descriptions)

### Stage 2: Task Creator 📝
- **Purpose**: Systematic identification of genuinely new tasks
- **Role**: Task Creator (Systematic, Clear, Neutral)
- **Intelligence**: Vector similarity matching + GPT decision making for borderline cases

### Stage 3: Task Updater 🔄
- **Purpose**: Enhancement of existing tasks with new information and status changes
- **Role**: Task Updater (Systematic, Clear, Neutral)
- **Features**: Update type classification, status change detection, information synthesis

## 🆕 All Meetings Support

The system supports **two approaches** for fetching transcripts:

1. **🆕 All Meetings Approach** - Fetches ALL meetings for a user on a specific date (NEW)
2. **🔄 Legacy Approach** - Fetches transcript from specific meeting URLs (existing, maintained for backward compatibility)

## Previous Enhancements (Version 4.0)

The system maintains **vector database integration** for ultra-fast task similarity search:

1. **🚀 Vector Similarity Search** - FAISS-based embedding search (10-100x faster) (PRIMARY)
2. **🤖 GPT-based Analysis** - Deep semantic analysis via OpenAI (FALLBACK)
3. **🔄 Admin Panel Synchronization** - Smart sync with manual admin panel changes
4. **⚡ Performance Optimization** - 90%+ reduction in API costs and processing time

See the [System Flow Documentation](../Docs/SYSTEM_FLOW_DOCUMENTATION.md) for complete technical details and real-world examples.

## Setup Instructions

### 1. Environment Variables

Create a `.env` file in the `functions/` directory with the following variables:

```env
# Azure/Microsoft Graph API Configuration
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
AZURE_AUTHORITY=

# 🆕 NEW: All Meetings Approach Configuration
TARGET_USER_ID=50a66395-f31b-4dee-a45e-ef41f3920c9b  # User whose calendar to fetch

# 🔄 Legacy Meeting Configuration (Day-based URLs)
DAILY_STANDUP_URL_MWF=  # Monday, Wednesday, Friday meetings
DAILY_STANDUP_URL_TT=   # Tuesday, Thursday meetings

# Legacy Meeting URL (for backward compatibility)
DAILY_STANDUP_URL=

# Firebase
FIREBASE_PROJECT_ID=

# MongoDB Configuration
MONGODB_URI=

# OpenAI Configuration
OPENAI_API_KEY=

# Jira Configuration (Optional - removed from main flow)
# JIRA_URL=https://your-domain.atlassian.net/
# JIRA_EMAIL=your-email@domain.com
# JIRA_API_TOKEN=your-api-token
# JIRA_PROJECT_KEY=YOUR_PROJECT_KEY

# Teams Webhook Configuration
TEAMS_WEBHOOK_URL=https://your-teams-webhook-url

# Environment
NODE_ENV=production
```

### 2. Jira Setup (Optional - Not Used in Main Flow)

> **Note**: Jira integration has been removed from the main processing flow. This section is kept for reference if you want to re-enable Jira integration in the future using the existing `jiraService.js` file.

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
  "Jane Doe": "jane@gmail.com",
  "John Doe": "john@yourcompany.com",h
  "Shafkat Kabir": "shafkat@yourcompany.com",
  
  // Add variations for better matching
  "Azmain": "jane@gmail.com",
  "John": "john@yourcompany.com",
};
```

3. Set a default assignee for unknown participants:
```javascript
const DEFAULT_ASSIGNEE = "jane@gmail.com"; // or null for unassigned
```

**Why is this needed?**
- Microsoft Teams transcripts use display names (e.g., "Azmain Morshed")
- Jira requires email addresses or usernames for assignment
- Without mapping, all issues would be created unassigned

### 3. Teams Webhook Setup (Optional)

The system can automatically send a standup summary to a Microsoft Teams channel after processing is complete.

#### Creating Teams Webhook
1. Go to your Teams channel where you want to receive summaries
2. Click the "..." menu → "Connectors"
3. Find "Incoming Webhook" and click "Configure"
4. Give it a name (e.g., "Standup Summary Bot")
5. Optionally upload a custom icon
6. Click "Create" and copy the webhook URL
7. Add the URL to your `.env` file as `TEAMS_WEBHOOK_URL`

#### Teams Summary Format
The Teams summary includes:
- **Standup date** (formatted as DD/MM/YYYY)
- **New tasks** created for each participant with ticket IDs and coding/non-coding labels
- **Updated tasks** for each participant with ticket IDs and coding/non-coding labels
- **Link to admin panel** for detailed task view

**Example Teams Message:**
```
📋 Daily Standup Summary
Standup Date: 25/12/2024

John Doe:
New Tasks
1. SP-100: Implement User Auth (Coding)

Updated Tasks
1. SP-95: Database Migration (Non-Coding)

Jane Doe:
New Tasks
1. SP-101: API Integration (Coding)
2. SP-102: Frontend Dashboard (Coding)

Updated Tasks
1. SP-90: Bug Fix (Coding)
2. SP-85: Documentation (Non-Coding)

**Future Plans discussed in this meeting:**
1. SP-105: Mobile App Development (Coding)
2. SP-106: API Versioning System (Non-Coding)

Please check Admin Panel to see the new and updated tasks.
```

#### Configuration Notes
- **Optional**: If `TEAMS_WEBHOOK_URL` is not set, the system will skip Teams notifications
- **No Impact**: Teams integration failure will not affect other processing steps
- **Logging**: All Teams webhook attempts are logged for monitoring

### 4. Install Dependencies

```bash
cd functions
npm install

# ✨ OPTIONAL: Install FAISS for vector database (ultra-fast similarity search)
npm install faiss-node
# Note: System works without FAISS but falls back to slower GPT-based similarity
```

### 4.5. ✨ NEW: Migrate Existing Tasks to Vector Database

**IMPORTANT**: If you have existing tasks in your database, you need to run this one-time migration to populate the vector database:

```bash
cd functions

# Preview what will be migrated
npm run migrate:preview

# Run the actual migration (generates embeddings for all existing tasks)
npm run migrate:vector-db
```

**What this does:**
- Fetches all existing tasks from MongoDB
- Generates vector embeddings using OpenAI
- Stores embeddings in FAISS vector database
- Enables ultra-fast similarity search for existing tasks

**When to run:**
- ✅ **First time setup**: After installing the enhanced system
- ✅ **Major data import**: After importing tasks from another system  
- ❌ **Regular use**: Not needed for day-to-day operations (new tasks auto-generate embeddings)

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
node tests/testParticipantMapping.js "Jane"
node tests/testParticipantMapping.js "John"
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

#### Test Enhanced Task Matching
```bash
cd functions
node tests/testTaskMatching.js
```

This will:
- Test string similarity and time/status parsing functions
- Test task matching algorithms with mock data
- Test database integration for active task retrieval
- Show task matching results and update logic

#### ✨ NEW: Test Vector Database
```bash
cd functions

# Quick test of vector database functionality
npm run test:vector-db

# Or run directly
node tests/testVectorDB.js
```

This will:
- Test vector database initialization and availability
- Test embedding generation and storage
- Test similarity search functionality
- Test synchronization with admin panel changes
- Show performance comparisons and statistics

**Note**: Run the migration first if you have existing tasks: `npm run migrate:vector-db`

#### Test Teams Webhook Integration
```bash
cd functions
node tests/testTeamsWebhook.js
```

This will:
- Check Teams webhook environment variables
- Test Teams webhook connection with a test message
- Test summary formatting with mock data
- Send a complete standup summary to Teams
- Test empty data scenarios
- Validate summary data generation from task results

**Note**: This test requires `TEAMS_WEBHOOK_URL` to be set in your `.env` file.

#### Test Complete Flow
```bash
cd functions
node tests/testFullFlow.js
```

This will:
- Check all environment variables (including Jira and Teams)
- Test all service connections (Microsoft Graph, OpenAI, MongoDB, Jira, Teams)
- Fetch transcript from Microsoft Teams
- Process with OpenAI to extract tasks with enhanced prompting
- Match tasks with existing database tasks
- Update existing tasks and create new ones
- Store results in MongoDB
- Create Jira issues for new coding tasks only
- Send standup summary to Teams channel (if configured)
- Show complete processing statistics including task matching results

### 5. Deploy to Firebase

```bash
# From the project root
firebase deploy --only functions
```

## Functions

### `dailyTranscriptFetch` (Scheduled) - 🆕 ALL MEETINGS ONLY
- **Schedule**: Tuesday-Saturday at 2:00 AM Bangladesh time (Asia/Dhaka) - **Skips weekends**
- **Purpose**: Automatically fetches the previous day's meeting transcript(s)
- **🆕 Current Implementation**: ALL MEETINGS APPROACH ONLY
  - **Requires `TARGET_USER_ID`**: Must be configured or function fails
  - **No Legacy Fallback**: Current implementation does not fall back to Legacy approach
  - **All Meetings Processing**: Fetches ALL meetings for the target user on previous day
  - **Individual Processing**: Each transcript processed separately through complete pipeline
  - **Example**: 3 meetings found → 3 transcripts processed → 3 separate Teams notifications
- **Processing** (Applied to Each Transcript Individually):
  - Processes with OpenAI to extract tasks by participant with **task ID support**
  - **Assigns unique ticket IDs** (SP-{number}) to new tasks
  - Stores structured task data in MongoDB
  - Categorizes tasks as "Coding" or "Non-Coding"
  - **Sends separate Teams notification for EACH meeting** (if webhook configured)
- **🔄 Legacy Support**: Environment variables maintained for potential future use

### `transcriptApi` (HTTP) - 🆕 ENHANCED
- **Endpoints**:
  - `GET /health` - Health check (now shows `allMeetingsEnabled` status)
  - `POST /fetch-transcript` - Manual transcript fetch and processing (enhanced with dual approach support)

#### Manual Transcript Fetch and Processing - 🆕 ALL MEETINGS FOCUSED
The `/fetch-transcript` endpoint primarily uses All Meetings Approach:

**🆕 Current Behavior**:
- **`TARGET_USER_ID` configured**: Uses All Meetings Approach (PRIMARY)
- **No `TARGET_USER_ID` configured**: Returns error requiring configuration
- **Legacy URLs**: Supported in environment but not actively used in endpoint

**Processing Flow**:
1. Fetches transcript(s) from Microsoft Teams (All Meetings Approach)
2. Processes EACH transcript with OpenAI to extract tasks
3. Stores results in MongoDB
5. **Sends separate Teams notification for EACH transcript/meeting**

**⚠️ Important**: Multiple meetings = Multiple Teams notifications (not consolidated)

**Usage Examples**:

```bash
# 🆕 NEW: Use All Meetings Approach (if TARGET_USER_ID configured)
curl -X POST https://your-region-your-project.cloudfunctions.net/transcriptApi/fetch-transcript

# 🔄 Force Legacy Approach with specific meeting URL
curl -X POST https://your-region-your-project.cloudfunctions.net/transcriptApi/fetch-transcript \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl": "your_custom_meeting_url"}'

# 🔄 Use Legacy Approach with environment meeting URLs
# (when TARGET_USER_ID not configured)
curl -X POST https://your-region-your-project.cloudfunctions.net/transcriptApi/fetch-transcript
```

**🆕 NEW Response Format (All Meetings Approach):**
```json
{
  "message": "All meetings fetched and processed - 2 successful, 0 failed",
  "approach": "ALL_MEETINGS",
  "targetDate": "2025-09-02",
  "totalTranscripts": 2,
  "successfullyProcessed": 2,
  "failedProcessing": 0,
  "results": [
    {
      "transcript": { /* transcript data with metadata */ },
      "tasks": { /* complete task processing result */ },
      "success": true
    },
    {
      "transcript": { /* transcript data with metadata */ },
      "tasks": { /* complete task processing result */ },
      "success": true
    }
  ],
  "timestamp": "2025-..."
}
```

**🔄 Legacy Response Format:**
```json
{
  "message": "Transcript fetched and processed successfully",
  "approach": "LEGACY",
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
  "timestamp": "2025-..."
}
```

## File Structure

```
functions/
├── index.js                    # Main Firebase Functions entry point (🆕 ENHANCED)
├── services/
│   ├── getTranscript.js        # Microsoft Graph API service (legacy approach)
│   ├── allMeetingsService.js   # 🆕 NEW: All meetings fetching service
│   ├── openaiService.js        # OpenAI GPT processing service
│   ├── mongoService.js         # MongoDB storage service
│   ├── jiraService.js          # Jira API integration service
│   ├── teamsService.js         # Microsoft Teams webhook integration
│   ├── taskProcessor.js        # Task processing orchestration
│   ├── taskMatcher.js          # Task matching and similarity detection
│   ├── meetingUrlService.js    # Meeting URL selection service
│   └── teamsService.js         # Teams webhook integration
├── config/
│   └── participantMapping.js   # Participant name to email mapping
├── tests/
│   ├── testTranscript.js       # Test transcript fetching only
│   ├── testFetchAllMeetings.js # 🆕 NEW: Test all meetings functionality
│   ├── testOpenAI.js          # Test OpenAI processing only
│   ├── testTranscriptParsing.js # Test transcript parsing/formatting
│   ├── testParticipantMapping.js # Test participant email mapping
│   ├── testJiraIntegration.js  # Test Jira integration only
│   ├── testTaskMatching.js     # Test enhanced task matching functionality
│   ├── testTeamsWebhook.js     # Test Teams webhook integration
│   └── testFullFlow.js        # Test complete flow
├── output/                     # Local transcript files (created automatically)
├── .env                        # Environment variables (create this)
├── package.json               # Dependencies
└── README.md                  # This file
```

## How It Works

### 🆕 ENHANCED Complete Processing Flow

#### Phase 1: Approach Selection & Transcript Fetching
**🆕 All Meetings Approach** (when `TARGET_USER_ID` configured):
1. **Authentication**: Uses Azure MSAL with client credentials flow
2. **Calendar Discovery**: Fetches all calendar events for target user and date
3. **Meeting Filtering**: Identifies online meetings with `isOnlineMeeting = true`
4. **Transcript Collection**: For each online meeting:
   - Extracts join URL from calendar event
   - Finds corresponding online meeting object
   - Downloads all transcripts for that meeting
   - Filters transcripts by target date
5. **Format Conversion**: Converts each VTT to structured JSON

**🔄 Legacy Approach** (fallback or when `TARGET_USER_ID` not configured):
1. **Authentication**: Uses Azure MSAL with client credentials flow  
2. **Meeting Discovery**: Extracts organizer info from Teams URL and finds the meeting
3. **Transcript Fetching**: Gets the latest transcript in VTT format
4. **Format Conversion**: Converts VTT to structured JSON

#### Phase 2: Processing Pipeline (Applied to EACH Transcript INDIVIDUALLY)
**⚠️ IMPORTANT**: Each transcript from each meeting goes through the complete pipeline separately.

For EACH transcript:
5. **Raw Transcript Storage**: Store complete transcript in MongoDB 'transcripts' collection
6. **AI Processing**: Send transcript to OpenAI GPT-4o-mini to extract tasks with enhanced prompting for:
   - Time estimates and actual time spent
   - Task status updates (To-do, In-progress, Completed)
   - Task type identification (NEW TASK, EXISTING TASK UPDATE, STATUS CHANGE)
7. **Task Matching**: Compare extracted tasks with existing database tasks
   - Retrieve all active tasks (To-do/In-progress) from database
   - Use similarity matching to identify task updates vs new tasks
   - Determine which tasks to create vs update
8. **Task Updates**: Update existing tasks in database with new information
   - Add progress updates and new information to task descriptions
   - Update status changes (started, completed, etc.)
   - Update time tracking (estimated time, time spent)
9. **New Task Storage**: Store only new tasks in MongoDB 'sptasks' collection with unique SP-XX IDs
11. **📢 Teams Notification**: Send summary to Teams channel for THIS transcript (if webhook configured)
    - Generate summary of new and updated tasks from this specific meeting
    - Format with participant breakdown and ticket IDs
    - Send immediately after processing this transcript
12. **Local Backup**: Save transcript to local file for reference

#### Phase 3: Multiple Meetings Result
**🆕 All Meetings Approach Result**: 
- If 3 meetings found → 3 separate transcripts processed → 3 separate Teams notifications sent
- Each meeting's tasks are processed and stored independently
- Teams receives separate summary for each meeting (not consolidated)

**🔄 Legacy Approach Result**:
- Single meeting → Single transcript processed → Single Teams notification sent

### MongoDB Data Structure

#### Tasks Collection ('sptasks')
Each document in the 'sptasks' collection follows this structure with **unique ticket IDs**:
```json
{
  "_id": "ObjectId(...)",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "Jane": {
    "Coding": [
      {
        "ticketId": "SP-1",
        "title": "Build Admin Feature",
        "description": "Build a certain feature in the admin panel",
        "status": "To-do",
        "estimatedTime": 5,
        "timeTaken": 0,
        "isFuturePlan": false
      }
    ],
    "Non-Coding": [
      {
        "ticketId": "SP-2",
        "title": "Research XYZ",
        "description": "Research on XYZ",
        "status": "To-do",
        "estimatedTime": 2,
        "timeTaken": 0,
        "isFuturePlan": false
      }
    ]
  },
  "John": {
    "Coding": [
      {
        "ticketId": "SP-3",
        "title": "User Authentication",
        "description": "Implement user authentication",
        "status": "To-do",
        "estimatedTime": 8,
        "timeTaken": 3,
        "isFuturePlan": false
      }
    ],
    "Non-Coding": [
      {
        "ticketId": "SP-4",
        "title": "Privacy Policy",
        "description": "Prepare privacy policy",
        "status": "To-do",
        "estimatedTime": 4,
        "timeTaken": 0,
        "isFuturePlan": false
      }
    ]
  },
  "TBD": {
    "Coding": [
      {
        "ticketId": "SP-5",
        "title": "Mobile App Development",
        "description": "Develop mobile application for iOS and Android",
        "status": "To-do",
        "estimatedTime": 0,
        "timeTaken": 0,
        "isFuturePlan": true
      }
    ],
    "Non-Coding": [
      {
        "ticketId": "SP-6",
        "title": "API Documentation Revamp",
        "description": "Completely revamp API documentation structure",
        "status": "To-do",
        "estimatedTime": 0,
        "timeTaken": 0,
        "isFuturePlan": true
      }
    ]
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

**Task Fields Explanation:**
- `ticketId`: **NEW** - Unique identifier in SP-{number} format (e.g., SP-1, SP-2, SP-3)
- `title`: **NEW** - AI-generated concise title (2-5 words) from task description
- `description`: The full task description
- `status`: Current status ("To-do", "In-progress", "Completed")
- `estimatedTime`: Estimated time to complete the task (in hours) - **Enhanced extraction**
- `timeTaken`: Actual time spent on the task so far (in hours) - **Enhanced extraction**
- `isFuturePlan`: **NEW** - Boolean indicating if this is a future plan (true) or regular task (false)

**Fields Explanation:**
- `timestamp`: When the transcript was stored
- `date`: The date this transcript is for (YYYY-MM-DD format)
- `transcript_data`: Raw transcript stored as compressed JSON string for efficiency
- `entry_count`: Number of transcript entries
- `meeting_id`: Microsoft Teams meeting identifier
- `transcript_id`: Microsoft Teams transcript identifier
- `source`: Source of the transcript (e.g., "microsoft_teams")
- `original_filename`: Name of the local backup file

## 🆕 New Features (Version 3.0 - All Meetings Support)

### All Meetings Approach
- **Multi-Meeting Processing**: Automatically finds and processes ALL online meetings for a user on target date
- **Calendar Integration**: Uses Microsoft Graph Calendar API to discover meetings
- **Comprehensive Coverage**: No meeting is missed - captures standup, planning, retro, and any other meetings
- **Individual Processing**: Each transcript goes through complete processing pipeline separately
- **Consolidated Reporting**: Aggregated results and notifications across all meetings

### Enhanced Approach Selection
- **Intelligent Fallback**: Automatically falls back to Legacy approach if All Meetings fails
- **Configuration-Based**: Uses `TARGET_USER_ID` presence to determine approach
- **Manual Override**: Force Legacy approach by providing specific `meetingUrl`
- **Backward Compatibility**: Existing configurations continue working without changes

### Improved Monitoring & Logging
- **Approach Identification**: Clear logging of which approach is being used (🆕/🔄)
- **Per-Transcript Tracking**: Individual success/failure tracking for multiple transcripts
- **Enhanced Statistics**: Aggregated metrics across all processed transcripts
- **Fallback Visibility**: Clear logging when fallback scenarios occur

### API Enhancements
- **Dual Response Formats**: Different response structures for All Meetings vs Legacy
- **Health Check Enhancement**: `/health` endpoint now shows `allMeetingsEnabled` status
- **Detailed Results**: Individual transcript results with success/failure status

## 🆕 New Features (Version 2.0 - Previous Updates)

### Unique Task ID System
- **Automatic ID Assignment**: Every new task gets a unique ID in format SP-{number} (e.g., SP-1, SP-2, SP-3)
- **Serial Counter**: Starts from SP-1 (database was cleared), increments automatically
- **Persistent Tracking**: IDs are stored in MongoDB `counters` collection for consistency across deployments
- **Participant Guidelines**: Updated to require task ID mentions for existing task updates

### AI-Generated Task Titles
- **Automatic Title Generation**: AI creates concise 2-5 word titles from task descriptions
- **Batch Processing**: Efficient bulk title generation for all tasks at once
- **Smart Fallbacks**: Handles edge cases with intelligent fallback mechanisms
- **Consistent Format**: Clean, professional titles suitable for display and reporting

### Day-Based Meeting URL Support
- **MWF/TT Meetings**: Separate URLs for Monday/Wednesday/Friday vs Tuesday/Thursday meetings
- **Environment Variables**: 
  - `DAILY_STANDUP_URL_MWF` for Monday, Wednesday, Friday meetings
  - `DAILY_STANDUP_URL_TT` for Tuesday, Thursday meetings
- **Smart Scheduling**: Scheduler determines which URL to use based on the day
- **Weekend Skipping**: No scheduled runs on Saturday/Sunday (no meetings)
- **Previous Day Logic**: 2 AM runs fetch the previous day's meeting transcript

### Enhanced Time Extraction
- **Natural Language Processing**: Extracts time from words ("three hours", "half day", "couple hours")
- **Multiple Formats**: Supports "3 hours", "2 days", "half day", "morning", "afternoon"
- **Time Unit Conversion**: Automatically converts days to hours (1 day = 8 hours)
- **Improved Accuracy**: Better AI prompting for time estimate and time spent extraction

### Task ID Reference System
- **Existing Task Updates**: Participants mention SP-XX to update existing tasks
- **New Task Creation**: No task ID mentioned = new task (gets auto-assigned ID)
- **AI Understanding**: Enhanced OpenAI prompts to detect task ID references
- **Guidelines Integration**: Comprehensive participant guidelines for proper usage

## Enhanced Task Tracking Features

### Task Matching and Updates
The system now intelligently matches new tasks from meeting transcripts with existing tasks in the database:

1. **Smart Matching**: Uses GPT-4o-mini to intelligently match tasks by assignee and description similarity
2. **Automatic Updates**: Updates existing tasks with new information rather than creating duplicates
3. **Progress Tracking**: Tracks time estimates and actual time spent on tasks
4. **Status Management**: Automatically updates task status based on meeting discussions

### Time Tracking
Tasks now include comprehensive time tracking:
- **Estimated Time**: Captures time estimates when participants mention them
- **Time Taken**: Tracks actual time spent as reported in meetings
- **Automatic Parsing**: Extracts time information from natural language ("took 3 hours", "estimated 5 hours")

### Status Updates
The system automatically detects and updates task status:
- **To-do**: Initial status for new tasks
- **In-progress**: When participants mention starting work
- **Completed**: When participants report finishing tasks

### Future Plans Tracking
The system now automatically detects when participants mention future plans or ideas:
- **Detection**: Uses phrases like "is a future plan", "future enhancement", "planned for future"
- **Assignment**: Automatically assigned to "TBD" (To Be Determined)
- **Tracking**: Marked with `isFuturePlan: true` flag for easy identification
- **Teams Integration**: Included in a separate "Future Plans discussed in this meeting" section

### Task Types
The enhanced prompting identifies different types of task mentions:
- **NEW TASK**: Completely new tasks being assigned
- **EXISTING TASK UPDATE**: Progress updates on existing tasks
- **STATUS CHANGE**: Changes in task status (started, completed, etc.)
- **FUTURE PLAN**: Future plans or ideas mentioned for consideration

### Participant Guidelines
See `MEETING_PARTICIPANT_GUIDELINES.md` for detailed guidance on how participants should communicate about tasks during meetings to ensure accurate tracking.

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

## 🆕 Migration Guide - Upgrading to All Meetings Support

### For New Deployments
1. **Configure All Meetings Approach**:
   ```bash
   # Add to your .env file
   TARGET_USER_ID=50a66395-f31b-4dee-a45e-ef41f3920c9b
   ```

2. **Keep Legacy Configuration** (recommended as fallback):
   ```bash
   # Keep existing variables for fallback
   DAILY_STANDUP_URL_MWF=https://teams.microsoft.com/...
   DAILY_STANDUP_URL_TT=https://teams.microsoft.com/...
   ```

3. **Deploy and Test**:
   ```bash
   firebase deploy --only functions
   
   # Test All Meetings approach
   curl -X POST https://your-function-url/fetch-transcript
   
   # Test Legacy fallback
   curl -X POST https://your-function-url/fetch-transcript \
     -d '{"meetingUrl": "your-specific-url"}'
   ```

### For Existing Deployments
✅ **Zero Breaking Changes** - Your existing system continues working exactly as before.

#### Option 1: Keep Current Setup (Recommended)
- **No action required** - system continues using Legacy approach
- All existing functionality preserved
- No configuration changes needed

#### Option 2: Enable All Meetings (Optional Enhancement)
1. **Add new environment variable**:
   ```bash
   # Add this to enable All Meetings approach
   TARGET_USER_ID=your-user-id-here
   ```

2. **Test the enhancement**:
   ```bash
   # This will now use All Meetings approach
   curl -X POST https://your-function-url/fetch-transcript
   ```

3. **Monitor logs** for approach selection:
   ```
   🆕 Using ALL MEETINGS approach
   🔄 Using LEGACY approach
   ```

#### Option 3: Gradual Migration
1. **Week 1**: Add `TARGET_USER_ID` but keep it commented out
2. **Week 2**: Enable `TARGET_USER_ID` and monitor logs
3. **Week 3**: Validate All Meetings results vs Legacy results
4. **Week 4**: Full confidence in All Meetings approach

### Testing Your Upgrade

#### Test All Meetings Approach
```bash
# Ensure TARGET_USER_ID is set
export TARGET_USER_ID="50a66395-f31b-4dee-a45e-ef41f3920c9b"

# Test the new functionality
node tests/testFetchAllMeetings.js
```

#### Test Fallback Behavior
```bash
# Temporarily unset TARGET_USER_ID to test Legacy approach
unset TARGET_USER_ID

# Should fall back to Legacy approach
curl -X POST https://your-function-url/fetch-transcript
```

#### Test Both Approaches
```bash
# All Meetings approach (no meetingUrl provided)
curl -X POST https://your-function-url/fetch-transcript

# Force Legacy approach (meetingUrl provided)
curl -X POST https://your-function-url/fetch-transcript \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl": "https://teams.microsoft.com/..."}'
```

### Monitoring & Validation

#### Key Metrics to Monitor
- **Transcript Count**: All Meetings should find more transcripts than Legacy
- **Processing Success Rate**: Should remain high (>95%)
- **Jira Integration**: Should continue working for all transcripts
- **Teams Notifications**: Should include aggregated results

#### Log Patterns to Watch
```
🆕 Using ALL MEETINGS approach
✓ All meetings fetched successfully: 3 transcripts
✓ Processing transcript 1/3: Daily Standup
✓ Processing transcript 2/3: Sprint Planning  
✓ Processing transcript 3/3: Team Retro
🆕 ALL MEETINGS processing completed: 3 successful, 0 failed
```

#### Rollback Plan
If issues occur, simply remove or comment out `TARGET_USER_ID`:
```bash
# In .env file
# TARGET_USER_ID=50a66395-f31b-4dee-a45e-ef41f3920c9b
```
System immediately reverts to Legacy approach.

### Benefits After Migration
- **📈 100% Meeting Coverage**: Never miss transcripts from other meetings
- **🎯 Better Task Tracking**: Capture tasks from all team interactions
- **📊 Comprehensive Reports**: Holistic view of team activities
- **🔄 Maintained Reliability**: Same processing quality with broader scope
