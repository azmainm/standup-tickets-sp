# Standup Tickets SP - Function Flow Documentation

## Complete Function Flow: From Inception to Conclusion

This document traces the exact function call sequence from start to finish in the RAG-enhanced 4-Stage Pipeline system with attendees extraction and meeting notes generation.

---

## Entry Points

### 1. GitHub Actions Cron (Recommended)
**File**: `functions/scripts/githubActionsCron.js`
**Schedule**: Every 60 minutes (`0 * * * *`)
**Time Window**: Last 60 minutes in Bangladesh time

### 2. Firebase HTTP Endpoint (Manual)
**File**: `functions/index.js`
**Endpoint**: `POST /fetch-transcript`
**Time Window**: Specified date (full day)

---

## Phase 1: Meeting Discovery & Transcript Fetching

### Entry Function: `fetchAllMeetingsForUser()`
**File**: `functions/services/integrations/allMeetingsService.js`
**Purpose**: Orchestrate the complete meeting fetching process
**Returns**: Array of meetings with transcript data and metadata

#### Function Chain:
1. **`getAccessToken()`** - Authenticate with Microsoft Graph API
2. **`fetchCalendarEvents()`** - Get calendar events for time window
3. **`fetchOnlineMeetingsWithTranscripts()`** - Process each online meeting
   - **`getOnlineMeetingFromJoinUrl()`** - Find meeting object from join URL
   - **`fetchTranscriptsForMeeting()`** - Get all transcripts for meeting
   - **`downloadTranscriptContent()`** - Download VTT content
   - **`convertVttToJson()`** - Convert VTT to structured JSON

**Time Window Support**:
- **GitHub Actions**: Custom time window (last 60 minutes)
- **Manual Processing**: Full day processing

---

## Phase 2: RAG-Enhanced 4-Stage Pipeline Processing

### Main Orchestrator: `processTranscriptToTasksWithPipeline()`
**File**: `functions/services/core/taskProcessor.js`
**Purpose**: Complete RAG-enhanced 4-stage pipeline processing with attendees extraction and meeting notes generation
**Input**: Single transcript + metadata
**Output**: Processing result with tasks, updates, RAG enhancements, attendees, and meeting notes

#### Sequential Function Flow:

### Step 1: Transcript Storage & Embedding Generation
1. **`storeTranscript()`** - Store raw transcript in MongoDB
   - **File**: `functions/services/storage/mongoService.js`
   - **Purpose**: Store transcript and generate embeddings immediately
   - **Calls**: `generateTranscriptEmbeddings()` automatically

2. **`generateTranscriptEmbeddings()`** - Create embeddings for RAG
   - **File**: `functions/services/storage/transcriptEmbeddingService.js`
   - **Purpose**: Generate embeddings using `text-embedding-3-small`
   - **Storage**: MongoDB `transcript_embeddings` collection

3. **`storeLocalEmbeddings()`** - Cache embeddings locally
   - **File**: `functions/services/storage/localEmbeddingCache.js`
   - **Purpose**: Temporary cache for scoped RAG searches

### Step 2: Context Preparation
4. **`getActiveTasks()`** - Retrieve existing tasks for context
   - **File**: `functions/services/storage/mongoService.js`
   - **Purpose**: Provide context for task matching and updates

---

## Phase 3: Enhanced 4-Stage Pipeline Execution

### Stage 1: Task Finder 🔍 + Attendees Extraction
**Entry**: `processTranscriptForTasksWithPipeline()`
**File**: `functions/services/integrations/openaiService.js`

#### Function Chain:
1. **`findTasksFromTranscript()`** - Extract tasks with context and attendees
   - **File**: `functions/services/pipeline/taskFinderService.js`
   - **Purpose**: Comprehensive task extraction with evidence gathering and attendees identification
   - **Output**: `tasksToBeCreated`, `tasksToBeUpdated` arrays, and `attendees` string
   - **🆕 Attendees Processing**: `extractAttendeesFromResponse()` extracts participant initials

2. **`detectStatusChangesFromTranscript()`** - Find status changes
   - **File**: `functions/services/utilities/statusChangeDetectionService.js`
   - **Purpose**: Pattern-based status change detection
   - **Patterns**: "SP-XXX is completed", "finished SP-XXX", etc.

### Stage 2: Task Creator 📝
**Entry**: `identifyNewTasks()`
**File**: `functions/services/pipeline/taskCreatorService.js`

#### RAG-Enhanced Creation Flow:
1. **`createRichTaskDescription()`** - RAG enhancement per task
   - **File**: `functions/services/utilities/ragService.js`
   - **Purpose**: Individual RAG calls for each task
   - **Process**:
     - `getLocalRAGContext()` - Search local transcript embeddings
     - `getRAGContextForTask()` - Fallback to global embeddings if needed
     - Context enhancement via GPT-4

2. **Task Processing**:
   - Professional title generation (3-5 words)
   - Rich description creation with full context
   - Assignee detection and validation
   - Future plan identification

### Stage 3: Task Updater 🔄
**Entry**: `updateExistingTasks()`
**File**: `functions/services/pipeline/taskUpdaterService.js`

#### RAG-Enhanced Update Flow:
1. **Explicit ID Matching** - Direct task updates via ticket IDs
2. **`createRichTaskDescription()`** - RAG enhancement per update
   - Same RAG process as Task Creator
   - Date-prefixed descriptions
   - Comprehensive context integration

---

## Phase 4: Data Storage & Persistence

### Task Storage
1. **`storeTasks()`** - Store new tasks in MongoDB
   - **File**: `functions/services/storage/mongoService.js`
   - **Process**: 
     - Generate ticket IDs
     - Store task data
     - Create task embeddings automatically

