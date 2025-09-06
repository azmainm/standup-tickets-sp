# Standup Tickets SP - System Flow Documentation

## Overview

The Standup Tickets SP system has been enhanced to support **two approaches** for fetching meeting transcripts:

1. **🆕 All Meetings Approach** - Fetches all meetings for a user on a specific date (PRIMARY)
2. **🔄 Legacy Approach** - Fetches transcript from specific meeting URLs (FALLBACK/BACKWARD COMPATIBLE)

The system automatically chooses the appropriate approach based on configuration and gracefully falls back when needed.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Standup Tickets SP System                    │
├─────────────────────────────────────────────────────────────────┤
│  🕐 Scheduled Function (2 AM Bangladesh Time, Tue-Sat)         │
│  🔧 Manual HTTP Endpoint (/fetch-transcript)                   │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Approach Selection Logic                     │
├─────────────────────────────────────────────────────────────────┤
│  IF TARGET_USER_ID configured:                                 │
│    ├─ Try All Meetings Approach                                │
│    └─ Fallback to Legacy if no transcripts found               │
│  ELSE:                                                          │
│    └─ Use Legacy Approach                                       │
└─────────────────────────────────────────────────────────────────┘
                      │                          │
                      ▼                          ▼
    ┌─────────────────────────┐    ┌─────────────────────────┐
    │   🆕 All Meetings       │    │   🔄 Legacy Approach    │
    │     Approach            │    │                         │
    └─────────────────────────┘    └─────────────────────────┘
                      │                          │
                      ▼                          ▼
    ┌─────────────────────────┐    ┌─────────────────────────┐
    │  Multiple Transcripts   │    │   Single Transcript     │
    │  (Process Each)         │    │                         │
    └─────────────────────────┘    └─────────────────────────┘
                      │                          │
                      └──────────┬───────────────┘
                                 ▼
              ┌─────────────────────────────────────┐
              │        Processing Pipeline          │
              │   (Each Transcript Individually)    │
              └─────────────────────────────────────┘
                                 │
                                 ▼
    ┌─────────────────────────────────────────────────────────────┐
    │            Processing Steps (Per Transcript)                │
    ├─────────────────────────────────────────────────────────────┤
    │  1. 📁 Store Raw Transcript in MongoDB                     │
    │  2. 🤖 OpenAI Processing (Extract Tasks)                   │
    │  3. 🔍 Task Matching (Find Existing Tasks)                 │
    │  4. 📝 Update Existing Tasks in MongoDB                    │
    │  5. 💾 Store New Tasks in MongoDB                          │
    │  6. ⏭️  Jira Integration Skipped (Removed from Main Flow)  │
    │  7. 📢 Send Teams Notification (THIS TRANSCRIPT)           │
    │  8. 📁 Save Backup Files                                   │
    └─────────────────────────────────────────────────────────────┘
