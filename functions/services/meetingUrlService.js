/**
 * Meeting URL Service - Handles day-based meeting URL selection
 * 
 * This service determines which meeting URL to use based on the day of the week:
 * - Tuesday/Thursday/Saturday: Use DAILY_STANDUP_URL_MWF
 * - Wednesday/Friday: Use DAILY_STANDUP_URL_TT
 * - Sunday/Monday: No meetings
 */

const {logger} = require("firebase-functions");

// Load environment variables
require("dotenv").config();

/**
 * Get Bangladesh time components properly
 * @param {Date} currentDate - Current date (optional, defaults to now)
 * @returns {Object} Bangladesh time components
 */
function getBangladeshTimeComponents(currentDate = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit", 
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(currentDate);
  const year = parseInt(parts.find(p => p.type === "year").value);
  const month = parseInt(parts.find(p => p.type === "month").value);
  const day = parseInt(parts.find(p => p.type === "day").value);
  const hour = parseInt(parts.find(p => p.type === "hour").value);
  const minute = parseInt(parts.find(p => p.type === "minute").value);
  const second = parseInt(parts.find(p => p.type === "second").value);

  // Create a proper date object for day calculations (using 1-indexed month)
  const bangladeshDate = new Date(year, month - 1, day);
  
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dayOfWeek: bangladeshDate.getDay(),
    dateString: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  };
}

/**
 * Get the appropriate meeting URL based on the current day
 * When running at 2 AM Bangladesh time, use the previous day's meeting URL
 * @param {Date} currentDate - Current date (optional, defaults to now)
 * @returns {string|null} Meeting URL or null if no meeting on that day
 */
function getMeetingUrlForDay(currentDate = new Date()) {
  try {
    // Get Bangladesh time components
    const bangladeshTime = getBangladeshTimeComponents(currentDate);
    
    // If it's early morning (midnight to 6 AM), use previous day's meeting
    let targetYear = bangladeshTime.year;
    let targetMonth = bangladeshTime.month;
    let targetDay = bangladeshTime.day;
    let targetDayOfWeek = bangladeshTime.dayOfWeek;
    let targetDateString = bangladeshTime.dateString;
    
    if (bangladeshTime.hour >= 0 && bangladeshTime.hour < 6) {
      // Early morning - use previous day
      // Fix: Use dateString directly to avoid timezone issues
      const targetDate = new Date(bangladeshTime.dateString);
      targetDate.setDate(targetDate.getDate() - 1);
      
      targetYear = targetDate.getFullYear();
      targetMonth = targetDate.getMonth() + 1;
      targetDay = targetDate.getDate();
      targetDayOfWeek = targetDate.getDay();
      targetDateString = targetDate.toISOString().slice(0, 10);
      
      logger.info("Using previous day for meeting URL selection", {
        currentHour: bangladeshTime.hour,
        originalDate: bangladeshTime.dateString,
        targetDate: targetDateString,
      });
    }
    
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayName = dayNames[targetDayOfWeek];
    
    logger.info("Determining meeting URL for day", {
      targetDate: targetDateString,
      dayOfWeek: targetDayOfWeek,
      dayName,
      bangladeshTime: `${bangladeshTime.dateString}T${String(bangladeshTime.hour).padStart(2, "0")}:${String(bangladeshTime.minute).padStart(2, "0")}:${String(bangladeshTime.second).padStart(2, "0")}+06:00`,
    });
    
    // Check if it's a meeting day
    if (targetDayOfWeek === 0 || targetDayOfWeek === 1) {
      // Sunday (0) or Monday (1) - no meetings
      logger.info("No meeting on this day", { dayName });
      return null;
    }
    
    // Determine which URL to use based on the CURRENT day (not target day)
    // If today is Tuesday/Thursday/Saturday → Use MWF URL
    // If today is Wednesday/Friday → Use TT URL
    let meetingUrl = null;
    let meetingType = null;
    
    if (bangladeshTime.dayOfWeek === 2 || bangladeshTime.dayOfWeek === 4 || bangladeshTime.dayOfWeek === 6) {
      // Today is Tuesday (2), Thursday (4), Saturday (6) - Use MWF URL
      meetingUrl = process.env.DAILY_STANDUP_URL_MWF;
      meetingType = "Using MWF URL";
    } else if (bangladeshTime.dayOfWeek === 3 || bangladeshTime.dayOfWeek === 5) {
      // Today is Wednesday (3), Friday (5) - Use TT URL
      meetingUrl = process.env.DAILY_STANDUP_URL_TT;
      meetingType = "Using TT URL";
    }
    
    if (!meetingUrl) {
      logger.error("Meeting URL environment variable not set", {
        dayName,
        meetingType,
        requiredEnvVar: meetingType === "MWF" ? "DAILY_STANDUP_URL_MWF" : "DAILY_STANDUP_URL_TT",
      });
      return null;
    }
    
    const currentDayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const currentDayName = currentDayNames[bangladeshTime.dayOfWeek];
    
    logger.info("Meeting URL selected", {
      currentDay: currentDayName,
      targetDay: dayName,
      todayIs: bangladeshTime.dayOfWeek === 2 || bangladeshTime.dayOfWeek === 4 || bangladeshTime.dayOfWeek === 6 ? "Tuesday/Thursday/Saturday" : "Wednesday/Friday",
      meetingType,
      hasUrl: !!meetingUrl,
      urlPrefix: meetingUrl.substring(0, 50) + "...",
      logic: bangladeshTime.dayOfWeek === 2 || bangladeshTime.dayOfWeek === 4 || bangladeshTime.dayOfWeek === 6 ? "Today is Tue/Thu/Sat → Use MWF URL" : "Today is Wed/Fri → Use TT URL"
    });
    
    return meetingUrl;
    
  } catch (error) {
    logger.error("Error determining meeting URL", {
      error: error.message,
      stack: error.stack,
    });
    return null;
  }
}

