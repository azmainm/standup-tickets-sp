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
**Purpose**: Complete RAG-enhanced 3-stage pipeline processing for each transcript
**Input**: Single transcript + metadata
**Output**: Complete processing result with tasks, status changes, and RAG-enhanced descriptions

#### Sequential Function Flow:

### Step 1: Storage, Embeddings & Context
1. **`storeTranscript()`** - Store raw transcript in MongoDB & generate embeddings
   - **File**: `functions/services/mongoService.js`
   - **Purpose**: Archive complete transcript data
   - **RAG Enhancement**: Automatically calls `generateTranscriptEmbeddings()` after storage

1.5. **`generateTranscriptEmbeddings()`** - Generate transcript embeddings for RAG
   - **File**: `functions/services/transcriptEmbeddingService.js`
   - **Purpose**: Create embeddings and store locally for scoped RAG searches
   - **Storage**: MongoDB `transcript_embeddings` collection + local cache

2. **`getActiveTasks()`** - Retrieve existing tasks for context
   - **File**: `functions/services/mongoService.js`
   - **Purpose**: Get current database state for comparison

### Step 2: 3-Stage Pipeline Processing
4. **`processTranscriptForTasksWithPipeline()`** - Execute 3-stage pipeline
   - **File**: `functions/services/openaiService.js`
   - **Purpose**: Coordinate all three stages

#### Stage 1: Task Finder
5. **`findTasksFromTranscript()`** - Extract all actionable tasks with comprehensive context
   - **File**: `functions/services/taskFinderService.js`
   - **Purpose**: Find and classify tasks with maximum context gathering from ENTIRE transcript
   - **OpenAI Call**: GPT-5-nano with enhanced Task Finder prompt
   - **Enhancement**: Gathers ALL related information for each task from multiple mentions
   - **Returns**: Structured arrays: `tasksToBeCreated` and `tasksToBeUpdated` with rich context

#### Stage 2: Task Creator  
6. **`identifyNewTasks()`** - RAG-enhanced task creation with professional titles
   - **File**: `functions/services/taskCreatorService.js`
   - **Purpose**: Create new tasks with RAG-enhanced descriptions and clean titles
   - **RAG Process**: 
     - **`createRichTaskDescription()`** - Individual RAG calls per task using `ragService.js`
     - **Scoped Search**: Prioritizes local transcript embeddings, falls back to global search
     - **Title Generation**: Creates clean, professional 3-5 word titles without artifacts
   - **Returns**: New tasks with rich descriptions, professional titles, and RAG metadata

#### Stage 3: Task Updater
7. **`updateExistingTasks()`** - RAG-enhanced task updates with comprehensive context
   - **File**: `functions/services/taskUpdaterService.js`
   - **Purpose**: Handle explicit ticket ID updates with RAG-enhanced descriptions
   - **RAG Process**:
     - **`updateTaskWithRAG()`** - Individual RAG calls per update using `ragService.js`
     - **Scoped Context**: Uses current transcript embeddings for relevant context
     - **Date Prefixes**: Adds date stamps in format "(DD/MM/YYYY): description update"
   - **Sub-functions**:
     - **`detectStatusChangesFromTranscript()`** - Find status changes
   - **Returns**: RAG-enhanced task updates and status changes with comprehensive context

### Step 3: Database Operations
8. **`storeTasks()`** - Store new tasks in MongoDB
   - **File**: `functions/services/mongoService.js`
   - **Purpose**: Save new tasks with unique ticket IDs
   - **Sub-functions**:
     - **`getNextTicketId()`** - Generate SP-XXX ticket IDs
     - **`addOrUpdateTaskEmbedding()`** - Create embeddings for future use

9. **Status Change Application** - Apply detected status changes
   - **`updateTaskByTicketId()`** - Update task status in database
   - **File**: `functions/services/mongoService.js`
   - **Purpose**: Apply status changes (To-do → In-progress → Completed)

10. **Task Description Updates** - Apply description updates
    - **`updateTaskByTicketId()`** - Append new information to existing descriptions
    - **File**: `functions/services/mongoService.js`
    - **Purpose**: Add new context with date stamps

### Step 4: Cleanup & Notifications
11. **`clearLocalEmbeddings()`** - Clean up temporary transcript embeddings
    - **File**: `functions/services/localEmbeddingCache.js`
    - **Purpose**: Remove local embedding cache after processing is complete

12. **`generatePipelineSummaryData()`** - Create Teams message data with titles
    - **File**: `functions/services/taskProcessor.js`
    - **Purpose**: Format results for Teams notification using task titles (not full descriptions)

13. **`sendStandupSummaryToTeams()`** - Send concise Teams notification
    - **File**: `functions/services/teamsService.js`
    - **Purpose**: Send structured summary to Teams channel with professional task titles

---

## Phase 3: Completion & Cleanup

### Final Functions:
14. **File Backup** - Save processed transcript locally
    - **File**: Local filesystem in `functions/output/`
    - **Purpose**: Archive for debugging and manual processing

15. **Return Results** - Complete processing result
    - **Includes**: Tasks created, status changes, Teams notification status, RAG metadata
    - **Purpose**: Provide comprehensive processing summary with RAG enhancement metrics

---

## Support Functions (Called Throughout)

### RAG System Functions
**File**: `functions/services/ragService.js`
- **`createRichTaskDescription()`** - Generate RAG-enhanced task descriptions
- **`updateTaskWithRAG()`** - Generate RAG-enhanced task updates
- **LangChain Integration**: Uses ChatOpenAI, ChatPromptTemplate, RunnableSequence

### Transcript Embedding Functions
**File**: `functions/services/transcriptEmbeddingService.js`
- **`generateTranscriptEmbeddings()`** - Create embeddings for transcripts
- **`processTranscriptToVectorStore()`** - Store embeddings in MongoDB and locally
- **`getRAGContextForTask()`** - Retrieve relevant context for task creation/updates

### Local Embedding Cache Functions  
**File**: `functions/services/localEmbeddingCache.js`
- **`storeLocalEmbeddings()`** - Cache embeddings locally for scoped searches
- **`getLocalRAGContext()`** - Retrieve context from local cache
- **`clearLocalEmbeddings()`** - Clean up temporary embeddings after processing

### Vector Database Functions
**File**: `functions/services/vectorService.js` 
- **`isVectorDBAvailable()`** - Check if vector DB is operational
- **`addTaskToVectorDatabase()`** - Store embeddings for new tasks
- **`findSimilarTasks()`** - Search for similar tasks

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
- **OpenAI API Calls**: 3-8 (Task Finder + individual RAG calls per task/update)
- **Embedding Generation**: 1 (transcript embeddings) + per task/update
- **MongoDB Operations**: 8-15 (transcript storage, embeddings, task storage, updates)
- **Local Cache Operations**: 3-5 (store, retrieve, cleanup)
- **Vector DB Operations**: 3-5 (sync + new task embeddings)
- **Teams API Calls**: 1 per transcript

### Performance Metrics:
- **Total Processing Time**: 45-90 seconds per transcript (increased due to RAG processing)
- **Transcript Embedding Generation**: 10-20 seconds (new step)
- **Stage 1 (Task Finder)**: 8-15 seconds (enhanced context gathering)
- **Stage 2 (Task Creator)**: 15-30 seconds (individual RAG calls per task)
- **Stage 3 (Task Updater)**: 8-20 seconds (individual RAG calls per update)
- **Database Operations**: 8-15 seconds (additional embedding storage)
- **Local Cache Cleanup**: 1-2 seconds
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
