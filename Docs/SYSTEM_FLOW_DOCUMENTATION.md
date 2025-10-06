# Standup Tickets SP - System Flow Documentation

## Overview

The Standup Tickets SP system processes Microsoft Teams meeting transcripts using a **RAG-enhanced 3-Stage Pipeline** to extract actionable tasks with comprehensive context. The system supports two deployment options:

1. **🚀 GitHub Actions** (Recommended) - Runs every 60 minutes, processes meetings from the last 60 minutes
2. **🔧 Firebase Functions** - HTTP endpoints for manual processing and testing

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Standup Tickets SP System                    │
├─────────────────────────────────────────────────────────────────┤
│  ⏰ GitHub Actions Cron (Every 60 minutes)                     │
│  🔧 Firebase HTTP Endpoints (Manual processing)                │
├─────────────────────────────────────────────────────────────────┤
│  📅 Microsoft Graph API → 🧠 3-Stage Pipeline → 💾 MongoDB     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   🔍 Stage 1    │───▶│   📝 Stage 2    │───▶│   🔄 Stage 3    │
│  Task Finder    │    │  Task Creator   │    │  Task Updater   │
│                 │    │   (RAG-Enhanced)│    │  (RAG-Enhanced) │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│Extract tasks    │    │Create new tasks │    │Update existing  │
│with full context│    │with RAG context │    │tasks with RAG   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🚀 3-Stage Pipeline Architecture

### Stage 1: Task Finder 🔍
**Purpose**: Extract actionable tasks with comprehensive context gathering

**Process**:
1. **Context Analysis**: Analyzes the entire transcript for task-related conversations
2. **Evidence Gathering**: Collects ALL related information for each identified task
3. **Structured Output**: Returns `tasksToBeCreated` and `tasksToBeUpdated` arrays
4. **Status Detection**: Identifies status changes mentioned in conversation

**Output Format**:
```javascript
{
  tasksToBeCreated: [
    {
      description: "Implement user authentication system",
      assignee: "John Doe",
      type: "Coding",
      evidence: "John: I'll work on the auth system...",
      context: "Security discussion in standup",
      estimatedTime: 8,
      isFuturePlan: false
    }
  ],
  tasksToBeUpdated: [
    {
      ticketId: "SP-123",
      description: "Update API documentation",
      assignee: "Jane Smith",
      evidence: "Jane: I finished the API docs...",
      updateType: "completion"
    }
  ]
}
```

### Stage 2: Task Creator 📝
**Purpose**: RAG-enhanced task creation with rich descriptions and professional titles

**RAG Enhancement Process**:
1. **Individual RAG Calls**: Each task gets its own context retrieval
2. **Scoped Search**: Prioritizes current transcript embeddings
3. **Context Enrichment**: Enhances descriptions with comprehensive context
4. **Professional Titles**: Generates clean, artifact-free titles (3-5 words)

**RAG Context Sources** (Priority Order):
1. **Local Transcript Embeddings** (Current meeting context)
2. **Global Transcript Embeddings** (Historical meeting context)
3. **Fallback**: Original task description if RAG fails

**Enhanced Output**:
```javascript
{
  "John Doe": {
    "Coding": [
      {
        title: "User Authentication System",
        description: "Implement comprehensive user authentication system with JWT tokens, password hashing, and session management. Based on security requirements discussed in previous meetings, include multi-factor authentication support and OAuth integration with Google and Microsoft. The system should handle user registration, login, logout, and password reset functionality with proper validation and error handling.",
        status: "To-do",
        estimatedTime: 8,
        timeTaken: 0,
        isFuturePlan: false
      }
    ]
  }
}
```

### Stage 3: Task Updater 🔄
**Purpose**: RAG-enhanced task updates with comprehensive context integration

**Update Types**:
1. **Status Changes**: Detected from conversation patterns
2. **Description Updates**: Enhanced with new context from transcript
3. **Progress Updates**: Time tracking and completion status

**RAG Enhancement for Updates**:
1. **Context Retrieval**: Gets relevant context for the specific task
2. **Update Enhancement**: Enriches updates with comprehensive information
3. **Date Prefixing**: Adds timestamps to update descriptions
4. **Scoped Search**: Uses both local and global embeddings

**Update Process**:
```javascript
// Status Change Detection
"SP-123 is completed" → Status: "Completed"

// Description Enhancement via RAG
Original: "Working on API integration"
Enhanced: "[2025-01-15] Completed API integration with third-party services including authentication, data validation, and error handling. Implemented retry logic and rate limiting as discussed in architecture review."
```

## 🔄 Complete Processing Flow

### GitHub Actions Flow (Every 60 Minutes)

```
┌─────────────────┐
│ ⏰ Cron Trigger │
│ (Every 60 min)  │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ 🕐 Calculate    │
│ Time Window     │
│ (Last 60 min)   │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ 📅 Fetch        │
│ Meetings        │
│ (Graph API)     │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ 📝 Filter       │
│ Meetings with   │
│ Transcripts     │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ 🧠 Process      │
│ Each Transcript │
│ (3-Stage)       │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ 💾 Store        │
│ Results         │
│ (MongoDB)       │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ 📢 Send Teams   │
│ Notification    │
└─────────────────┘
```

### Manual Processing Flow (Firebase Functions)

```
┌─────────────────┐
│ 🔧 HTTP Request │
│ /fetch-transcript│
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ 📅 Fetch All    │
│ Meetings        │
│ (Specified Date)│
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ 🧠 Process      │
│ All Transcripts │
│ (3-Stage)       │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ 💾 Store &      │
│ Return Results  │
└─────────────────┘
```

## 🧠 RAG System Architecture

