# Standup Tickets SP - Automated Meeting Transcript Processor

This project automatically processes Microsoft Teams meeting transcripts using a **3-Stage Pipeline** to extract actionable tasks with enhanced context and stores the results in MongoDB. The system can run as **GitHub Actions cron jobs**.

## 🚀 Enhanced 3-Stage Pipeline Architecture

The system features a **RAG-enhanced 3-stage processing pipeline** with transcript embeddings, intelligent context retrieval, and comprehensive meeting analysis:

### Stage 1: Task Finder 🔍
- **Purpose**: Extract actionable tasks with comprehensive context gathering
- **Role**: Analytical task detection with evidence-based extraction
- **Output**: Structured arrays of `tasksToBeCreated` and `tasksToBeUpdated` with rich context
- **Enhancement**: Gathers ALL related information from the entire transcript for each task
- **🆕 Attendees Extraction**: Automatically identifies and extracts meeting attendees' initials from transcript

### Stage 2: Task Creator 📝
- **Purpose**: RAG-enhanced task creation with rich descriptions and professional titles
- **Intelligence**: Individual RAG calls per task for enhanced descriptions using transcript embeddings
- **Features**: 
  - Scoped embedding search prioritizing current transcript context
  - Professional, artifact-free task titles (3-5 words)
  - Comprehensive task descriptions with full context

### Stage 3: Task Updater 🔄
- **Purpose**: RAG-enhanced task updates with comprehensive context integration
- **Features**: 
  - Scoped RAG calls for each update using transcript embeddings
  - Date-prefixed descriptions for better history tracking
  - Intelligent status change detection and application

### 🆕 Stage 4: Meeting Notes Generation 📝
- **Purpose**: Generate comprehensive meeting notes using AI
- **Intelligence**: LLM-powered summarization of discussions, decisions, and outcomes
- **Features**:
  - Structured meeting notes with clear sections
  - Task creation and update summaries
  - Key discussion points and decisions made
  - Next steps and action items identification

## 🎯 Key Features

### RAG-Enhanced Processing
- **Transcript Embeddings**: Automatic embedding generation using `text-embedding-3-small`
- **Scoped RAG Search**: Local embedding cache prioritizes current transcript context
- **Dual Embedding System**: Both transcript and task embeddings for comprehensive context
- **Intelligent Context Retrieval**: Fallback from local to global embeddings

### Smart Task Management
- **Status Change Detection**: Automatic detection of task status updates from conversation
- **Explicit ID Matching**: Direct task updates using ticket IDs mentioned in transcripts
- **Assignee Detection**: Intelligent assignment based on conversation context
- **Future Plans Detection**: Separate handling of future/TBD tasks
- **Time Tracking**: Automatic extraction of estimated time from conversation
- **🆕 Attendees Tracking**: Automatic extraction of meeting participants' initials
- **🆕 Meeting Documentation**: AI-generated comprehensive meeting notes and summaries

### Flexible Deployment Options
- **GitHub Actions** (Recommended): Runs every 60 minutes, processes meetings that ended in the last 60 minutes
- **Firebase Functions**: HTTP endpoints for manual processing and testing

## 🏗️ Architecture Overview

### Service Organization
```
functions/services/
├── core/
│   └── taskProcessor.js          # Main orchestrator
├── pipeline/
│   ├── taskFinderService.js      # Stage 1: Task extraction + attendees
│   ├── taskCreatorService.js     # Stage 2: Task creation with RAG
│   ├── taskUpdaterService.js     # Stage 3: Task updates with RAG
│   ├── meetingNotesService.js    # Stage 4: Meeting notes generation
│   └── taskMatcher.js            # Task matching logic
├── integrations/
│   ├── allMeetingsService.js     # Microsoft Graph API integration
│   ├── jiraService.js            # Jira API integration
│   ├── openaiService.js          # OpenAI API integration
│   └── teamsService.js           # Teams webhook notifications
├── storage/
│   ├── mongoService.js           # MongoDB operations
│   ├── embeddingService.js       # Task embeddings
│   ├── transcriptEmbeddingService.js # Transcript embeddings
│   └── localEmbeddingCache.js    # Temporary embedding cache
└── utilities/
    ├── ragService.js             # RAG context retrieval
    ├── statusChangeDetectionService.js # Status detection
    └── assigneeDetectionService.js     # Assignee detection
```

## 🚀 Quick Start

### Option 1: GitHub Actions (Recommended)

