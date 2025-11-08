/**
 * Zod Schemas for Task Processing
 * 
 * This file defines strict schemas for validating LLM responses
 * to ensure consistent and structured task data.
 */

const { z } = require("zod");

// Schema for individual task from LLM response
const TaskSchema = z.object({
  description: z.string().min(1, "Task description cannot be empty"),
  type: z.enum(["Coding", "Non-Coding"], {
    errorMap: () => ({ message: "Task type must be either 'Coding' or 'Non-Coding'" })
  }),
  taskType: z.enum(["NEW TASK", "EXISTING TASK UPDATE", "STATUS CHANGE", "FUTURE PLAN"]),
  existingTaskId: z.string().regex(/^SP-\d+$/).nullable().optional(),
  estimatedTime: z.number().min(0).default(0),
  status: z.enum(["To-do", "In-progress", "Completed"]).default("To-do"),
  isFuturePlan: z.boolean(),
  assignee: z.string().min(1, "Assignee cannot be empty"),
  priority: z.enum(["Highest", "High", "Medium", "Low", "Lowest"]).nullable().optional(),
  storyPoints: z.number().min(0).nullable().optional()
});

// Schema for participant tasks
const ParticipantTasksSchema = z.object({
  Coding: z.array(TaskSchema).default([]),
  "Non-Coding": z.array(TaskSchema).default([])
});

// Schema for complete LLM response
const LLMResponseSchema = z.record(z.string(), ParticipantTasksSchema);

// Schema for enhanced task metadata
const TaskMetadataSchema = z.object({
  confidence: z.number().min(0).max(1).optional(),
  contextSnippet: z.string().optional(),
  speakerContext: z.string().optional(),
  timeReference: z.string().optional()
});

// Schema for assignee detection result
const AssigneeDetectionSchema = z.object({
  assignee: z.string(),
  confidence: z.number().min(0).max(1),
  method: z.enum(["EXPLICIT_MENTION", "SPEAKER_INFERENCE", "DATABASE_MATCH", "DEFAULT_ASSIGNMENT"]),
  originalMention: z.string().optional(),
  alternativeCandidates: z.array(z.string()).default([])
});

// Schema for status change detection
const StatusChangeSchema = z.object({
  taskId: z.string().regex(/^(SP-\d+|[A-Z]{2,}-\d+)$/), // Accepts both SP-XXX and Jira formats like TRADES-XXX
  newStatus: z.enum(["To-do", "In-progress", "Completed"]),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
  speaker: z.string()
});

// Schema for future plan detection
const FuturePlanSchema = z.object({
  description: z.string().min(1),
  type: z.enum(["Coding", "Non-Coding"]),
  confidence: z.number().min(0).max(1),
  triggerPhrase: z.string(),
  contextEvidence: z.string()
});

// Schema for similarity detection result
const SimilarityResultSchema = z.object({
  isMatch: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  similarities: z.array(z.string()).default([]),
  differences: z.array(z.string()).default([])
});

// Schema for complete processing result
const ProcessingResultSchema = z.object({
  success: z.boolean(),
  tasks: LLMResponseSchema,
  metadata: z.object({
    model: z.string(),
    tokensUsed: z.number(),
    processedAt: z.string(),
    participantCount: z.number(),
    totalTasks: z.number(),
    validationErrors: z.array(z.string()).default([])
  }),
  statusChanges: z.array(StatusChangeSchema).default([]),
  futurePlans: z.array(FuturePlanSchema).default([]),
  assigneeDetections: z.array(AssigneeDetectionSchema).default([])
});

/**
 * Validate LLM response against schema
 * @param {any} data - Raw LLM response data
 * @returns {Object} Validation result with parsed data or errors
 */
function validateLLMResponse(data) {
  try {
    const parsed = LLMResponseSchema.parse(data);
    return {
      success: true,
      data: parsed,
      errors: []
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        data: null,
        errors: error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
          code: err.code
        }))
      };
    }
    return {
      success: false,
      data: null,
      errors: [{ path: 'unknown', message: error.message, code: 'unknown' }]
    };
  }
}

/**
 * Validate individual task
 * @param {any} task - Task data to validate
 * @returns {Object} Validation result
 */
function validateTask(task) {
  try {
    const parsed = TaskSchema.parse(task);
    return {
      success: true,
      data: parsed,
      errors: []
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        data: null,
        errors: error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
          code: err.code
        }))
      };
    }
    return {
      success: false,
      data: null,
      errors: [{ path: 'unknown', message: error.message, code: 'unknown' }]
    };
  }
}

/**
 * Sanitize and fix common LLM response issues
 * @param {any} rawData - Raw LLM response
 * @returns {any} Sanitized data
 */
function sanitizeLLMResponse(rawData) {
  if (!rawData || typeof rawData !== 'object') {
    return {};
  }

  const sanitized = {};
  
  for (const [participantName, participantTasks] of Object.entries(rawData)) {
    // Skip invalid participant names
    if (!participantName || typeof participantName !== 'string') {
      continue;
    }

    sanitized[participantName] = {
      "Coding": [],
      "Non-Coding": []
    };

    if (participantTasks && typeof participantTasks === 'object') {
      // Process Coding tasks
      if (Array.isArray(participantTasks.Coding)) {
        sanitized[participantName]["Coding"] = participantTasks.Coding
          .filter(task => task && typeof task === 'object' && task.description)
          .map(task => sanitizeTask(task, participantName));
      }

      // Process Non-Coding tasks
      if (Array.isArray(participantTasks["Non-Coding"])) {
        sanitized[participantName]["Non-Coding"] = participantTasks["Non-Coding"]
          .filter(task => task && typeof task === 'object' && task.description)
          .map(task => sanitizeTask(task, participantName));
      }
    }
  }

  return sanitized;
}

/**
 * Sanitize individual task
 * @param {any} task - Raw task data
 * @param {string} assignee - Default assignee
 * @returns {Object} Sanitized task
 */
function sanitizeTask(task, assignee) {
  return {
    description: String(task.description || "").trim(),
    type: ["Coding", "Non-Coding"].includes(task.type) ? task.type : "Non-Coding",
    taskType: ["NEW TASK", "EXISTING TASK UPDATE", "STATUS CHANGE", "FUTURE PLAN"].includes(task.taskType) ? 
               task.taskType : "NEW TASK",
    existingTaskId: task.existingTaskId && /^SP-\d+$/i.test(task.existingTaskId) ? 
                    task.existingTaskId.toUpperCase() : null,
    estimatedTime: Math.max(0, Number(task.estimatedTime) || 0),
    status: ["To-do", "In-progress", "Completed"].includes(task.status) ? task.status : "To-do",
    isFuturePlan: Boolean(task.isFuturePlan),
    assignee: String(task.assignee || assignee || "TBD").trim(),
    priority: task.priority || null,
    storyPoints: task.storyPoints !== undefined && task.storyPoints !== null ? Math.max(0, Number(task.storyPoints)) : null
  };
}

module.exports = {
  TaskSchema,
  ParticipantTasksSchema,
  LLMResponseSchema,
  TaskMetadataSchema,
  AssigneeDetectionSchema,
  StatusChangeSchema,
  FuturePlanSchema,
  SimilarityResultSchema,
  ProcessingResultSchema,
  validateLLMResponse,
  validateTask,
  sanitizeLLMResponse,
  sanitizeTask
};
