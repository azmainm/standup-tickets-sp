# Jira Integration Guide

## Overview

The Standup Tickets SP system integrates with Jira to automatically create and update issues/tickets for tasks extracted from meeting transcripts. This integration ensures that all actionable work items discussed in meetings are properly tracked in your Jira project.

## 🎯 Key Features

- **Automatic Issue Creation**: Coding and Non-Coding tasks are automatically created as Jira issues
- **Smart Assignment**: Tasks are assigned to team members based on participant mapping
- **Status Management**: Task status updates from meetings are synchronized to Jira
- **Rich Metadata**: Priority, story points, estimated time, and labels are automatically set
- **Future Plans Tracking**: Future plans are created with special labels and remain unassigned
- **Board Integration**: Active tasks are automatically moved to the board's "To Do" column

## 🔧 Setup and Configuration

### 1. Prerequisites

- A Jira Cloud or Jira Server instance
- Admin access to create API tokens
- Access to the Jira project where issues will be created
- Team member Jira account IDs

### 2. Environment Variables

Add the following environment variables to your configuration:

#### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `JIRA_URL` | Your Jira instance URL | `https://yourcompany.atlassian.net` |
| `JIRA_EMAIL` | Email address of the Jira account with API access | `your-email@company.com` |
| `JIRA_API_TOKEN` | Jira API token (see below for how to create) | `ATATT3xFfGF0...` |
| `JIRA_PROJECT_KEY` | The project key where issues will be created | `TDS`, `PROJ`, `SP` |

#### Creating a Jira API Token

