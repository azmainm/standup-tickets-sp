# Meeting Participant Guidelines for Task Tracking

## Overview

To ensure our automated task tracking system captures all task information accurately, please follow these communication guidelines during standup meetings. This will help the system properly:

- Identify new tasks vs. existing task updates using unique task IDs
- Track time estimates and actual time spent
- Update task statuses correctly
- Match tasks to the right people

## 🎯 **IMPORTANT: Task ID System**

**Every task in our system gets a unique ID in the format SP-{number} (e.g., SP-22, SP-23, SP-24).**

### For NEW tasks:
- You don't need to mention any ID - the system will automatically assign one

### For EXISTING tasks:
- **ALWAYS start by saying the task ID loudly and clearly**
- **Example: "SP-25 - I made progress on the user authentication feature"**
- **Example: "Task SP-27 - I completed the database migration"**
- **Example: "For SP-30 - I need to add error handling"**

**⚠️ If you don't mention a task ID when discussing a task, the system will treat it as a NEW task!**

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
When providing updates on existing tasks, always start with the task ID:

**✅ Good Examples:**
- "**SP-25** - Update on the user authentication task: I've added email validation and it's working well."
- "**Task SP-27** - For the admin dashboard feature, I've completed the user management section."
- "**SP-30** - Progress on payment integration: I've integrated Stripe but still need to add error handling."

**❌ Avoid:**
- "I worked on some authentication stuff" (no task ID, unclear which task)
- "Dashboard is coming along" (no task ID, vague update)
- "Update on the user authentication task" (no task ID - will be treated as NEW task)

### 4. **Status Changes**
Be explicit about status changes and always include the task ID:

**✅ Good Examples:**
- "**SP-25** - I have **completed** the user authentication task."
- "**SP-27** - I've **started working on** the admin dashboard."
- "**Task SP-30** - The payment integration is **finished** and deployed."
- "**SP-32** - I **began** the database migration task yesterday."

**❌ Avoid:**
- "Authentication is done" (no task ID, unclear which task/feature)
- "Working on dashboard" (no task ID, unclear if started or continuing)
- "I completed the user authentication task" (no task ID - will be treated as NEW completed task)

### 5. **Time Information**
Always mention time estimates for new tasks and actual time spent (include task ID for existing tasks):

**✅ Good Examples:**
- "This new API task will probably take **4 hours**." (new task - no ID needed)
- "**SP-25** - I **spent 3 hours** on the authentication feature yesterday."
- "**Task SP-27** - The dashboard task **took me 6 hours** total to complete."
- "Estimated **2 days** for the payment system implementation." (new task)
- "**SP-30** - This task **took longer than expected, about 8 hours** instead of 5."

**❌ Avoid:**
- "It'll take a while" (no specific estimate)
- "Worked on it for some time" (no specific hours, no task ID)
- "The authentication feature took 3 hours" (no task ID - will be treated as NEW task)

### 6. **Task Modifications**
When adding or removing features from existing tasks, always include the task ID:

**✅ Good Examples:**
- "**SP-25** - For the user authentication task, I need to **add two-factor authentication** as well."
- "**Task SP-27** - Update to the admin dashboard: we're **removing the analytics section** for now."
- "**SP-30** - The payment integration now needs to **support PayPal** in addition to Stripe."

**❌ Avoid:**
- "We need to change some things" (no task ID, unclear what and where)
- "Adding more features" (no task ID, unclear to which task)
- "For the user authentication task, I need to add two-factor authentication" (no task ID - will be treated as NEW task)

## ⏱️ Enhanced Time Tracking

The system now automatically captures both estimated time and actual time spent. Use these specific phrases to ensure accurate time tracking:

### For New Task Estimates:
- "will take **X hours**"
- "estimated **X hours**"
- "should take about **X hours**"
- "might need **X hours**"
- "probably **X hours**"
- "roughly **X hours**"
- "approximately **X hours**"
- "needs about **X hours**"