### Embedding Generation Flow

```
┌─────────────────┐
│ 📝 Transcript   │
│ Received        │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ ✂️ Text         │
│ Chunking        │
│ (LangChain)     │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ 🧠 Generate     │
│ Embeddings      │
│ (OpenAI)        │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐    ┌─────────────────┐
│ 💾 Store in     │    │ 🔄 Local Cache  │
│ MongoDB         │    │ (Temporary)     │
└─────────────────┘    └─────────────────┘
```

### RAG Context Retrieval

```
┌─────────────────┐
│ 🔍 Task/Update  │
│ Needs Context   │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ 🎯 Local Search │
│ (Current        │
│  Transcript)    │
└─────────┬───────┘
          │
          ▼ (If insufficient)
┌─────────────────┐
│ 🌐 Global Search│
│ (All Transcript │
│  Embeddings)    │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ 📝 Context      │
│ Enhancement     │
│ (GPT-4)         │
└─────────────────┘
```

## 📊 Data Flow

### Input Data Sources
1. **Microsoft Graph API**
   - Calendar events
   - Online meeting details
   - Meeting transcripts (VTT format)

2. **MongoDB Collections**
   - `sptasks` - Task storage with embeddings
   - `transcripts` - Raw transcript storage
   - `transcript_embeddings` - Transcript embeddings for RAG

### Processing Data Structures

**Task Finder Output**:
```javascript
{
  tasksToBeCreated: Array<TaskToCreate>,
  tasksToBeUpdated: Array<TaskToUpdate>,
  statusChanges: Array<StatusChange>
}
```

**Task Creator Enhancement**:
```javascript
{
  originalDescription: string,
  enhancedDescription: string,
  title: string,
  ragContext: Array<EmbeddingMatch>,
  confidence: "high" | "medium" | "low"
}
```

**Task Updater Enhancement**:
```javascript
{
  taskId: string,
  updateType: "progress" | "completion" | "modification",
  enhancedUpdate: string,
  ragContext: Array<EmbeddingMatch>,
  confidence: number
}
```

### Output Data
1. **New Tasks** - Stored in MongoDB with ticket IDs
2. **Task Updates** - Applied to existing tasks
3. **Status Changes** - Applied to existing tasks
4. **Teams Notification** - Summary sent to webhook
5. **Embeddings** - Generated for new tasks and transcripts

## 🔧 Service Architecture

### Core Services
- **`taskProcessor.js`** - Main orchestrator, coordinates all stages
- **`allMeetingsService.js`** - Microsoft Graph API integration

### Pipeline Services
- **`taskFinderService.js`** - Stage 1: Task extraction with context
- **`taskCreatorService.js`** - Stage 2: RAG-enhanced task creation
- **`taskUpdaterService.js`** - Stage 3: RAG-enhanced task updates
- **`taskMatcher.js`** - Task matching and ID resolution

### Integration Services
- **`openaiService.js`** - OpenAI API integration and pipeline coordination
- **`teamsService.js`** - Teams webhook notifications

### Storage Services
- **`mongoService.js`** - MongoDB operations and task storage
- **`embeddingService.js`** - Task embedding management
- **`transcriptEmbeddingService.js`** - Transcript embedding management
- **`localEmbeddingCache.js`** - Temporary embedding cache

### Utility Services
- **`ragService.js`** - RAG context retrieval and enhancement
- **`statusChangeDetectionService.js`** - Status change pattern detection
- **`assigneeDetectionService.js`** - Intelligent assignee detection

## 🕐 Timing and Scheduling

### GitHub Actions (Recommended)
- **Frequency**: Every 60 minutes (`0 * * * *`)
- **Time Window**: Last 60 minutes in Bangladesh time
- **Meeting Filter**: Both start AND end times within the window
- **Processing**: Only meetings that occurred entirely within the window

### Firebase Functions (Manual)
- **Trigger**: HTTP endpoint or manual execution
- **Time Window**: Specified date (full day)
- **Processing**: All meetings for the specified date

## 📈 Performance Characteristics

### Processing Times
- **Single Meeting**: 30-60 seconds
- **Multiple Meetings**: 1-3 minutes per meeting
- **RAG Enhancement**: 5-10 seconds per task/update

### Resource Usage
- **Memory**: ~200MB per meeting
- **API Calls**: 5-15 per meeting (Graph + OpenAI)
- **Embeddings**: ~10-50 chunks per transcript

### Success Rates
- **Meeting Fetch**: >95% (depends on Graph API availability)
- **Transcript Processing**: >98% (robust error handling)
- **RAG Enhancement**: >90% (fallback to original descriptions)

## 🔍 Monitoring and Logging

### GitHub Actions Monitoring
- Detailed logs in Actions tab
- Success/failure notifications
- Processing statistics in logs
- Error artifacts uploaded on failure

### Firebase Functions Monitoring
- Real-time logs in Firebase Console
- Cloud Logging integration
- Error tracking and alerts
- Performance monitoring

### Key Metrics Tracked
- Meetings found vs processed
- Tasks created vs updated
- RAG enhancement success rate
- Processing duration per stage
- API call success rates
- Embedding generation statistics

## 🚨 Error Handling

### Graceful Degradation
1. **RAG Failures** → Fallback to original descriptions
2. **API Timeouts** → Retry with exponential backoff
3. **Embedding Failures** → Skip enhancement, continue processing
4. **Partial Failures** → Process successful parts, log failures

### Recovery Mechanisms
- Automatic retry for transient failures
- Fallback processing modes
- Comprehensive error logging
- Manual reprocessing capabilities

This system provides robust, scalable transcript processing with intelligent task extraction and enhancement capabilities.