# GitHub Actions Setup Guide

This guide explains how to set up the transcript processor to run as a GitHub Actions cron job instead of Firebase Functions.

## Overview

The GitHub Actions setup provides the following benefits:
- **Runs every 60 minutes** instead of daily
- **Processes meetings from the last 60 minutes only** (both start and end times within window)
- **Cost-effective** - no Firebase Functions costs
- **Better logging** - GitHub Actions provides detailed logs
- **Manual triggering** - can be run manually when needed

## Setup Instructions

### 1. Repository Secrets

Add the following secrets to your GitHub repository:

**Go to: Repository Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `AZURE_CLIENT_ID` | Azure App Registration Client ID | `378ec236-171c-4eb8-bcf1-5cdf39...` |
| `AZURE_CLIENT_SECRET` | Azure App Registration Client Secret | `dwo8Q~...` |
| `AZURE_AUTHORITY` | Azure Authority URL | `https://login.microsoftonline.com/your-tenant-id` |
| `TARGET_USER_ID` | Microsoft Graph User ID to fetch meetings for | `50a66395-f31b-4dee-a...` |
| `OPENAI_API_KEY` | OpenAI API Key | `sk-proj-...` |
| `MONGODB_URI` | MongoDB Connection String | `mongodb+srv://user:pass@cluster...` |
| `TEAMS_WEBHOOK_URL` | Teams Webhook URL (optional) | `https://outlook.office.com/webhook/...` |

### 2. Workflow File

The workflow file is already created at `.github/workflows/transcript-processor.yml`. It:
- Runs every 60 minutes (`0 * * * *`)
- Can be triggered manually
- Sets up Node.js 18 environment
- Installs dependencies
- Runs the transcript processor

### 3. Time Window Logic

The new system:
- **Calculates the last 60 minutes** in Bangladesh time
- **Fetches meetings** that both started AND ended within this window
- **Processes transcripts** only for meetings that fully occurred in the time window
- **Skips processing** if no meetings are found (normal behavior)

### 4. Testing

#### Local Testing
```bash
cd functions
npm run test:github-actions
```

#### Manual GitHub Actions Run
1. Go to your repository on GitHub
2. Click "Actions" tab
3. Select "Transcript Processor Cron Job"
4. Click "Run workflow"
5. Optionally enable "Run in test mode"

### 5. Monitoring

#### GitHub Actions Logs
- Go to Actions tab in your repository
- Click on any workflow run to see detailed logs
- Logs include meeting counts, processing results, and any errors

#### Expected Log Output
```
🚀 GITHUB ACTIONS TRANSCRIPT PROCESSOR STARTED
============================================================
✅ Environment variables validated
⏰ Time Window Calculation:
   Current Bangladesh Time: 2025-10-06T15:30:00.000Z
   Window Start (60 min ago): 2025-10-06T14:30:00.000Z
   Window End (now): 2025-10-06T15:30:00.000Z
   Test Mode: false
📅 Fetching meetings from the last 60 minutes...
📊 Meetings found: 2
📝 Meetings with transcripts in time window: 1
🔄 Processing meeting: Daily Stand Up
✅ Successfully processed meeting: Daily Stand Up
   New tasks created: 3
   Existing tasks updated: 1
   Status changes applied: 2
============================================================
📊 FINAL SUMMARY
============================================================
⏱️  Total Duration: 45.23s
📅 Time Window: 2025-10-06T14:30:00.000Z to 2025-10-06T15:30:00.000Z
🔍 Meetings Found: 2
📝 Meetings with Transcripts: 1
✅ Successfully Processed: 1
❌ Errors: 0
🧪 Test Mode: false
🎉 GitHub Actions cron job completed!
```

### 6. Troubleshooting

#### Common Issues

**Missing Environment Variables**
- Error: `Missing required environment variables: AZURE_CLIENT_ID, ...`
- Solution: Ensure all required secrets are added to GitHub repository

**No Meetings Found**
- Message: `No meetings found in the last 60 minutes`
- This is normal - the system only processes meetings that occurred in the exact 60-minute window

**Authentication Errors**
- Error: `Failed to obtain access token`
- Solution: Check Azure credentials and ensure the app registration has correct permissions

**MongoDB Connection Issues**
- Error: `MongoServerError: Authentication failed`
- Solution: Verify MongoDB URI and ensure network access is allowed

#### Debug Mode
To run in test mode (doesn't save to MongoDB):
1. Go to Actions → Transcript Processor Cron Job
2. Click "Run workflow"
3. Check "Run in test mode"
4. Click "Run workflow"

### 7. Migration from Firebase Functions

#### Disable Firebase Cron Job
The Firebase cron job (`dailyTranscriptFetch`) should be disabled to avoid duplicate processing:

1. Comment out or remove the cron job from `functions/index.js`
2. Redeploy Firebase Functions: `firebase deploy --only functions`

#### Keep Firebase HTTP Endpoints
The HTTP endpoints (`/fetch-transcript`) can remain active for manual testing.

### 8. Comparison: Firebase vs GitHub Actions

| Feature | Firebase Functions | GitHub Actions |
|---------|-------------------|----------------|
| **Schedule** | Daily at 2 AM (Tue-Sat) | Every 60 minutes |
| **Time Window** | Previous day or current day | Last 60 minutes only |
| **Cost** | Firebase Functions pricing | Free (GitHub Actions minutes) |
| **Logs** | Firebase Console | GitHub Actions logs |
| **Manual Trigger** | HTTP endpoint | GitHub Actions UI |
| **Environment** | Firebase config | GitHub Secrets |
| **Timeout** | 540 seconds | 15 minutes |

### 9. Performance Expectations

- **Typical run time**: 30-60 seconds
- **Memory usage**: ~200MB
- **Network calls**: 5-10 per meeting (Graph API + OpenAI)
- **Success rate**: >95% (depends on meeting availability)

### 10. Next Steps

1. **Test the setup** using manual workflow runs
2. **Monitor the first few automatic runs** (every hour)
3. **Verify task creation** in your MongoDB database
4. **Check Teams notifications** (if configured)
5. **Disable Firebase cron job** once GitHub Actions is working

## Support

If you encounter issues:
1. Check GitHub Actions logs for detailed error messages
2. Test locally using `npm run test:github-actions`
3. Verify all environment variables are correctly set
4. Ensure Azure app registration has required permissions