1. Log in to your Jira instance
2. Go to **Account Settings** → **Security** → **API tokens**
3. Click **Create API token**
4. Give it a label (e.g., "Standup Tickets Integration")
5. Copy the token immediately (you won't be able to see it again)
6. Store it securely in your environment variables

### 3. Participant Mapping Configuration

The system maps meeting participants to Jira account IDs. Configure this in `functions/config/participantMapping.js`:

```javascript
const PARTICIPANT_TO_JIRA_MAPPING = {
  "Azmain Morshed": "712020:07191a71-d22a-4918-a0a5-7fd37a3d989d",
  "Faiyaz Rahman": "712020:c78868d6-22f3-4057-af78-ee12cb842f1d",
  "Shafkat Kabir": "63b5ca05b790087ed712410a",
  "Doug Whitewolff": "712020:bd2ea925-798e-4c8f-8854-c0ddfc7c787f",
  
  // You can also add name variations
  "Azmain": "712020:07191a71-d22a-4918-a0a5-7fd37a3d989d",
  "Faiyaz": "712020:c78868d6-22f3-4057-af78-ee12cb842f1d",
};
```

#### Finding Jira Account IDs

**Method 1: Using Jira REST API**
```bash
curl -u your-email@company.com:YOUR_API_TOKEN \
  -X GET \
  https://yourcompany.atlassian.net/rest/api/3/user/search?query=username
```

**Method 2: Using Browser Developer Tools**
1. Open Jira in your browser
2. Open Developer Tools (F12)
3. Go to Network tab
4. Navigate to a user's profile
5. Look for API calls that return user data
6. Find the `accountId` field in the response

**Method 3: Using Jira UI**
1. Go to the user's profile page
2. The account ID is often visible in the URL or page source
3. Format: `"712020:uuid-format"` or `"63b5ca05b790087ed712410a"`

### 4. GitHub Actions Configuration

If using GitHub Actions, add the Jira secrets to your repository:

1. Go to **Repository Settings** → **Secrets and variables** → **Actions**
2. Add the following secrets:
   - `JIRA_URL`
   - `JIRA_EMAIL`
   - `JIRA_API_TOKEN`
   - `JIRA_PROJECT_KEY`

### 5. Firebase Functions Configuration

If using Firebase Functions, add to your `.env` file:

```env
JIRA_URL=https://yourcompany.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=ATATT3xFfGF0...
JIRA_PROJECT_KEY=TDS
```

## 🔄 How It Works

### Task Creation Flow

1. **Meeting Transcript Processing**: The system processes meeting transcripts using the 3-stage pipeline
2. **Task Extraction**: Tasks are extracted and classified as Coding or Non-Coding
3. **Jira Issue Creation**: For each task, a Jira issue is created with:
   - **Title**: Professional 3-5 word summary
   - **Description**: Rich, detailed description with user story format
   - **Assignee**: Mapped from meeting participant to Jira account ID
   - **Priority**: Extracted from meeting conversation (defaults to Medium)
   - **Story Points**: If mentioned in the meeting
   - **Estimated Time**: Converted to Jira time tracking format
   - **Labels**: `coding` or `non-coding`, plus `future-plan` if applicable
   - **Issue Type**: "Task" (default)
4. **Board Transition**: Active tasks are automatically moved to the board's "To Do" column
5. **MongoDB Storage**: Jira ticket IDs are stored in MongoDB for future updates

### Task Update Flow

1. **Status Detection**: When a task ID (e.g., `TDS-123`) is mentioned in a meeting
2. **Status Mapping**: MongoDB statuses are mapped to Jira statuses:
   - `In-progress` → `in-progress`
   - `Completed` → `done`
3. **Issue Update**: The Jira issue is updated with:
   - New status (if changed)
   - Updated description (with date prefix for history)

### Ticket ID System

The system uses a dual ticket ID system:

- **Jira Tickets**: When Jira integration is enabled, tasks get Jira ticket IDs (e.g., `TDS-123`)
- **SP Tickets**: If Jira creation fails or integration is disabled, tasks get SP-XXX format IDs (e.g., `SP-25`)

Both formats are supported for task updates in meetings.

## 📋 Issue Fields and Metadata

### Automatically Set Fields

| Field | Source | Notes |
|-------|--------|-------|
| **Summary** | Task title from pipeline | 3-5 words, professional format |
| **Description** | Task description from pipeline | User story format with acceptance criteria |
| **Assignee** | Participant mapping | Uses Jira account ID |
| **Priority** | Meeting conversation | Highest, High, Medium (default), Low, Lowest |
| **Story Points** | Meeting conversation | Only if explicitly mentioned |
| **Time Tracking** | Meeting conversation | Estimated time in hours |
| **Labels** | Task type + future plan flag | `coding`, `non-coding`, `future-plan` |
| **Issue Type** | Fixed | "Task" |

### Labels

- **`coding`**: Applied to all Coding tasks
- **`non-coding`**: Applied to all Non-Coding tasks
- **`future-plan`**: Applied to tasks marked as future plans

### Priority Values

The system recognizes these priority levels (Jira standard):
- **Highest**: Critical, blocking, urgent tasks
- **High**: Important tasks needing attention soon
- **Medium**: Default for most tasks
- **Low**: Tasks that can be deferred
- **Lowest**: Nice-to-have or optional tasks

## 🎯 Task Assignment

### Automatic Assignment

- Tasks are automatically assigned based on participant mapping
- If a participant is not found in the mapping, the `DEFAULT_ASSIGNEE` is used
- Future plans remain **unassigned** (no assignee set)

### Name Matching

The system uses smart name matching:
1. **Exact match**: Full name as it appears in transcript
2. **Case-insensitive match**: Handles case variations
3. **Partial match**: Matches first name if full name not found
4. **Normalization**: Handles common name variations (e.g., "Fayaz" → "Faiyaz")

## 🔍 Testing the Integration

### Test Jira Connection

You can test the Jira connection using the service:

```javascript
const { testJiraConnection } = require('./services/integrations/jiraService');

testJiraConnection().then(success => {
  console.log('Jira connection:', success ? '✅ Success' : '❌ Failed');
});
```

### Test Project Access

```javascript
const { getProjectInfo } = require('./services/integrations/jiraService');

getProjectInfo('TDS').then(project => {
  console.log('Project:', project);
});
```

### Verify Participant Mapping

```javascript
const { validateParticipantMapping } = require('./config/participantMapping');

const validation = validateParticipantMapping();
console.log('Mapping validation:', validation);
```

## 🚨 Troubleshooting

### Common Issues

#### 1. Authentication Errors

**Error**: `401 Unauthorized` or `403 Forbidden`

**Solutions**:
- Verify `JIRA_EMAIL` is correct
- Check that `JIRA_API_TOKEN` is valid and not expired
- Ensure the account has permission to create issues in the project
- Verify the API token was created correctly

#### 2. Project Not Found

**Error**: `404 Not Found` when accessing project

**Solutions**:
- Verify `JIRA_PROJECT_KEY` is correct (case-sensitive)
- Ensure the account has access to the project
- Check project permissions in Jira

#### 3. Assignment Failures

**Error**: Issues created but not assigned

**Solutions**:
- Verify participant mapping in `participantMapping.js`
- Check that account IDs are in correct format
- Ensure account IDs are valid (users exist in Jira)
- Check if user has permission to be assigned issues

#### 4. Status Transition Failures

**Error**: Status updates fail but issue creation succeeds

**Solutions**:
- Verify the project has the required statuses (`To Do`, `in-progress`, `done`)
- Check workflow permissions
- Ensure the account has permission to transition issues
- Verify status names match exactly (case-sensitive)

#### 5. Missing Fields

**Error**: Some fields not appearing in Jira issues

**Solutions**:
- Verify custom field IDs (e.g., `customfield_10166` for story points)
- Check if fields are enabled in the project
- Ensure field permissions allow setting these values

### Debug Mode

Enable detailed logging by checking the function logs:

```bash
# Firebase Functions
firebase functions:log

# GitHub Actions
# Check Actions tab → Workflow runs → View logs
```

Look for log entries with:
- `Jira issue created successfully`
- `Jira issue creation completed`
- `Failed to create Jira issue`
- `Jira connection test`

## 📊 Monitoring

### Success Metrics

Monitor these metrics to ensure integration is working:

- **Issue Creation Rate**: Number of issues created per meeting
- **Assignment Success Rate**: Percentage of issues successfully assigned
- **Status Update Success Rate**: Percentage of status updates that succeed
- **Error Rate**: Number of failed issue creations

### Log Analysis

Key log patterns to monitor:

```
✅ Success: "Jira issue created successfully"
❌ Failure: "Failed to create Jira issue"
⚠️ Warning: "Failed to transition issue to board To Do (non-critical)"
```

## 🔐 Security Best Practices

1. **API Token Security**:
   - Store tokens in environment variables, never in code
   - Use GitHub Secrets or Firebase environment config
   - Rotate tokens periodically
   - Use least-privilege accounts

2. **Account Permissions**:
   - Use a dedicated service account if possible
   - Grant only necessary permissions (create issues, update issues)
   - Regularly audit account access

3. **Data Privacy**:
   - Ensure meeting transcripts don't contain sensitive information
   - Review task descriptions before they're created in Jira
   - Consider data retention policies

## 🔄 Integration with Meeting Processing

The Jira integration is seamlessly integrated into the meeting processing pipeline:

1. **Stage 1 (Task Finder)**: Extracts tasks from transcripts
2. **Stage 2 (Task Creator)**: Creates rich task descriptions
3. **Stage 3 (Task Updater)**: Updates existing tasks
4. **Jira Integration**: Creates/updates Jira issues (runs after Stage 2)
5. **Stage 4 (MongoDB Storage)**: Stores tasks with Jira ticket IDs

## 📝 Best Practices

1. **Participant Mapping**:
   - Keep mapping file up-to-date as team changes
   - Include common name variations
   - Test mapping after adding new team members

2. **Project Configuration**:
   - Use consistent project key across environments
   - Ensure required issue types and fields exist
   - Configure workflows to support status transitions

3. **Monitoring**:
   - Regularly check logs for errors
   - Monitor issue creation success rates
   - Review unassigned issues

4. **Team Communication**:
   - Inform team about Jira integration
   - Train team on how to reference Jira tickets in meetings
   - Document ticket ID format (e.g., `TDS-123`)

## 🔗 Related Documentation

- [Meeting Participant Guidelines](MEETING_PARTICIPANT_GUIDELINES.md) - How to create tasks in meetings
- [System Flow Documentation](SYSTEM_FLOW_DOCUMENTATION.md) - Overall system architecture
- [3-Stage Pipeline Guide](3_STAGE_PIPELINE_GUIDE.md) - Pipeline processing details

## 📞 Support

For issues with Jira integration:

1. Check the troubleshooting section above
2. Review function logs for detailed error messages
3. Verify environment variables are set correctly
4. Test Jira connection using the test functions
5. Contact the development team with specific error messages

