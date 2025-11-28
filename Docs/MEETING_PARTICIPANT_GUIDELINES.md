# Meeting Participant Guidelines for Task Tracking

## Overview

To ensure our automated task tracking system captures all task information accurately, please follow these communication guidelines during standup meetings. This will help the system properly:

- Identify new tasks vs. existing task updates using unique task IDs
- Track time estimates for new tasks
- Update task statuses correctly
- Match tasks to the right people

## 🎯 **IMPORTANT: Task ID System**

**Every task in our system gets a unique ID. The format depends on whether Jira integration is enabled:**

- **With Jira Integration**: Tasks get Jira ticket IDs (e.g., `TDS-123`, `PROJ-456`)
- **Without Jira Integration**: Tasks get SP-XXX format IDs (e.g., `SP-22`, `SP-23`)

**Both formats work the same way - always mention the ticket ID when discussing existing tasks!**

### For NEW tasks:
- You don't need to mention any ID - the system will automatically assign one
- If Jira is enabled, a Jira ticket will be created automatically
- The ticket ID will be available in the meeting summary and Teams notification

### For EXISTING tasks:
- **ALWAYS start by saying the task ID loudly and clearly**
- **Example: "TDS-123 - I made progress on the user authentication feature"** (Jira ticket)
- **Example: "SP-25 - I made progress on the user authentication feature"** (SP format)
- **Example: "Task TDS-127 - I completed the database migration"**
- **Example: "For SP-30 - I need to add error handling"**

**⚠️ If you don't mention a task ID when discussing a task, the system will treat it as a NEW task!**

### 🎫 Jira Integration Benefits

When Jira integration is enabled:
- **Automatic Ticket Creation**: New tasks are automatically created as Jira issues
- **Rich Metadata**: Tasks include priority, story points, estimated time, and labels
- **Board Integration**: Tasks are automatically moved to your Jira board
- **Status Synchronization**: Status updates in meetings sync to Jira
- **Team Assignment**: Tasks are automatically assigned to team members

**Note**: You can reference tasks using either the Jira ticket ID (e.g., `TDS-123`) or the SP format (e.g., `SP-25`). The system recognizes both!

## 🚀 Guidelines for Mentioning Tasks

### 1. **Future Plans**
When discussing future ideas, initiatives, or plans that should be tracked but are not yet assigned to anyone:

**✅ Good Examples:**
- "**Mobile app development is a future plan** we should consider for next quarter."
- "**Integration with Slack** would be a **future enhancement** we need to think about."
- "**Migrating to microservices** is **something for the future** when we have more resources."
- "**Machine learning integration** is **on our roadmap** for later this year."
- "**Real-time notifications** are **planned for future** iterations."

**❌ Avoid:**
- "We might do something later" (too vague, no specific plan mentioned)
- "Future stuff" (no clear initiative or plan described)

**What happens:** The system will create a task with `isFuturePlan: true`, assigned to "TBD" (To Be Determined), and include it in the "Future Plans discussed in this meeting" section of the Teams summary.

### 2. **New Tasks**
When introducing a completely new task, be explicit:

**✅ Good Examples:**
- "I have a **new task** to implement user authentication for the login page. This should take about **3 hours**."
- "**New task for me**: Build the admin dashboard. Estimated **5 hours** of work."
- "I need to create a **new feature** - payment integration. Might take **2 days**."

**❌ Avoid:**
- "I need to work on authentication" (unclear if new or existing)
- "The dashboard needs work" (not clearly assigned)

**What happens:** The system will create a regular task assigned to you with a unique SP-{number} ID.

### 3. **Existing Task Updates**
When providing updates on existing tasks, always start with the task ID (Jira ticket ID or SP-XXX format):

**✅ Good Examples:**
- "**TDS-123** - Update on the user authentication task: I've added email validation and it's working well." (Jira ticket)
- "**SP-25** - Update on the user authentication task: I've added email validation and it's working well." (SP format)
- "**Task TDS-127** - For the admin dashboard feature, I've completed the user management section."
- "**SP-30** - Progress on payment integration: I've integrated Stripe but still need to add error handling."

**❌ Avoid:**
- "I worked on some authentication stuff" (no task ID, unclear which task)
- "Dashboard is coming along" (no task ID, vague update)
- "Update on the user authentication task" (no task ID - will be treated as NEW task)

