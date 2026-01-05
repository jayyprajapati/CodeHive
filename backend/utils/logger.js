/**
 * Structured Logger Utility
 * 
 * Provides consistent, structured logging for the backend with
 * categories for room lifecycle, socket events, and errors.
 * 
 * Log Format: [TIMESTAMP] [LEVEL] [CATEGORY] message { context }
 * 
 * @module logger
 */

/**
 * Log levels enum
 */
const LogLevel = Object.freeze({
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
});

/**
 * Log categories for filtering and organization
 */
const LogCategory = Object.freeze({
    ROOM: 'room',
    SOCKET: 'socket',
    SESSION: 'session',
    ERROR: 'error',
    SYSTEM: 'system'
});

/**
 * Whether to output verbose debug logs
 * Controlled by NODE_ENV environment variable
 */
const isDebugEnabled = process.env.NODE_ENV !== 'production';

/**
 * Format a log entry as a structured string
 * 
 * @param {string} level - Log level
 * @param {string} category - Log category
 * @param {string} message - Log message
 * @param {Object} context - Additional context data
 * @returns {string} Formatted log string
 */
function formatLogEntry(level, category, message, context = {}) {
    const timestamp = new Date().toISOString();
    const contextStr = Object.keys(context).length > 0
        ? ` ${JSON.stringify(context)}`
        : '';

    return `[${timestamp}] [${level}] [${category}] ${message}${contextStr}`;
}

/**
 * Core logging function
 * 
 * @param {string} level - Log level
 * @param {string} category - Log category  
 * @param {string} message - Log message
 * @param {Object} context - Additional context
 */
function log(level, category, message, context = {}) {
    const formatted = formatLogEntry(level, category, message, context);

    switch (level) {
        case LogLevel.ERROR:
            console.error(formatted);
            break;
        case LogLevel.WARN:
            console.warn(formatted);
            break;
        case LogLevel.DEBUG:
            if (isDebugEnabled) {
                console.debug(formatted);
            }
            break;
        default:
            console.log(formatted);
    }
}

// ============================================================================
// Convenience Methods
// ============================================================================

/**
 * Log room lifecycle events
 * 
 * @param {string} event - Lifecycle event (created, user_joined, user_left, destroyed)
 * @param {Object} context - Context data (sessionId, userId, userName, etc.)
 */
function room(event, context = {}) {
    log(LogLevel.INFO, LogCategory.ROOM, event, context);
}

/**
 * Log socket events
 * 
 * @param {string} event - Socket event name
 * @param {Object} context - Context data
 */
function socket(event, context = {}) {
    log(LogLevel.INFO, LogCategory.SOCKET, event, context);
}

/**
 * Log session operations
 * 
 * @param {string} event - Session event
 * @param {Object} context - Context data
 */
function session(event, context = {}) {
    log(LogLevel.INFO, LogCategory.SESSION, event, context);
}

/**
 * Log debug information
 * Only outputs in non-production environments
 * 
 * @param {string} message - Debug message
 * @param {Object} context - Context data
 */
function debug(message, context = {}) {
    log(LogLevel.DEBUG, LogCategory.SYSTEM, message, context);
}

/**
 * Log warning
 * 
 * @param {string} message - Warning message
 * @param {Object} context - Context data
 */
function warn(message, context = {}) {
    log(LogLevel.WARN, LogCategory.SYSTEM, message, context);
}

/**
 * Log error with optional error object
 * 
 * @param {string} message - Error message
 * @param {Error|Object} errorOrContext - Error object or context
 * @param {Object} [additionalContext] - Additional context if error provided
 */
function error(message, errorOrContext = {}, additionalContext = {}) {
    let context = {};

    if (errorOrContext instanceof Error) {
        context = {
            error: errorOrContext.message,
            stack: isDebugEnabled ? errorOrContext.stack : undefined,
            ...additionalContext
        };
    } else {
        context = errorOrContext;
    }

    log(LogLevel.ERROR, LogCategory.ERROR, message, context);
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
    // Core
    log,
    LogLevel,
    LogCategory,

    // Convenience methods
    room,
    socket,
    session,
    debug,
    warn,
    error
};