```

## Detailed Flow

### 1. Entry Points

The system has two main entry points:

#### A. Scheduled Function (`dailyTranscriptFetch`)
- **Schedule**: Tuesday-Saturday at 2:00 AM Bangladesh time
- **Purpose**: Automatically fetch previous day's transcripts
- **Target Date Logic**: If running 0-6 AM, fetch previous day's meetings
- **Approach**: ALL MEETINGS ONLY (no Legacy fallback in current implementation)

#### B. Manual HTTP Endpoint (`/fetch-transcript`)
- **Method**: POST
- **URL**: `/fetch-transcript`
- **Purpose**: On-demand transcript fetching
- **Parameters**: Optional `meetingUrl` to force legacy approach

### 2. Approach Selection Logic

```javascript
// Current Implementation in index.js
if (process.env.TARGET_USER_ID) {
    // Use All Meetings Approach ONLY
    // No fallback to Legacy in current implementation
    allTranscripts = await fetchAllMeetingsForUser(TARGET_USER_ID, targetDate);
} else {
    // Throw error - TARGET_USER_ID required
    throw new Error("TARGET_USER_ID environment variable must be set");
}
```

### 3. All Meetings Approach (🆕 PRIMARY)

#### Environment Requirements
- `TARGET_USER_ID`: Microsoft user ID to fetch calendar for
- `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_AUTHORITY`: Azure app credentials

#### Process Flow
1. **Calendar Fetch**: Get all calendar events for target date
   ```
   GET /users/{TARGET_USER_ID}/calendarView?startDateTime={date}T00:00:00Z&endDateTime={date}T23:59:59Z
   ```
2. **Filter Online Meetings**: Find events with `isOnlineMeeting = true`
3. **Meeting Discovery**: For each online meeting:
   - Extract `joinUrl` from calendar event
   - Find corresponding `onlineMeeting` object using `joinUrl`
   - Fetch all transcripts for that meeting
4. **Date Filtering**: Only include transcripts created on target date
5. **Download & Parse**: Download VTT content and convert to JSON
6. **Individual Processing**: Each transcript goes through complete processing pipeline

#### File Naming Convention
```
{targetDate}_{timestamp}_{meetingSubject}_transcript_{index}.json
```
Example: `2025-11-05_2025-11-05T09-00-00_Daily_Stand_Up_transcript_1.json`

### 4. Legacy Approach (🔄 FALLBACK - Not Currently Used)

#### Environment Requirements
- `DAILY_STANDUP_URL_MWF`: Meeting URL for Monday/Wednesday/Friday
- `DAILY_STANDUP_URL_TT`: Meeting URL for Tuesday/Thursday
- `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_AUTHORITY`: Azure app credentials

#### Process Flow (Historical)
1. **URL Selection**: Choose appropriate URL based on day of week
2. **Meeting Discovery**: Extract organizer OID from URL context
3. **Transcript Fetch**: Get latest transcript for that specific meeting
4. **Single Processing**: Process the one transcript through complete pipeline

**Note**: Legacy approach is maintained in codebase but not actively used in current deployment.

### 5. Processing Pipeline (Applied to Each Transcript INDIVIDUALLY)

**🚨 CRITICAL**: Every transcript (from every meeting) goes through the complete processing pipeline separately. This means:
- 3 meetings found = 3 separate processing cycles
- 3 separate MongoDB storage operations
- 3 separate Jira integrations
- 3 separate Teams notifications

#### Step 1: Raw Transcript Storage
- Store complete transcript in MongoDB `transcripts` collection
- Include metadata: meeting ID, transcript ID, entry count, date, meeting subject

#### Step 2: OpenAI Processing
- Send transcript to GPT-4o-mini for task extraction
- Extract tasks by participant with status, time estimates, descriptions
- Categorize as "Coding" or "Non-Coding"
- Identify task types: NEW TASK vs EXISTING TASK UPDATE vs STATUS CHANGE vs FUTURE PLAN
- Detect future plan language and assign to "TBD" with isFuturePlan: true

#### Step 3: Task Matching
- Retrieve existing active tasks from database
- Use AI similarity matching to identify task updates vs new tasks
- Determine which tasks to create vs update

#### Step 4: Database Updates
- Update existing tasks with new information
- Add progress updates and status changes
- Update time tracking (estimated time, time spent)

#### Step 5: New Task Storage
- Store only new tasks in MongoDB `sptasks` collection
- Assign unique ticket IDs (SP-1, SP-2, etc.)
- Generate AI-created titles for tasks

#### Step 6: Jira Integration (Removed from Main Flow)
- **Note**: Jira integration has been removed from the main processing flow
- `jiraService.js` is kept intact for future reuse if needed
- No Jira issues are created automatically anymore
- Task processing continues without Jira integration

#### Step 7: Teams Notification (PER TRANSCRIPT)
- Generate standup summary for THIS SPECIFIC transcript/meeting
- Include new and updated tasks from this meeting only
- Include "Future Plans discussed in this meeting" section if any future plans detected
- Send immediately to configured Teams webhook
- **Result**: Multiple Teams messages (one per meeting)

#### Step 8: File Backup
- Save processed transcript to local file system
- Used for debugging and manual processing

## Real-World Example: Multiple Meetings Scenario

### Scenario: November 6th 2 AM Processing (Nov 5th meetings)

**Meetings Found:**
1. Daily Standup (9:00 AM Nov 5th) - 5 participants, 15 minutes
2. Sprint Planning (2:00 PM Nov 5th) - 6 participants, 60 minutes  
3. Team Retro (4:00 PM Nov 5th) - 4 participants, 30 minutes

**Processing Flow:**

```
📋 Processing Meeting 1: "Daily Standup"
├─ MongoDB: Store transcript → transcripts collection
├─ OpenAI: Extract 5 tasks (3 coding, 2 non-coding)
├─ Task Matching: 2 existing task updates, 3 new tasks
├─ MongoDB: Update 2 existing tasks + Store 3 new tasks (SP-77, SP-78, SP-79)
├─ Jira: Skipped (removed from main flow)
├─ Teams: Send summary for Daily Standup
│   "📋 Daily Standup Summary - Nov 5th
│    John: New Tasks: SP-77: Auth System (Coding)
│    Jane: Updated Tasks: SP-45: Bug Fix (Coding)
│    Future Plans discussed in this meeting:
│    1. SP-78: Mobile App Development (Coding)"
└─ Files: Save daily_standup_transcript.json