1. **Fork/Clone Repository**
2. **Set GitHub Secrets** (Repository Settings → Secrets and variables → Actions):
   ```
   AZURE_CLIENT_ID          # Azure App Registration Client ID
   AZURE_CLIENT_SECRET      # Azure App Registration Secret
   AZURE_AUTHORITY          # https://login.microsoftonline.com/your-tenant-id
   TARGET_USER_ID           # Microsoft Graph User ID
   OPENAI_API_KEY          # OpenAI API Key
   MONGODB_URI             # MongoDB connection string
   TEAMS_WEBHOOK_URL       # Teams webhook (optional)
   JIRA_URL                # Jira instance URL (optional)
   JIRA_EMAIL              # Jira account email (optional)
   JIRA_API_TOKEN          # Jira API token (optional)
   JIRA_PROJECT_KEY        # Jira project key (optional)
   ```
3. **Enable GitHub Actions** - The workflow runs automatically every 60 minutes
4. **Manual Testing** - Go to Actions tab → "Transcript Processor Cron Job" → "Run workflow"

### Option 2: Firebase Functions

1. **Install Firebase CLI**
   ```bash
   npm install -g firebase-tools
   firebase login
   ```

2. **Configure Environment**
   ```bash
   cd functions
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Install Dependencies**
   ```bash
   npm install
   ```

4. **Deploy**
   ```bash
   firebase deploy --only functions
   ```

## 🔧 Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `AZURE_CLIENT_ID` | Azure App Registration Client ID | `378ec236-171c-4eb8-bcf1-5cdf39...` |
| `AZURE_CLIENT_SECRET` | Azure App Registration Secret | `dwo8Q~...` |
| `AZURE_AUTHORITY` | Azure Authority URL | `https://login.microsoftonline.com/tenant-id` |
| `TARGET_USER_ID` | Microsoft Graph User ID | `50a66395-f31b-4dee-a...` |
| `OPENAI_API_KEY` | OpenAI API Key | `sk-proj-...` |
| `MONGODB_URI` | MongoDB Connection String | `mongodb+srv://user:pass@cluster...` |
| `TEAMS_WEBHOOK_URL` | Teams Webhook URL (optional) | `https://outlook.office.com/webhook/...` |
| `JIRA_URL` | Jira instance URL (optional) | `https://yourcompany.atlassian.net` |
| `JIRA_EMAIL` | Jira account email (optional) | `your-email@company.com` |
| `JIRA_API_TOKEN` | Jira API token (optional) | `ATATT3xFfGF0...` |
| `JIRA_PROJECT_KEY` | Jira project key (optional) | `TRADES`, `PROJ` |

### Azure App Registration Permissions

Your Azure app needs these Microsoft Graph permissions:
- `Calendars.Read` - Read calendar events
- `OnlineMeetings.Read` - Read meeting details
- `CallRecords.Read.All` - Read call transcripts

## 🧪 Testing

### Local Testing
```bash
cd functions

# Test with fake transcript data (includes time tracking)
npm run test:fake-flow

# Test with real Microsoft Graph data
npm run test:real-flow

# Test GitHub Actions cron job locally
npm run test:github-actions
```

### Time Tracking Test
The `test:fake-flow` script includes comprehensive time tracking testing:
- Tests time extraction patterns for new tasks
- Validates time tracking for tasks
- Displays time tracking summaries
- Shows time information in task lists

### Manual Processing (Firebase Functions)
```bash
# Process specific date
curl -X POST "https://your-region-your-project.cloudfunctions.net/fetch-transcript" \
  -H "Content-Type: application/json" \
  -d '{"targetDate": "2025-01-15"}'
```

## 📊 Processing Flow

### Enhanced GitHub Actions Flow (Every 60 Minutes)
1. **Dynamic Time Window Calculation**: Since last successful run (with 3-hour calendar extension)
2. **Extended Meeting Fetch**: Get meetings from extended calendar window to catch delayed transcripts
3. **Smart Transcript Filtering**: Filter by transcript creation time (not meeting end time)
4. **Duplicate Prevention**: Check processed transcript database to prevent reprocessing
5. **Enhanced 4-Stage Pipeline Processing**: 
   - Stage 1: Task Finder + Attendees Extraction
   - Stage 2: Task Creator with RAG enhancement
   - Stage 3: Task Updater with RAG enhancement
   - Stage 4: Meeting Notes Generation
6. **Results**: Tasks created/updated, status changes applied, meeting notes generated, attendees tracked
7. **Teams Notification**: Comprehensive summary with test run indicators
8. **Tracking**: Mark processed transcripts to prevent future duplicates

### Manual Processing Flow
1. **Meeting Fetch**: Get all meetings for specified date/user
2. **Transcript Processing**: Enhanced 4-stage pipeline for each transcript
3. **Results**: Comprehensive processing with detailed logging, meeting notes, and attendees tracking

## ⏱️ Time Tracking Features

The system automatically extracts time information from meeting conversations:

### Estimated Time Detection
- **Patterns**: "this will take X hours", "estimated X hours", "should be about X hours"
- **Usage**: Automatically captured for new tasks and future plans
- **Format**: Stored in hours (converts minutes: 30 minutes = 0.5 hours)