2. **`generateEmbeddingsForNewTasks()`** - Task embeddings
   - **File**: `functions/services/pipeline/taskCreatorService.js`
   - **Purpose**: Generate embeddings for similarity matching

### Task Updates
3. **`updateTaskByTicketId()`** - Apply status changes
   - **File**: `functions/services/storage/mongoService.js`
   - **Purpose**: Update existing tasks with new status/descriptions

4. **`updateEmbeddingsForModifiedTasks()`** - Update embeddings
   - **File**: `functions/services/pipeline/taskUpdaterService.js`
   - **Purpose**: Refresh embeddings for updated tasks

---

## Phase 4: Meeting Notes Generation & Storage

### 🆕 Stage 4: Meeting Notes Generation 📋
1. **`generateMeetingNotes()`** - Generate comprehensive meeting notes
   - **File**: `functions/services/pipeline/meetingNotesService.js`
   - **Purpose**: AI-powered meeting summarization with structured sections
   - **Input**: Transcript, created tasks, updated tasks, attendees
   - **Output**: Structured meeting notes with sections for summary, discussions, decisions, tasks

2. **`updateTranscriptWithNotesAndAttendees()`** - Store notes and attendees
   - **File**: `functions/services/storage/mongoService.js`
   - **Purpose**: Update transcript document with meeting notes and attendees information
   - **Storage**: Adds `meeting_notes`, `attendees`, and `notes_generated_at` fields

---

## Phase 5: Notification & Cleanup

### Teams Notification
1. **`generatePipelineSummaryData()`** - Create summary
   - **File**: `functions/services/core/taskProcessor.js`
   - **Purpose**: Aggregate results for Teams notification

2. **`sendStandupSummaryToTeams()`** - Send notification
   - **File**: `functions/services/integrations/teamsService.js`
   - **Content**: New tasks, updates, status changes, participants, attendees
   - **🆕 Test Mode Support**: Includes test run indicators when in test mode

### Cleanup
3. **`clearLocalEmbeddings()`** - Clean temporary cache
   - **File**: `functions/services/storage/localEmbeddingCache.js`
   - **Purpose**: Remove temporary embeddings after processing

---

## Detailed Function Specifications

### Core Processing Functions

#### `processTranscriptToTasksWithPipeline()`
```javascript
// Input
transcript: Array<TranscriptEntry>
transcriptMetadata: Object
processingContext: Object
processingOptions: Object

// Output
{
  success: boolean,
  tasks: Object,              // New tasks by participant
  pipelineResults: {
    stage1: { foundTasks, statusChanges, attendees },
    stage2: { newTasks, ragEnhancements },
    stage3: { taskUpdates, ragEnhancements },
    stage4: { meetingNotes, notesMetadata }
  },
  summary: {
    newTasksCreated: number,
    existingTasksUpdated: number,
    statusChangesApplied: number
  }
}
```

#### `findTasksFromTranscript()`
```javascript
// Input
transcript: Array<TranscriptEntry>
existingTasks: Array<Task>
processingContext: Object

// Output
{
  tasksToBeCreated: Array<TaskToCreate>,
  tasksToBeUpdated: Array<TaskToUpdate>,
  metadata: {
    totalTasks: number,
    averageDescriptionLength: number
  }
}
```

#### `createRichTaskDescription()`
```javascript
// Input
taskInfo: {
  description: string,
  assignee: string,
  type: string,
  evidence: string
}
options: {
  topK: number,
  scoreThreshold: number
}

// Output
{
  title: string,              // Professional 3-5 word title
  description: string,        // RAG-enhanced description
  ragUsed: boolean,
  confidence: "high" | "medium" | "low",
  sourcesUsed: number,
  isScoped: boolean          // Used local vs global embeddings
}
```

### RAG System Functions

#### `getLocalRAGContext()`
```javascript
// Purpose: Search current transcript embeddings
// Priority: Local context over global
// Fallback: Global search if insufficient local results
```

#### `getRAGContextForTask()`
```javascript
// Purpose: Search all transcript embeddings
// Use case: Fallback when local context insufficient
// Enhancement: Comprehensive context from all meetings
```

### Status Change Detection

#### `detectStatusChangesFromTranscript()`
```javascript
// Patterns Detected:
// - "SP-XXX is completed"
// - "finished SP-XXX"
// - "SP-XXX is in progress"
// - "working on SP-XXX"

// Output:
Array<{
  taskId: string,
  newStatus: string,
  speaker: string,
  confidence: number,
  evidence: string
}>
```

---

## Error Handling & Fallbacks

### RAG Fallback Chain
1. **Local Embeddings** → Current transcript context
2. **Global Embeddings** → All transcript context
3. **Original Description** → No enhancement if RAG fails

### Processing Fallbacks
1. **API Failures** → Retry with exponential backoff
2. **Embedding Failures** → Skip enhancement, continue processing
3. **Partial Failures** → Process successful parts, log failures

### Recovery Mechanisms
- Comprehensive error logging at each stage
- Graceful degradation for non-critical failures
- Manual reprocessing capabilities
- Test mode for debugging without data persistence

---

## Performance Optimization

### Parallel Processing
- Multiple transcript processing (when applicable)
- Concurrent RAG calls for multiple tasks
- Batch embedding generation

### Caching Strategy
- Local embedding cache for current transcript
- Persistent task embeddings in MongoDB
- Access token caching for Graph API

### Resource Management
- Memory cleanup after processing
- Connection pooling for MongoDB
- Rate limiting for OpenAI API calls

This function flow ensures robust, scalable processing with intelligent task extraction and RAG-enhanced descriptions while maintaining high performance and reliability.