/**
 * Meeting URL Service - Handles day-based meeting URL selection
 * 
 * This service determines which meeting URL to use based on the day of the week:
 * - MWF (Monday, Wednesday, Friday): Use DAILY_STANDUP_URL_MWF
 * - TT (Tuesday, Thursday): Use DAILY_STANDUP_URL_TT
 * - Weekend (Saturday, Sunday): No meetings
 */

const {logger} = require("firebase-functions");

// Load environment variables
require('dotenv').config();

/**
 * Get the appropriate meeting URL based on the current day
 * When running at 2 AM Bangladesh time, use the previous day's meeting URL
 * @param {Date} currentDate - Current date (optional, defaults to now)
 * @returns {string|null} Meeting URL or null if no meeting on that day
 */
function getMeetingUrlForDay(currentDate = new Date()) {
  try {
    // Convert to Bangladesh timezone (UTC+6)
    const bangladeshTime = new Date(currentDate.toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
    
    // If it's 2 AM or later but before 6 AM, use previous day's meeting
    // This handles the scheduled function running at 2 AM for the previous day's meeting
    const hour = bangladeshTime.getHours();
    let targetDate = new Date(bangladeshTime);
    
    if (hour >= 0 && hour < 6) {
      // Early morning (midnight to 6 AM) - use previous day
      targetDate.setDate(targetDate.getDate() - 1);
      logger.info('Using previous day for meeting URL selection', {
        currentHour: hour,
        originalDate: bangladeshTime.toISOString().split('T')[0],
        targetDate: targetDate.toISOString().split('T')[0],
      });
    }
    
    // Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    const dayOfWeek = targetDate.getDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = dayNames[dayOfWeek];
    
    logger.info('Determining meeting URL for day', {
      targetDate: targetDate.toISOString().split('T')[0],
      dayOfWeek,
      dayName,
      bangladeshTime: bangladeshTime.toISOString(),
    });
    
    // Check if it's a meeting day
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      // Sunday (0) or Saturday (6) - no meetings
      logger.info('No meeting on weekend', { dayName });
      return null;
    }
    
    // Determine which URL to use (INVERTED LOGIC for previous day's meeting)
    // If today is TT (Tue/Thu), use MWF URL (for Mon/Wed meeting)
    // If today is MWF (Mon/Wed/Fri), use TT URL (for Tue/Thu meeting)
    let meetingUrl = null;
    let meetingType = null;
    
    if (dayOfWeek === 2 || dayOfWeek === 4) {
      // Tuesday (2), Thursday (4) - Use MWF URL (for Mon/Wed previous meeting)
      meetingUrl = process.env.DAILY_STANDUP_URL_MWF;
      meetingType = 'Using MWF URL (for Mon/Wed meeting)';
    } else if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
      // Monday (1), Wednesday (3), Friday (5) - Use TT URL (for Tue/Thu previous meeting)
      meetingUrl = process.env.DAILY_STANDUP_URL_TT;
      meetingType = 'Using TT URL (for Tue/Thu meeting)';
    }
    
    if (!meetingUrl) {
      logger.error('Meeting URL environment variable not set', {
        dayName,
        meetingType,
        requiredEnvVar: meetingType === 'MWF' ? 'DAILY_STANDUP_URL_MWF' : 'DAILY_STANDUP_URL_TT',
      });
      return null;
    }
    
    logger.info('Meeting URL selected', {
      dayName,
      todayIs: dayOfWeek === 2 || dayOfWeek === 4 ? 'Tuesday/Thursday' : 'Monday/Wednesday/Friday',
      meetingType,
      hasUrl: !!meetingUrl,
      urlPrefix: meetingUrl.substring(0, 50) + '...',
      logic: dayOfWeek === 2 || dayOfWeek === 4 ? 'Today is Tue/Thu → Use MWF URL' : 'Today is Mon/Wed/Fri → Use TT URL'
    });
    
    return meetingUrl;
    
  } catch (error) {
    logger.error('Error determining meeting URL', {
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
  const dayOfWeek = date.getDay();
  // Monday (1), Tuesday (2), Wednesday (3), Thursday (4), Friday (5) have meetings
  // Saturday (6), Sunday (0) do not
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

/**
 * Get the meeting type for a given day (which URL to use)
 * @param {Date} date - Date to check
 * @returns {string|null} Description of which URL to use, or null if no meeting
 */
function getMeetingTypeForDay(date) {
  const dayOfWeek = date.getDay();
  
  if (dayOfWeek === 2 || dayOfWeek === 4) {
    // Tuesday/Thursday - Use MWF URL for Monday/Wednesday meeting
    return 'Use MWF URL';
  } else if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
    // Monday/Wednesday/Friday - Use TT URL for Tuesday/Thursday meeting  
    return 'Use TT URL';
  }
  
  return null;
}

/**
 * Validate that required environment variables are set
 * @returns {Object} Validation result with success flag and missing variables
 */
function validateMeetingUrlEnvironment() {
  const requiredVars = ['DAILY_STANDUP_URL_MWF', 'DAILY_STANDUP_URL_TT'];
  const missingVars = [];
  
  for (const envVar of requiredVars) {
    if (!process.env[envVar]) {
      missingVars.push(envVar);
    }
  }
  
  const isValid = missingVars.length === 0;
  
  if (!isValid) {
    logger.error('Missing meeting URL environment variables', {
      missingVars,
      requiredVars,
    });
  } else {
    logger.info('Meeting URL environment variables validated', {
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
    logger.warn('Using legacy DAILY_STANDUP_URL as fallback', {
      date: currentDate.toISOString().split('T')[0],
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
    
    const dayOfWeek = testDate.getDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    testResults.dayTests.push({
      date: testDate.toISOString().split('T')[0],
      dayName: dayNames[dayOfWeek],
      dayOfWeek,
      shouldHaveMeeting: shouldHaveMeetingOnDay(testDate),
      meetingType: getMeetingTypeForDay(testDate),
      meetingUrl: getMeetingUrlForDay(testDate) ? 'URL_SET' : 'NO_URL',
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
};