### For Existing Task Time Spent (requires task ID):
- "spent **X hours** on SP-XXX"
- "took me **X hours** on SP-XXX"
- "worked **X hours** on SP-XXX"
- "completed in **X hours** on SP-XXX"
- "already put in **X hours** on SP-XXX"
- "invested **X hours** in SP-XXX"
- "used **X hours** on SP-XXX"
- "been working for **X hours** on SP-XXX"

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
> "**SP-36** - Update on the search functionality task: I've completed the API part which **took 4 hours**, and I'm now working on the frontend integration. The frontend should take another **3 hours**."
> *System will update SP-36 with timeSpent: 4 and estimatedTime: 3*

### Completion Example:
> "**SP-36** - I have **completed** the search functionality task. The total time was **7 hours** instead of the estimated 8. Everything is tested and deployed."
> *System will update SP-36 with timeSpent: 7 and status: Completed*

### Status Change Example:
> "I've **started working on** the new user notification system. This is a **new task** that should take about **6 hours**."
> *System will assign: SP-37 with estimatedTime: 6*
> 
> Later: "**SP-37** - Progress update on the user notification system: I've implemented the basic structure and it's going well. I **spent 3 hours** on it so far."
> *System will update SP-37 with timeSpent: 3*

## 🚀 Enhanced System Features

The system now includes several advanced features for better task tracking:

### Time Tracking Integration
- **Automatic Detection**: Time estimates and spent time are automatically extracted
- **Visual Display**: Tasks show time information as `[Time: Xh spent, Yh estimated]`
- **Summary Reports**: Time tracking summaries in Teams notifications and processing reports
- **Historical Tracking**: Time spent is tracked across multiple updates

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

1. **Task IDs are CRITICAL**: Always mention task ID for existing tasks (SP-XX format)
2. **Future Plans**: Use phrases like "is a future plan", "future enhancement", "planned for future" to create future plan tasks
3. **Be Specific**: Always mention the task name/description clearly
4. **Use Keywords**: Include the suggested keywords for better detection
5. **Separate Tasks**: If discussing multiple tasks, address them one by one with their respective IDs
6. **Time Units**: Use "hours" or "days" consistently
7. **Assignee Clarity**: Make it clear who is responsible for each task
8. **No Task ID = New Task**: If you don't mention a task ID, the system assumes it's a new task
9. **Time Tracking**: Always mention time estimates for new tasks and time spent for updates

## 🔄 Task Lifecycle Communication

### Phase 0: Future Plan Creation
- "**[Plan description] is a future plan** we should consider"
- *System assigns to "TBD" with isFuturePlan: true (e.g., SP-40)*

### Phase 1: Task Creation
- "**New task**: [Description] - estimated **X hours**"
- *System assigns ID automatically (e.g., SP-41)*

### Phase 2: Progress Updates
- "**SP-41** - Update on [task name]: [progress details] - spent **X hours**"

### Phase 3: Completion
- "**SP-41** - Completed [task name] - total time **X hours**"

### Phase 4: Additional Work
- "**SP-41** - For [task name], need to add [new requirement] - estimated additional **X hours**"

## ✅ Quick Checklist Before Speaking

- [ ] **For future plans: Did I use "future plan" language clearly?**
- [ ] **For existing tasks: Did I start with the task ID (SP-XX)?**
- [ ] Did I specify if this is a new task or update to existing?
- [ ] **Time Tracking: Did I include time estimates for new tasks?**
- [ ] **Time Tracking: Did I mention actual time spent for progress updates?**
- [ ] Did I clearly state any status changes?
- [ ] Did I mention my name or make it clear who's responsible?
- [ ] **Enhanced Features: Did I provide enough context for rich descriptions?**

**Remember: No Task ID = New Task! Always use SP-XX for existing tasks.**

Following these guidelines will ensure that our automated system captures all task information accurately and maintains a comprehensive tracking of our project progress!
