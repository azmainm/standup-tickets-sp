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

### 1. **New Tasks**
When introducing a completely new task, be explicit:

**✅ Good Examples:**
- "I have a **new task** to implement user authentication for the login page. This should take about **3 hours**."
- "**New task for me**: Build the admin dashboard. Estimated **5 hours** of work."
- "I need to create a **new feature** - payment integration. Might take **2 days**."

**❌ Avoid:**
- "I need to work on authentication" (unclear if new or existing)
- "The dashboard needs work" (not clearly assigned)

### 2. **Existing Task Updates**
When providing updates on existing tasks, always start with the task ID:

**✅ Good Examples:**
- "**SP-25** - Update on the user authentication task: I've added email validation and it's working well."
- "**Task SP-27** - For the admin dashboard feature, I've completed the user management section."
- "**SP-30** - Progress on payment integration: I've integrated Stripe but still need to add error handling."

**❌ Avoid:**
- "I worked on some authentication stuff" (no task ID, unclear which task)
- "Dashboard is coming along" (no task ID, vague update)
- "Update on the user authentication task" (no task ID - will be treated as NEW task)

### 3. **Status Changes**
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

### 4. **Time Information**
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

### 5. **Task Modifications**
When adding or removing features from existing tasks, always include the task ID:

**✅ Good Examples:**
- "**SP-25** - For the user authentication task, I need to **add two-factor authentication** as well."
- "**Task SP-27** - Update to the admin dashboard: we're **removing the analytics section** for now."
- "**SP-30** - The payment integration now needs to **support PayPal** in addition to Stripe."

**❌ Avoid:**
- "We need to change some things" (no task ID, unclear what and where)
- "Adding more features" (no task ID, unclear to which task)
- "For the user authentication task, I need to add two-factor authentication" (no task ID - will be treated as NEW task)

## 📊 Time Tracking Keywords

Use these specific phrases to help the system capture time information:

### For Estimates:
- "will take **X hours**"
- "estimated **X hours**"
- "should take about **X hours**"
- "might need **X days**"
- "probably **X hours**"

### For Time Spent:
- "spent **X hours** on..."
- "took me **X hours**"
- "worked **X hours** on..."
- "completed in **X hours**"

### For Status:
- "**completed**", "**finished**", "**done with**"
- "**started**", "**began**", "**working on**"
- "**in progress**", "**currently working**"

## 🎯 Complete Example Statements

### New Task Example:
> "I have a **new coding task** to implement the search functionality for the user dashboard. This will involve creating the search API and updating the frontend. I estimate this will take **8 hours** total."
> *System will assign: SP-35*

### Update Example:
> "**SP-35** - Update on the search functionality task: I've completed the API part which **took 4 hours**, and I'm now working on the frontend integration. The frontend should take another **3 hours**."

### Completion Example:
> "**SP-35** - I have **completed** the search functionality task. The total time was **7 hours** instead of the estimated 8. Everything is tested and deployed."

### Status Change Example:
> "I've **started working on** the new user notification system. This is a **new task** that should take about **6 hours**."
> *System will assign: SP-36*
> 
> Later: "**SP-36** - Progress update on the user notification system: I've implemented the basic structure and it's going well."

## ⚠️ Important Notes

1. **Task IDs are CRITICAL**: Always mention task ID for existing tasks (SP-XX format)
2. **Be Specific**: Always mention the task name/description clearly
3. **Use Keywords**: Include the suggested keywords for better detection
4. **Separate Tasks**: If discussing multiple tasks, address them one by one with their respective IDs
5. **Time Units**: Use "hours" or "days" consistently
6. **Assignee Clarity**: Make it clear who is responsible for each task
7. **No Task ID = New Task**: If you don't mention a task ID, the system assumes it's a new task

## 🔄 Task Lifecycle Communication

### Phase 1: Task Creation
- "**New task**: [Description] - estimated **X hours**"
- *System assigns ID automatically (e.g., SP-40)*

### Phase 2: Progress Updates
- "**SP-40** - Update on [task name]: [progress details] - spent **X hours**"

### Phase 3: Completion
- "**SP-40** - Completed [task name] - total time **X hours**"

### Phase 4: Additional Work
- "**SP-40** - For [task name], need to add [new requirement] - estimated additional **X hours**"

## ✅ Quick Checklist Before Speaking

- [ ] **For existing tasks: Did I start with the task ID (SP-XX)?**
- [ ] Did I specify if this is a new task or update to existing?
- [ ] Did I include time estimates for new tasks?
- [ ] Did I mention actual time spent for progress updates?
- [ ] Did I clearly state any status changes?
- [ ] Did I mention my name or make it clear who's responsible?

**Remember: No Task ID = New Task! Always use SP-XX for existing tasks.**

Following these guidelines will ensure that our automated system captures all task information accurately and maintains a comprehensive tracking of our project progress!
