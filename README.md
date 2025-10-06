# Standup Tickets SP - Automated Meeting Transcript Processor

This project automatically processes Microsoft Teams meeting transcripts using a **3-Stage Pipeline** to extract actionable tasks with enhanced context and stores the results in MongoDB. The system can run as **GitHub Actions cron jobs**.

## 🚀 3-Stage Pipeline Architecture

The system features a **RAG-enhanced 3-stage processing pipeline** with transcript embeddings and intelligent context retrieval:

### Stage 1: Task Finder 🔍
- **Purpose**: Extract actionable tasks with comprehensive context gathering
- **Role**: Analytical task detection with evidence-based extraction
- **Output**: Structured arrays of `tasksToBeCreated` and `tasksToBeUpdated` with rich context
- **Enhancement**: Gathers ALL related information from the entire transcript for each task

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

### Flexible Deployment Options
- **GitHub Actions** (Recommended): Runs every 60 minutes, processes last 60 minutes of meetings
- **Firebase Functions**: HTTP endpoints for manual processing and testing

## 🏗️ Architecture Overview

### Service Organization
```
functions/services/
├── core/
│   └── taskProcessor.js          # Main orchestrator
├── pipeline/
│   ├── taskFinderService.js      # Stage 1: Task extraction
│   ├── taskCreatorService.js     # Stage 2: Task creation with RAG
│   ├── taskUpdaterService.js     # Stage 3: Task updates with RAG
│   └── taskMatcher.js            # Task matching logic
├── integrations/
│   ├── allMeetingsService.js     # Microsoft Graph API integration
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

### Azure App Registration Permissions

Your Azure app needs these Microsoft Graph permissions:
- `Calendars.Read` - Read calendar events
- `OnlineMeetings.Read` - Read meeting details
- `CallRecords.Read.All` - Read call transcripts

## 🧪 Testing

### Local Testing
```bash
cd functions

# Test with fake transcript data
npm run test:fake-flow

# Test with real Microsoft Graph data
npm run test:real-flow

# Test GitHub Actions cron job locally
npm run test:github-actions
```

### Manual Processing (Firebase Functions)
```bash
# Process specific date
curl -X POST "https://your-region-your-project.cloudfunctions.net/fetch-transcript" \
  -H "Content-Type: application/json" \
  -d '{"targetDate": "2025-01-15"}'
```

## 📊 Processing Flow

### GitHub Actions Flow (Every 60 Minutes)
1. **Time Window Calculation**: Last 60 minutes in Bangladesh time
2. **Meeting Fetch**: Get meetings that occurred entirely within the window
3. **Transcript Processing**: 3-stage pipeline for each meeting with transcripts
4. **Results**: Tasks created/updated, status changes applied, Teams notification sent

### Manual Processing Flow
1. **Meeting Fetch**: Get all meetings for specified date/user
2. **Transcript Processing**: 3-stage pipeline for each transcript
3. **Results**: Comprehensive processing with detailed logging

## 📈 Expected Output

### New Tasks Created
- Professional titles (3-5 words)
- Rich, contextual descriptions using RAG
- Proper assignee detection
- Estimated time and status

### Task Updates
- Status changes detected from conversation
- Enhanced descriptions with new context
- Date-prefixed update history
- Explicit ID matching for precise updates

### Teams Notifications
- Summary of new tasks and updates
- Participant breakdown
- Processing statistics
- Future plans separately listed

## 🔍 Monitoring

### GitHub Actions
- Go to repository → Actions tab
- View detailed logs for each run
- Monitor success/failure rates
- Check processing statistics

### Firebase Functions
- Firebase Console → Functions → Logs
- Real-time log streaming
- Error tracking and alerts

## 📚 Documentation

- [System Flow Documentation](Docs/SYSTEM_FLOW_DOCUMENTATION.md) - Technical architecture and data flow
- [Function Flow Documentation](Docs/FUNCTION_FLOW_DOCUMENTATION.md) - Detailed function explanations
- [3-Stage Pipeline Guide](Docs/3_STAGE_PIPELINE_GUIDE.md) - Pipeline architecture details

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

**No Meetings Found**
- Check `TARGET_USER_ID` is correct
- Verify user has meetings in the time window
- Ensure Azure permissions are granted

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

### Debug Mode
Set `TEST_MODE=true` to run without saving to MongoDB for debugging.

## 📝 License

This project is proprietary and confidential.

## 🤝 Support

For issues and questions:
1. Check the troubleshooting section
2. Review the detailed documentation
3. Check GitHub Actions/Firebase logs
4. Contact the development team