### 4. **Status Changes**
Be explicit about status changes and always include the task ID (Jira ticket ID or SP-XXX format):

**✅ Good Examples:**
- "**TDS-123** - I have **completed** the user authentication task." (Jira ticket)
- "**SP-25** - I have **completed** the user authentication task." (SP format)
- "**TDS-127** - I've **started working on** the admin dashboard."
- "**Task SP-30** - The payment integration is **finished** and deployed."
- "**TDS-132** - I **began** the database migration task yesterday."

**Status updates will automatically sync to Jira if integration is enabled!**

**❌ Avoid:**
- "Authentication is done" (no task ID, unclear which task/feature)
- "Working on dashboard" (no task ID, unclear if started or continuing)
- "I completed the user authentication task" (no task ID - will be treated as NEW completed task)

### 5. **Time Information**
Always mention time estimates for new tasks:

**✅ Good Examples:**
- "This new API task will probably take **4 hours**." (new task - no ID needed)
- "Estimated **2 days** for the payment system implementation." (new task)
- "This new feature should take about **6 hours** to complete."

**Time estimates are automatically added to Jira tickets when integration is enabled!**

**❌ Avoid:**
- "It'll take a while" (no specific estimate)
- "Worked on it for some time" (no specific hours)

### 6. **Task Modifications**
When adding or removing features from existing tasks, always include the task ID (Jira ticket ID or SP-XXX format):

**✅ Good Examples:**
- "**TDS-123** - For the user authentication task, I need to **add two-factor authentication** as well." (Jira ticket)
- "**SP-25** - For the user authentication task, I need to **add two-factor authentication** as well." (SP format)
- "**Task TDS-127** - Update to the admin dashboard: we're **removing the analytics section** for now."
- "**SP-30** - The payment integration now needs to **support PayPal** in addition to Stripe."

**Task modifications will update the Jira issue description if integration is enabled!**

**❌ Avoid:**
- "We need to change some things" (no task ID, unclear what and where)
- "Adding more features" (no task ID, unclear to which task)
- "For the user authentication task, I need to add two-factor authentication" (no task ID - will be treated as NEW task)

## ⏱️ Time Tracking

The system automatically captures estimated time for new tasks. Use these specific phrases to ensure accurate time tracking:

### For New Task Estimates:
- "will take **X hours**"
- "estimated **X hours**"
- "should take about **X hours**"
- "might need **X hours**"
- "probably **X hours**"
- "roughly **X hours**"
- "approximately **X hours**"
- "needs about **X hours**"

### Time Conversion Rules:
- **Minutes to Hours**: "30 minutes" = 0.5 hours, "90 minutes" = 1.5 hours
- **Word Numbers**: "two hours" = 2, "three hours" = 3
- **Days**: Only extract if explicitly mentioned in hours (e.g., "2 days" = 16 hours)
- **Format**: All time is stored in hours for consistency

### For Status:
- "**completed**", "**finished**", "**done with**"
- "**started**", "**began**", "**working on**"
- "**in progress**", "**currently working**"

## 🎯 Complete Example Statements

### Future Plan Example:
> "**API rate limiting is a future plan** we should implement when we scale up. It's not urgent but should be on our roadmap."
> *System will assign: SP-35 to "TBD" with isFuturePlan: true*

### New Task Example:
> "I have a **new coding task** to implement the search functionality for the user dashboard. This will involve creating the search API and updating the frontend. I estimate this will take **8 hours** total."
> *System will assign: SP-36 with estimatedTime: 8*

### Update Example:
> "**TDS-136** - Update on the search functionality task: I've completed the API part and I'm now working on the frontend integration."
> *System will update TDS-136 and sync to Jira if integration is enabled*

### Completion Example:
> "**TDS-136** - I have **completed** the search functionality task. Everything is tested and deployed."
> *System will update TDS-136 with status: Completed, and sync status to Jira*

### Status Change Example:
> "I've **started working on** the new user notification system. This is a **new task** that should take about **6 hours**."
> *System will create a new task (e.g., TDS-137) with estimatedTime: 6, and create a Jira issue if integration is enabled*
> 
> Later: "**TDS-137** - Progress update on the user notification system: I've implemented the basic structure and it's going well."
> *System will update TDS-137 and sync to Jira*