### Time Display
- **Task Lists**: Shows estimated time for each task
- **Summaries**: Participant-level and total time tracking summaries
- **Teams Notifications**: Time information included in task summaries

## 📈 Expected Output

### New Tasks Created
- Professional titles (3-5 words)
- Rich, contextual descriptions using RAG
- Proper assignee detection
- Estimated time tracking
- Status and task type classification

### Task Updates
- Status changes detected from conversation
- Enhanced descriptions with new context
- Date-prefixed update history
- Explicit ID matching for precise updates
- Time tracking for progress updates

### Teams Notifications
- Summary of new tasks and updates
- Participant breakdown with time tracking
- Processing statistics
- Future plans separately listed
- Time tracking summaries
- 🆕 Meeting attendees information
- 🆕 Test run indicators for debugging

## 🔍 Monitoring

### Enhanced Monitoring Tools
```bash
# Check processed transcript statistics
node scripts/transcriptProcessingUtils.js stats

# View cron job statistics and next processing window
node scripts/transcriptProcessingUtils.js cron

# Test system configuration
node scripts/transcriptProcessingUtils.js test

# Run all monitoring commands
node scripts/transcriptProcessingUtils.js all

# Clean up old processed transcript records (optional)
node scripts/transcriptProcessingUtils.js cleanup 90
```

### GitHub Actions
- Go to repository → Actions tab
- View detailed logs for each run
- Monitor success/failure rates
- Check processing statistics
- View extended calendar window and duplicate prevention logs

### Firebase Functions
- Firebase Console → Functions → Logs
- Real-time log streaming
- Error tracking and alerts

## 📚 Documentation

- [System Flow Documentation](Docs/SYSTEM_FLOW_DOCUMENTATION.md) - Technical architecture and data flow
- [Function Flow Documentation](Docs/FUNCTION_FLOW_DOCUMENTATION.md) - Detailed function explanations
- [3-Stage Pipeline Guide](Docs/3_STAGE_PIPELINE_GUIDE.md) - Pipeline architecture details
- [Meeting Participant Guidelines](Docs/MEETING_PARTICIPANT_GUIDELINES.md) - How to communicate for optimal task tracking
- [Jira Integration Guide](Docs/JIRA_INTEGRATION_GUIDE.md) - Setup and configuration for Jira integration
- [Vector Database Implementation](Docs/VECTOR_DATABASE_IMPLEMENTATION.md) - RAG and embedding system details

## 🛠️ Development

### Project Structure
```
standup-tickets-sp/
├── .github/workflows/           # GitHub Actions workflows
├── functions/                   # Functions code
│   ├── services/               # Organized service modules
│   ├── scripts/                # Utility and cron scripts
│   ├── tests/                  # Test files
│   └── schemas/                # Zod validation schemas
├── Docs/                       # Documentation
└── README.md                   # This file
```

### Adding New Features
1. **Services**: Add to appropriate subfolder in `services/`
2. **Tests**: Create corresponding test files
3. **Documentation**: Update relevant docs
4. **Pipeline Integration**: Integrate with existing 3-stage pipeline

## 🚨 Troubleshooting

### Common Issues

**No Transcripts Found**
- Check `TARGET_USER_ID` is correct
- Verify user has meetings with transcripts in the extended calendar window
- Ensure Azure permissions are granted
- Run `node scripts/transcriptProcessingUtils.js cron` to check time windows

**Duplicate Processing**
- Check processed transcript database: `node scripts/transcriptProcessingUtils.js stats`
- Verify duplicate prevention is working in logs
- Clean up old records if needed: `node scripts/transcriptProcessingUtils.js cleanup`

**Authentication Errors**
- Verify Azure credentials
- Check app registration permissions
- Ensure tenant ID is correct in authority URL

**OpenAI Errors**
- Verify API key is valid
- Check rate limits and quotas
- Monitor token usage

**MongoDB Errors**
- Verify connection string
- Check network access permissions
- Ensure database exists
- Test MongoDB functions: `node scripts/transcriptProcessingUtils.js test`

### Enhanced Debug Mode
Set `TEST_MODE=true` to run without saving to MongoDB for debugging.

### New Features Troubleshooting

**Extended Calendar Window Issues**
- Check logs for "extended calendar window" messages
- Verify 3-hour extension is working: processing window vs calendar window
- Monitor for meetings found outside processing window

**Transcript Creation Time Filtering**
- Look for "transcript_creation_time_with_duplicate_prevention" in logs
- Verify transcripts are filtered by creation time, not meeting end time
- Check processing window calculations

## 📝 License

This project is proprietary and confidential.

## 🤝 Support

For issues and questions:
1. Check the troubleshooting section
2. Review the detailed documentation
3. Check GitHub Actions/Firebase logs
4. Contact the development team