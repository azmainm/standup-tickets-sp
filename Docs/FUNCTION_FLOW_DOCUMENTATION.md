# Standup Tickets SP - Function Flow Documentation

## Complete Function Flow: From Inception to Conclusion

This document traces the exact function call sequence from start to finish in the 3-Stage Pipeline system.

---

## Entry Points

### 1. Scheduled Execution (`dailyTranscriptFetch`)
**File**: `functions/index.js`
**Schedule**: Tuesday-Saturday 2:00 AM Bangladesh Time

### 2. Manual HTTP Execution (`transcriptApi`)
**File**: `functions/index.js`
**Endpoint**: `POST /fetch-transcript`

---

## Phase 1: Transcript Fetching

### Entry Function: `fetchAllMeetingsForUser()`
**File**: `functions/services/allMeetingsService.js`
**Purpose**: Orchestrate the complete meeting fetching process
**Returns**: Array of transcript objects with metadata

#### Function Chain:
1. **`getAccessToken()`** - Authenticate with Microsoft Graph API
2. **`fetchCalendarEvents()`** - Get all calendar events for target date
3. **`fetchOnlineMeetingsWithTranscripts()`** - Process each online meeting
   - **`getOnlineMeetingFromJoinUrl()`** - Find meeting object from join URL
   - **`fetchTranscriptsForMeeting()`** - Get all transcripts for meeting
   - **`downloadTranscriptContent()`** - Download VTT content
   - **`convertVttToJson()`** - Convert VTT to structured JSON

---

## Phase 2: Processing Pipeline (Per Transcript)

### Main Orchestrator: `processTranscriptToTasksWithPipeline()`
**File**: `functions/services/taskProcessor.js`
**Purpose**: Complete 3-stage pipeline processing for each transcript
**Input**: Single transcript + metadata
**Output**: Complete processing result with tasks and status changes

#### Sequential Function Flow:

### Step 1: Storage & Sync
1. **`storeTranscript()`** - Store raw transcript in MongoDB
   - **File**: `functions/services/mongoService.js`
   - **Purpose**: Archive complete transcript data

2. **`syncVectorDatabaseWithMongoDB()`** - Sync vector DB with admin changes
   - **File**: `functions/services/vectorService.js`
   - **Purpose**: Update embeddings for manually edited tasks

3. **`getActiveTasks()`** - Retrieve existing tasks for context
   - **File**: `functions/services/mongoService.js`
   - **Purpose**: Get current database state for comparison

### Step 2: 3-Stage Pipeline Processing
4. **`processTranscriptForTasksWithPipeline()`** - Execute 3-stage pipeline
   - **File**: `functions/services/openaiService.js`
   - **Purpose**: Coordinate all three stages

#### Stage 1: Task Finder
5. **`findTasksFromTranscript()`** - Extract all actionable tasks
   - **File**: `functions/services/taskFinderService.js`
   - **Purpose**: Find and classify all tasks with lightweight descriptions
   - **OpenAI Call**: GPT-4o-mini with Task Finder prompt
   - **Returns**: Array of found tasks with categories (NEW_TASK/UPDATE_TASK)

#### Stage 2: Task Creator  
6. **`identifyNewTasks()`** - Determine which tasks are genuinely new
   - **File**: `functions/services/taskCreatorService.js`
   - **Purpose**: Filter for new tasks and generate detailed descriptions
   - **Process**: 
     - Trust Task Finder's NEW_TASK classifications
     - **`generateDetailedTaskDescription()`** - Enhance descriptions using context
   - **Returns**: Filtered new tasks with detailed descriptions

#### Stage 3: Task Updater
7. **`updateExistingTasks()`** - Process task updates and status changes
   - **File**: `functions/services/taskUpdaterService.js`
   - **Purpose**: Handle task updates and status changes
   - **Sub-functions**:
     - **`detectStatusChangesFromTranscript()`** - Find status changes
     - **`generateDetailedUpdateDescription()`** - Create update descriptions
   - **Returns**: Task updates and status changes

### Step 3: Database Operations
8. **`storeTasks()`** - Store new tasks in MongoDB
   - **File**: `functions/services/mongoService.js`
   - **Purpose**: Save new tasks with unique ticket IDs
   - **Sub-functions**:
     - **`getNextTicketId()`** - Generate SP-XXX ticket IDs
     - **`addTaskToVectorDatabase()`** - Create embeddings for new tasks