/**
 * Check if a given day should have a meeting
 * @param {Date} date - Date to check
 * @returns {boolean} True if there should be a meeting on this day
 */
function shouldHaveMeetingOnDay(date) {
  const bangladeshTime = getBangladeshTimeComponents(date);
  let targetDayOfWeek = bangladeshTime.dayOfWeek;
  
  // If early morning, check previous day
  if (bangladeshTime.hour >= 0 && bangladeshTime.hour < 6) {
    const targetDate = new Date(bangladeshTime.dateString);
    targetDate.setDate(targetDate.getDate() - 1);
    targetDayOfWeek = targetDate.getDay();
  }
  
  // Tuesday (2), Wednesday (3), Thursday (4), Friday (5), Saturday (6) have meetings
  // Sunday (0), Monday (1) do not
  return targetDayOfWeek >= 2 && targetDayOfWeek <= 6;
}

/**
 * Get the meeting type for a given day (which URL to use)
 * @param {Date} date - Date to check
 * @returns {string|null} Description of which URL to use, or null if no meeting
 */
function getMeetingTypeForDay(date) {
  const bangladeshTime = getBangladeshTimeComponents(date);
  
  // Use CURRENT day to determine URL type (not target day)
  // The target day logic is only for fetching the previous day's transcript
  if (bangladeshTime.dayOfWeek === 2 || bangladeshTime.dayOfWeek === 4 || bangladeshTime.dayOfWeek === 6) {
    // Today is Tuesday/Thursday/Saturday - Use MWF URL
    return "Use MWF URL";
  } else if (bangladeshTime.dayOfWeek === 3 || bangladeshTime.dayOfWeek === 5) {
    // Today is Wednesday/Friday - Use TT URL
    return "Use TT URL";
  }
  
  return null;
}

/**
 * Validate that required environment variables are set
 * @returns {Object} Validation result with success flag and missing variables
 */
function validateMeetingUrlEnvironment() {
  const requiredVars = ["DAILY_STANDUP_URL_MWF", "DAILY_STANDUP_URL_TT"];
  const missingVars = [];
  
  for (const envVar of requiredVars) {
    if (!process.env[envVar]) {
      missingVars.push(envVar);
    }
  }
  
  const isValid = missingVars.length === 0;
  
  if (!isValid) {
    logger.error("Missing meeting URL environment variables", {
      missingVars,
      requiredVars,
    });
  } else {
    logger.info("Meeting URL environment variables validated", {
      mwfUrlSet: !!process.env.DAILY_STANDUP_URL_MWF,
      ttUrlSet: !!process.env.DAILY_STANDUP_URL_TT,
    });
  }
  
  return {
    success: isValid,
    missingVars,
    requiredVars,
  };
}

/**
 * Get meeting URL with fallback to legacy DAILY_STANDUP_URL
 * This provides backward compatibility during transition
 * @param {Date} currentDate - Current date (optional)
 * @returns {string|null} Meeting URL or null if no meeting
 */
function getMeetingUrlWithFallback(currentDate = new Date()) {
  // First try the new day-based system
  const newSystemUrl = getMeetingUrlForDay(currentDate);
  
  if (newSystemUrl) {
    return newSystemUrl;
  }
  
  // If new system fails and it's a weekday, try legacy URL
  const shouldHaveMeeting = shouldHaveMeetingOnDay(currentDate);
  if (shouldHaveMeeting && process.env.DAILY_STANDUP_URL) {
    const bangladeshTime = getBangladeshTimeComponents(currentDate);
    logger.warn("Using legacy DAILY_STANDUP_URL as fallback", {
      date: bangladeshTime.dateString,
      hasLegacyUrl: !!process.env.DAILY_STANDUP_URL,
    });
    return process.env.DAILY_STANDUP_URL;
  }
  
  return null;
}

/**
 * Test the meeting URL service with various dates
 * @returns {Promise<Object>} Test results
 */
async function testMeetingUrlService() {
  const testResults = {
    environmentCheck: validateMeetingUrlEnvironment(),
    dayTests: []
  };
  
  // Test each day of the week
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const testDate = new Date(today);
    testDate.setDate(today.getDate() + i);
    
    const bangladeshTime = getBangladeshTimeComponents(testDate);
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    
    testResults.dayTests.push({
      date: bangladeshTime.dateString,
      dayName: dayNames[bangladeshTime.dayOfWeek],
      dayOfWeek: bangladeshTime.dayOfWeek,
      shouldHaveMeeting: shouldHaveMeetingOnDay(testDate),
      meetingType: getMeetingTypeForDay(testDate),
      meetingUrl: getMeetingUrlForDay(testDate) ? "URL_SET" : "NO_URL",
    });
  }
  
  return testResults;
}

module.exports = {
  getMeetingUrlForDay,
  shouldHaveMeetingOnDay,
  getMeetingTypeForDay,
  validateMeetingUrlEnvironment,
  getMeetingUrlWithFallback,
  testMeetingUrlService,
  getBangladeshTimeComponents, // Export for testing
};
