const { Session } = require('../Models/Session');
const crypto = require('crypto');
// const NodeCache = require('node-cache');

// Create new session
async function createSession(sessionId, password, owner) {
  try {
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    const session = new Session({
      sessionId,
      users: [],
      code: '// New session started...',
      chat: [],
      password: hashedPassword,
      owner,
      active: true,
      createdAt: new Date()
    });
    await session.save();
  } catch (error) {
    throw new Error(`Error creating session: ${error.message}`);
  }
}

// Verify session exists and password matches
async function verifySession(sessionId, password) {
  try {
    const session = await Session.findOne({ sessionId });
    if (!session || !session.active) return false;
    return session.password === crypto.createHash('sha256').update(password).digest('hex');
  } catch (error) {
    throw new Error(`Error verifying session: ${error.message}`);
  }
}

// Check if session exists
async function sessionExists(sessionId) {
  try {
    return !!(await Session.findOne({ sessionId }));
  } catch (error) {
    throw new Error(`Error checking session existence: ${error.message}`);
  }
}

// const sessionCache = new NodeCache({ stdTTL: 300, checkperiod: 600 });
// Get session by ID
async function getSession(sessionId) {
    try {
        return Session.findOne({ sessionId }).lean();
    } catch (error) {
        throw new Error(`Error getting session: ${error.message}`);
    }
}

async function updateSession(sessionId, update) {
    try {
        return Session.updateOne({ sessionId }, update);
    } catch (error) {
        throw new Error(`Error updating session: ${error.message}`);
    }
  }
  
  async function removeUserFromSession(sessionId, socketId) {
    try {
        // sessionCache.del(sessionId);
        return Session.updateOne(
            { sessionId },
            { $pull: { users: { socketId } } }
        );
    } catch (error) {
        throw new Error(`Error removing user from session: ${error.message}`);
    }
  }

  function isCodeSafe(code, language) {
    const bannedPatterns = {
      python: [
        /import\s+(os|subprocess|sys|shutil|platform)/,
        /from\s+(os|subprocess|sys)\s+import/,
        /eval\(|exec\(|open\(|system\(/
      ],
      javascript: [
        /require\(['"]child_process['"]\)/,
        /require\(['"]fs['"]\)/,
        /eval\(|new Function\(|process\.(exit|kill)/
      ],
      java: [
        /Runtime\.getRuntime\(\)/,
        /ProcessBuilder|UNIXProcess/,
        /exec\(|反射/
      ]
    };
    return !bannedPatterns[language]?.some(pattern => pattern.test(code));
  }

  module.exports = {createSession, verifySession, sessionExists, getSession, updateSession, removeUserFromSession, isCodeSafe}