9. **Status Change Application** - Apply detected status changes
   - **`updateTaskByTicketId()`** - Update task status in database
   - **File**: `functions/services/mongoService.js`
   - **Purpose**: Apply status changes (To-do → In-progress → Completed)

10. **Task Description Updates** - Apply description updates
    - **`updateTaskByTicketId()`** - Append new information to existing descriptions
    - **File**: `functions/services/mongoService.js`
    - **Purpose**: Add new context with date stamps

### Step 4: Notifications
11. **`generatePipelineSummaryData()`** - Create Teams message data
    - **File**: `functions/services/taskProcessor.js`
    - **Purpose**: Format results for Teams notification

12. **`sendStandupSummaryToTeams()`** - Send Teams notification
    - **File**: `functions/services/teamsService.js`
    - **Purpose**: Send structured summary to Teams channel

---

## Phase 3: Completion & Cleanup

### Final Functions:
13. **File Backup** - Save processed transcript locally
    - **File**: Local filesystem in `functions/output/`
    - **Purpose**: Archive for debugging and manual processing

14. **Return Results** - Complete processing result
    - **Includes**: Tasks created, status changes, Teams notification status
    - **Purpose**: Provide comprehensive processing summary

---

## Support Functions (Called Throughout)

### Vector Database Functions
**File**: `functions/services/vectorService.js`
- **`isVectorDBAvailable()`** - Check if vector DB is operational
- **`addTaskToVectorDatabase()`** - Store embeddings for new tasks
- **`findSimilarTasks()`** - Search for similar tasks (currently not used in pipeline)

### MongoDB Functions  
**File**: `functions/services/mongoService.js`
- **`getActiveTasks()`** - Retrieve current tasks
- **`updateTaskByTicketId()`** - Update specific tasks
- **`storeTranscript()`** - Archive raw transcripts
- **`storeTasks()`** - Save new tasks
- **`getNextTicketId()`** - Generate unique ticket IDs

### Status Detection Functions
**File**: `functions/services/statusChangeDetectionService.js`
- **`detectStatusChangesFromTranscript()`** - Parse status change patterns
- **`normalizeTaskId()`** - Standardize ticket ID formats
- **`validateStatusChange()`** - Ensure status change validity

### Teams Integration Functions
**File**: `functions/services/teamsService.js`
- **`sendStandupSummaryToTeams()`** - Send formatted message
- **`formatStandupSummary()`** - Create message structure
- **`testTeamsWebhook()`** - Validate webhook connectivity

---

## Processing Statistics

### Typical Function Call Counts (Per Transcript):
- **OpenAI API Calls**: 3 (Task Finder + Task Creator + Task Updater)
- **MongoDB Operations**: 5-10 (depends on number of tasks and updates)
- **Vector DB Operations**: 3-5 (sync + new task embeddings)
- **Teams API Calls**: 1 per transcript

### Performance Metrics:
- **Total Processing Time**: 30-60 seconds per transcript
- **Stage 1 (Task Finder)**: 8-15 seconds
- **Stage 2 (Task Creator)**: 5-10 seconds  
- **Stage 3 (Task Updater)**: 3-8 seconds
- **Database Operations**: 5-10 seconds
- **Teams Notification**: 1-2 seconds

---

## Error Handling Functions

### Validation Functions:
- **`validateStatusChange()`** - Ensure status changes are valid
- **`testMongoConnection()`** - Verify database connectivity
- **`testOpenAIConnection()`** - Check OpenAI API access
- **`testTeamsWebhook()`** - Validate Teams webhook

### Fallback Mechanisms:
- **Vector DB Fallback**: If vector operations fail, continue without embeddings
- **Teams Notification Fallback**: Log failure but continue processing
- **Status Update Fallback**: Log failures but continue with other updates

---

## Multi-Transcript Processing

When multiple transcripts are found:
1. **Baseline Snapshot**: Capture current database state once
2. **Sequential Processing**: Each transcript follows complete function flow
3. **Context Isolation**: Each transcript uses same baseline for consistency
4. **Independent Results**: Each transcript generates separate Teams notification

**Example with 3 Transcripts**:
```
Transcript 1 → Complete Function Flow → Teams Message 1
Transcript 2 → Complete Function Flow → Teams Message 2  
Transcript 3 → Complete Function Flow → Teams Message 3
```

Each transcript is processed independently with the full function chain above.