📋 Processing Meeting 2: "Sprint Planning"  
├─ MongoDB: Store transcript → transcripts collection
├─ OpenAI: Extract 12 tasks (8 coding, 4 non-coding)
├─ Task Matching: 3 existing task updates, 9 new tasks
├─ MongoDB: Update 3 existing tasks + Store 9 new tasks (SP-80 to SP-88)
├─ Jira: Skipped (removed from main flow)
├─ Teams: Send summary for Sprint Planning
│   "📋 Daily Standup Summary - Nov 5th
│    John: New Tasks: SP-80: API Design (Coding), SP-81: Testing (Non-Coding)
│    Jane: New Tasks: SP-82: Frontend (Coding), SP-83: Database (Coding)"
└─ Files: Save sprint_planning_transcript.json

📋 Processing Meeting 3: "Team Retro"
├─ MongoDB: Store transcript → transcripts collection
├─ OpenAI: Extract 3 tasks (1 coding, 2 non-coding) 
├─ Task Matching: 1 existing task update, 2 new tasks
├─ MongoDB: Update 1 existing task + Store 2 new tasks (SP-89, SP-90)
├─ Jira: Skipped (removed from main flow)
├─ Teams: Send summary for Team Retro
│   "📋 Daily Standup Summary - Nov 5th
│    Sarah: New Tasks: SP-89: Process Improvement (Non-Coding)"
└─ Files: Save team_retro_transcript.json
```

**Final Results:**
- **3 MongoDB transcript documents** stored
- **14 new tasks** created with ticket IDs SP-77 through SP-90
- **6 existing tasks** updated
- **3 Teams notifications** sent (one per meeting)
- **3 backup files** saved

## Configuration

### Required Environment Variables

#### Core Azure Configuration
```bash
AZURE_CLIENT_ID=your-azure-app-client-id
AZURE_CLIENT_SECRET=your-azure-app-client-secret
AZURE_AUTHORITY=https://login.microsoftonline.com/your-tenant-id
```

#### All Meetings Approach (REQUIRED)
```bash
TARGET_USER_ID=50a66395-f31b-4dee-a45e-ef41f3920c9b
```

#### Processing Configuration
```bash
OPENAI_API_KEY=your-openai-api-key
MONGODB_URI=mongodb+srv://...
TEAMS_WEBHOOK_URL=https://your-teams-webhook-url

# Jira Configuration (Optional - removed from main flow)
# JIRA_URL=https://your-domain.atlassian.net/
# JIRA_EMAIL=your-email@domain.com
# JIRA_API_TOKEN=your-jira-api-token
# JIRA_PROJECT_KEY=YOUR_PROJECT_KEY
```

#### Legacy Configuration (Maintained but Not Used)
```bash
DAILY_STANDUP_URL_MWF=https://teams.microsoft.com/...
DAILY_STANDUP_URL_TT=https://teams.microsoft.com/...
```

## Teams Integration Details

### Message Format Per Meeting
Each meeting generates a separate Teams notification:

```
📋 Daily Standup Summary
Standup Date: 05/11/2025

**John Doe:**
New Tasks
1. SP-77: Implement user authentication (Coding)
2. SP-78: Update documentation (Non-Coding)

Updated Tasks
1. SP-45: Fix login bug (Coding)

**Jane Smith:**
New Tasks
1. SP-79: Refactor database queries (Coding)

**Future Plans discussed in this meeting:**
1. SP-80: Mobile app development (Coding)
2. SP-81: API versioning system (Non-Coding)