## 🚀 Enhanced System Features

The system now includes several advanced features for better task tracking:

### Time Tracking Integration
- **Automatic Detection**: Time estimates are automatically extracted for new tasks
- **Visual Display**: Tasks show estimated time information
- **Summary Reports**: Time estimates included in Teams notifications and processing reports

### RAG-Enhanced Descriptions
- **Rich Context**: Task descriptions include comprehensive context from the entire meeting
- **Professional Titles**: Tasks get professional 3-5 word titles automatically
- **Detailed Requirements**: Full technical requirements and acceptance criteria included

### Smart Status Detection
- **Automatic Status Updates**: Status changes are detected and applied automatically
- **Confidence Scoring**: System provides confidence levels for status changes
- **Multiple Patterns**: Recognizes various ways of expressing status changes

### Future Plans Management
- **Separate Tracking**: Future plans are tracked separately from active tasks
- **TBD Assignment**: Future plans are assigned to "TBD" until someone takes ownership
- **Roadmap Integration**: Future plans help build project roadmaps

## ⚠️ Important Notes

1. **Task IDs are CRITICAL**: Always mention task ID for existing tasks (Jira format like `TDS-123` or SP format like `SP-25`)
2. **Jira Integration**: If enabled, tasks are automatically created as Jira issues with rich metadata
3. **Ticket Format**: You can reference tasks using either Jira ticket IDs (e.g., `TDS-123`) or SP format (e.g., `SP-25`) - both work!
4. **Future Plans**: Use phrases like "is a future plan", "future enhancement", "planned for future" to create future plan tasks
5. **Be Specific**: Always mention the task name/description clearly
6. **Use Keywords**: Include the suggested keywords for better detection
7. **Separate Tasks**: If discussing multiple tasks, address them one by one with their respective IDs
8. **Time Units**: Use "hours" or "days" consistently
9. **Assignee Clarity**: Make it clear who is responsible for each task
10. **No Task ID = New Task**: If you don't mention a task ID, the system assumes it's a new task
11. **Time Tracking**: Always mention time estimates for new tasks
12. **Jira Sync**: Status changes and updates automatically sync to Jira when integration is enabled

## 🔄 Task Lifecycle Communication

### Phase 0: Future Plan Creation
- "**[Plan description] is a future plan** we should consider"
- *System assigns to "TBD" with isFuturePlan: true (e.g., SP-40)*

### Phase 1: Task Creation
- "**New task**: [Description] - estimated **X hours**"
- *System assigns ID automatically (e.g., TDS-141 if Jira enabled, or SP-41)*
- *If Jira enabled: Creates Jira issue with priority, story points, labels, and assigns to team member*

### Phase 2: Progress Updates
- "**TDS-141** - Update on [task name]: [progress details]"
- *System updates task and syncs to Jira if integration enabled*

### Phase 3: Completion
- "**TDS-141** - Completed [task name]"
- *System updates status to Completed and syncs to Jira (status: done)*

### Phase 4: Additional Work
- "**TDS-141** - For [task name], need to add [new requirement] - estimated additional **X hours**"
- *System updates description and syncs to Jira*

## ✅ Quick Checklist Before Speaking

- [ ] **For future plans: Did I use "future plan" language clearly?**
- [ ] **For existing tasks: Did I start with the task ID (TDS-XXX or SP-XX)?**
- [ ] Did I specify if this is a new task or update to existing?
- [ ] **Time Tracking: Did I include time estimates for new tasks?**
- [ ] Did I clearly state any status changes?
- [ ] Did I mention my name or make it clear who's responsible?
- [ ] **Enhanced Features: Did I provide enough context for rich descriptions?**
- [ ] **Jira Integration: Did I use the correct ticket ID format (if Jira is enabled)?**

**Remember: No Task ID = New Task! Always use TDS-XXX (or SP-XX) for existing tasks.**

## 🔗 Related Documentation

- [Jira Integration Guide](JIRA_INTEGRATION_GUIDE.md) - Detailed setup and configuration for Jira integration
- [System Flow Documentation](SYSTEM_FLOW_DOCUMENTATION.md) - Technical architecture details

Following these guidelines will ensure that our automated system captures all task information accurately and maintains a comprehensive tracking of our project progress!