Please check Admin Panel to see the new and updated tasks.
```

### Multiple Meeting Notifications
- **Teams receives 3 separate messages** (not consolidated)
- Each message contains only tasks from that specific meeting
- Messages sent immediately after each transcript is processed
- Time gap between messages: ~30-60 seconds depending on processing time

### Webhook Configuration
```bash
TEAMS_WEBHOOK_URL=https://your-teams-channel-webhook-url
```

If not configured:
```
⚠️ TEAMS_WEBHOOK_URL environment variable not set, skipping Teams notification
```

## Logging and Monitoring

### Log Prefixes for Easy Identification
- `🆕` All Meetings Approach activities
- `📋` Individual transcript processing
- `🤖` OpenAI processing steps
- `💾` MongoDB storage operations
- `🎫` Jira integration activities
- `📢` Teams notification activities

### Key Metrics Logged Per Transcript
- Number of entries in transcript
- Tasks extracted (new vs updated)
- MongoDB storage success/failure
- Jira issues created/failed
- Teams notification success/failure
- Processing duration

### Sample Log Output
```
🆕 Starting daily transcript fetch - All Meetings approach
✓ All meetings fetched successfully: 3 transcripts

📋 Processing transcript 1/3: Daily Standup
🤖 OpenAI processing: 5 tasks extracted
💾 MongoDB: 3 new tasks stored (SP-77, SP-78, SP-79)
🎫 Jira: 2 issues created successfully
📢 Teams: Summary sent successfully
✓ Transcript 1 processed in 12.3s

📋 Processing transcript 2/3: Sprint Planning
🤖 OpenAI processing: 12 tasks extracted
💾 MongoDB: 9 new tasks stored (SP-80 to SP-88) 
🎫 Jira: 7 issues created successfully
📢 Teams: Summary sent successfully
✓ Transcript 2 processed in 18.7s

📋 Processing transcript 3/3: Team Retro
🤖 OpenAI processing: 3 tasks extracted
💾 MongoDB: 2 new tasks stored (SP-89, SP-90)
🎫 Jira: 1 issue created successfully
📢 Teams: Summary sent successfully
✓ Transcript 3 processed in 8.2s

🆕 ALL MEETINGS processing completed: 3 successful, 0 failed
```

## Error Handling

### Individual Transcript Failures
- One transcript failure doesn't stop others
- Each transcript is processed independently
- Failed transcripts are logged with detailed error information
- System continues processing remaining transcripts

### Service Failure Handling
- **MongoDB failure**: Transcript still processed, local backup saved
- **Jira failure**: Tasks still stored in MongoDB, Teams notification still sent
- **Teams failure**: Other processing continues, failure logged
- **OpenAI failure**: Raw transcript stored, processing stopped for that transcript

### Graceful Degradation
- Missing `TEAMS_WEBHOOK_URL`: Skip Teams notifications, continue processing
- Jira permission issues: Continue with task storage, log Jira failures
- Network timeouts: Retry mechanisms with exponential backoff

## Benefits of Current Architecture

1. **📈 Complete Coverage**: Captures all meetings, not just specific ones
2. **🔄 Independent Processing**: Each meeting processed separately for reliability
3. **🛡️ Fault Tolerance**: Individual failures don't affect other transcripts
4. **🔍 Detailed Visibility**: Per-meeting tracking and reporting
5. **⚡ Real-time Notifications**: Immediate Teams updates per meeting
6. **🎯 Comprehensive Tracking**: Every team interaction captured and processed
7. **📊 Rich Reporting**: Detailed metrics per meeting and overall

## Migration Notes

### Current State
- **All Meetings Approach**: Primary and only approach in use
- **Legacy Approach**: Code maintained but not actively used
- **Backward Compatibility**: Environment variables supported but not required

### Future Considerations
- Could re-enable Legacy fallback if needed
- Could implement consolidated Teams notifications (single message for all meetings)
- Could add filtering to process only specific meeting types
- Could add time-based processing rules (e.g., only process meetings > 10 minutes)

## Deployment Architecture

### Firebase Functions
- **Memory**: 256MiB per function execution
- **Timeout**: 300 seconds (5 minutes)
- **Concurrency**: Max 10 instances to control costs
- **Schedule**: Cron `"0 2 * * 2-6"` (Tuesday-Saturday 2 AM Bangladesh)

### Database Structure
- **MongoDB Collections**: 
  - `transcripts`: Raw transcript data with metadata
  - `sptasks`: Processed tasks with ticket IDs
  - `counters`: Ticket ID counter for SP-XX sequence
- **Jira Project**: Configured project with Task issue type
- **Teams Channel**: Webhook-enabled channel for notifications

### Security
- **Azure App Registration**: Client credentials flow for Microsoft Graph
- **MongoDB Atlas**: IP whitelisting and user permissions
- **Jira API**: Token-based authentication with project permissions
- **Teams Webhook**: Channel-specific webhook URL

This comprehensive system ensures complete task tracking across all team meetings while maintaining reliability, visibility, and ease of monitoring.
