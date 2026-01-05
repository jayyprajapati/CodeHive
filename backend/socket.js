/**
 * WebSocket Server - Real-time Collaboration Handler
 * 
 * Manages Socket.IO connections for the collaborative coding platform.
 * Handles room lifecycle, code synchronization, chat, and code execution.
 * 
 * Room Lifecycle:
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  1. ROOM CREATION: Implicit when first user joins via 'join-session'│
 * │  2. USER JOIN: User authenticated and added to room                 │
 * │  3. USER LEAVE: User explicitly leaves or disconnects               │
 * │  4. ROOM DESTROY: Owner ends session OR room becomes empty          │
 * └─────────────────────────────────────────────────────────────────────┘
 * 
 * @module socket
 */

const { Server } = require('socket.io');
const Docker = require('dockerode');
const { Buffer } = require('buffer');
const axios = require('axios');
const { Session } = require('./Models/Session');
const {
  verifySession,
  sessionExists,
  getSession,
  removeUserFromSession,
  isCodeSafe
} = require('./middleware/SessionManagement');
const logger = require('./utils/logger');

// ============================================================================
// Constants
// ============================================================================

const PISTON_API_URL = 'https://emkc.org/api/v2/piston/execute';
const ALLOWED_LANGUAGES = {
  javascript: { version: '18.15.0' },
  python: { version: '3.10.0' },
  java: { version: '15.0.2' }
};

// Maximum output length to prevent memory issues
const MAX_OUTPUT_LENGTH = 2000;

// Execution timeouts
const COMPILE_TIMEOUT = 10000;
const RUN_TIMEOUT = 5000;

// ============================================================================
// Socket Server Initialization
// ============================================================================

/**
 * Initialize the Socket.IO server with CORS configuration.
 * 
 * @param {import('http').Server} httpServer - HTTP server instance
 * @returns {import('socket.io').Server} Configured Socket.IO server
 */
const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: "https://*.jayprajapati.me",
      methods: ["GET", "POST"],
      allowedHeaders: ["Authorization"],
      credentials: true
    },
    transports: ['websocket']
  });

  // Docker instance for potential local execution (not currently used)
  const docker = new Docker();

  // ============================================================================
  // Connection Handler
  // ============================================================================

  io.on('connect', (socket) => {
    logger.socket('client_connected', { socketId: socket.id });

    // --------------------------------------------------------------------------
    // ROOM LIFECYCLE: Join Session
    // --------------------------------------------------------------------------

    /**
     * Handle user joining a session room.
     * 
     * Flow:
     * 1. Validate session exists and password matches
     * 2. Add user to session in database
     * 3. Join socket room
     * 4. Broadcast user joined to room
     * 5. Send session data to joining user
     * 
     * @emits 'error' - If session invalid or internal error
     * @emits 'user-list' - Updated user list to all room members
     * @emits 'user-joined' - Notification to other room members
     * @emits 'session-data' - Session state to joining user
     */
    socket.on('join-session', async (data) => {
      try {
        const { sessionId, password, user, userId } = data;

        logger.room('user_joining', { sessionId, userName: user, socketId: socket.id });

        // Validate session
        const sessionValid = await sessionExists(sessionId);
        const passwordValid = await verifySession(sessionId, password);

        if (!sessionValid || !passwordValid) {
          logger.warn('join_failed: invalid credentials', { sessionId, userName: user });
          return socket.emit('error', {
            message: 'Invalid session or password',
            code: 'AUTH_FAILED'
          });
        }

        const session = await getSession(sessionId);

        // Create user entry
        const userEntry = {
          socketId: socket.id,
          name: user,
          userId,
          role: userId === session.owner ? 'owner' : 'editor'
        };

        // Add user to session in database
        await Session.updateOne(
          { sessionId },
          { $push: { users: userEntry } }
        );

        // Join socket room
        socket.join(sessionId);

        // Get updated session state
        const updatedSession = await getSession(sessionId);

        logger.room('user_joined', {
          sessionId,
          userName: user,
          role: userEntry.role,
          totalUsers: updatedSession.users.length
        });

        // Broadcast updated user list to all room members
        io.to(sessionId).emit('user-list',
          updatedSession.users.map(u => ({ name: u.name, role: u.role }))
        );

        // Notify others about new user
        socket.broadcast.to(sessionId).emit('user-joined', { user });

        // Send session data to joining user
        socket.emit('session-data', {
          code: updatedSession.code,
          chat: updatedSession.chat,
          role: updatedSession.users.find(u => u.socketId === socket.id)?.role || 'viewer'
        });

      } catch (error) {
        logger.error('join-session handler failed', error, {
          sessionId: data?.sessionId
        });
        socket.emit('error', {
          message: 'Failed to join session. Please try again.',
          code: 'JOIN_ERROR'
        });
      }
    });

    // --------------------------------------------------------------------------
    // Role Management
    // --------------------------------------------------------------------------

    /**
     * Handle role change requests from session owner.
     * Only the session owner can change other users' roles.
     * 
     * @emits 'role-updated' - New role info to all room members
     * @emits 'error' - If unauthorized or operation fails
     */
    socket.on('change-role', async (data) => {
      try {
        const { sessionId, targetUser, newRole } = data;

        logger.debug('role_change_requested', { sessionId, targetUser, newRole });

        const session = await getSession(sessionId);
        if (!session) {
          return socket.emit('error', {
            message: 'Session not found',
            code: 'SESSION_NOT_FOUND'
          });
        }

        // Verify requester is owner
        const requester = session.users.find(u => u.socketId === socket.id);
        if (requester?.role !== 'owner') {
          logger.warn('role_change_unauthorized', {
            sessionId,
            requesterId: socket.id
          });
          return socket.emit('error', {
            message: 'Only the session owner can change roles',
            code: 'UNAUTHORIZED'
          });
        }

        // Update role in database
        await Session.findOneAndUpdate(
          { sessionId, "users.name": targetUser },
          { $set: { "users.$.role": newRole } }
        );

        const updatedSession = await getSession(sessionId);

        logger.room('role_changed', { sessionId, targetUser, newRole });

        // Broadcast role update
        io.to(sessionId).emit('role-updated', {
          user: targetUser,
          newRole: newRole,
          userList: updatedSession.users.map(u => ({
            name: u.name,
            role: u.role
          }))
        });

      } catch (error) {
        logger.error('change-role handler failed', error, {
          sessionId: data?.sessionId
        });
        socket.emit('error', {
          message: 'Failed to change role',
          code: 'ROLE_CHANGE_ERROR'
        });
      }
    });

    // --------------------------------------------------------------------------
    // ROOM LIFECYCLE: End Session (Owner Only)
    // --------------------------------------------------------------------------

    /**
     * Handle session termination by owner.
     * Destroys the room and kicks all users.
     * 
     * @emits 'session-ended' - Notification to all room members
     */
    socket.on('end-session', async (data) => {
      try {
        const { sessionId, userId } = data;

        logger.room('session_end_requested', { sessionId, userId });

        const session = await getSession(sessionId);

        // Only owner can end session
        if (session?.owner !== userId) {
          logger.warn('end_session_unauthorized', { sessionId, userId });
          return socket.emit('error', {
            message: 'Only the session owner can end the session',
            code: 'UNAUTHORIZED'
          });
        }

        // Delete session from database
        await Session.deleteOne({ sessionId });

        logger.room('session_destroyed', {
          sessionId,
          reason: 'owner_ended',
          userCount: session.users.length
        });

        // Notify all room members
        io.to(sessionId).emit('session-ended', {
          reason: 'owner_ended',
          message: 'The session owner has ended this session'
        });

      } catch (error) {
        logger.error('end-session handler failed', error, {
          sessionId: data?.sessionId
        });
        socket.emit('error', {
          message: 'Failed to end session',
          code: 'END_SESSION_ERROR'
        });
      }
    });

    // --------------------------------------------------------------------------
    // ROOM LIFECYCLE: Leave Session
    // --------------------------------------------------------------------------

    /**
     * Handle user leaving a session voluntarily.
     * 
     * @emits 'user-left' - Notification to remaining room members
     */
    socket.on('leave-session', async (sessionId) => {
      try {
        logger.room('user_leaving', { sessionId, socketId: socket.id });

        const session = await getSession(sessionId);
        if (!session) {
          logger.warn('leave_session: session_not_found', { sessionId });
          return;
        }

        const user = session.users.find(u => u.socketId === socket.id);
        if (!user) {
          logger.warn('leave_session: user_not_in_session', {
            sessionId,
            socketId: socket.id
          });
          return;
        }

        // Remove user from database
        await removeUserFromSession(sessionId, socket.id);

        // Leave socket room
        socket.leave(sessionId);

        logger.room('user_left', {
          sessionId,
          userName: user.name,
          role: user.role
        });

        // Notify remaining users
        io.to(sessionId).emit('user-left', {
          user: user.name,
          message: `${user.name} has left the session`
        });

        // Check if room should be destroyed (empty after user left)
        const updatedSession = await getSession(sessionId);
        if (updatedSession && updatedSession.users.length === 0) {
          logger.room('session_destroying_empty', { sessionId });
          await Session.deleteOne({ sessionId });
          logger.room('session_destroyed', { sessionId, reason: 'empty' });
        }

      } catch (error) {
        logger.error('leave-session handler failed', error, { sessionId });
      }
    });

    // --------------------------------------------------------------------------
    // Code Synchronization
    // --------------------------------------------------------------------------

    /**
     * Handle real-time code changes.
     * Broadcasts code to all other room members.
     * 
     * @emits 'code-update' - New code to other room members
     */
    socket.on('code-change', async (data) => {
      try {
        await Session.findOneAndUpdate(
          { sessionId: data.sessionId },
          { $set: { code: data.code } }
        );
        socket.broadcast.to(data.sessionId).emit('code-update', data.code);

      } catch (error) {
        logger.error('code-change handler failed', error, {
          sessionId: data?.sessionId
        });
        socket.emit('error', {
          message: 'Failed to sync code',
          code: 'SYNC_ERROR'
        });
      }
    });

    // --------------------------------------------------------------------------
    // Chat
    // --------------------------------------------------------------------------

    /**
     * Handle chat messages.
     * Stores message in database and broadcasts to room.
     * 
     * @emits 'chat-message' - Message to all room members
     */
    socket.on('send-chat-message', async (data) => {
      try {
        const session = await getSession(data.sessionId);
        if (!session) {
          return socket.emit('error', {
            message: 'Session not found',
            code: 'SESSION_NOT_FOUND'
          });
        }

        const user = session.users.find(u => u.socketId === socket.id);
        if (!user) {
          return socket.emit('error', {
            message: 'You are not in this session',
            code: 'NOT_IN_SESSION'
          });
        }

        const message = {
          user: user.name,
          message: data.message,
          timestamp: new Date().toISOString()
        };

        await Session.findOneAndUpdate(
          { sessionId: data.sessionId },
          { $push: { chat: message } }
        );

        io.to(data.sessionId).emit('chat-message', message);

      } catch (error) {
        logger.error('send-chat-message handler failed', error, {
          sessionId: data?.sessionId
        });
        socket.emit('error', {
          message: 'Failed to send message',
          code: 'CHAT_ERROR'
        });
      }
    });

    // --------------------------------------------------------------------------
    // Code Execution
    // --------------------------------------------------------------------------

    /**
     * Handle code execution requests.
     * Uses Piston API for sandboxed code execution.
     * 
     * @emits 'terminal-output' - Execution output to all room members
     * @emits 'execution-complete' - Signal that execution finished
     * @emits 'error' - If execution fails
     */
    socket.on('run-code', async (data) => {
      const { sessionId, code, language } = data;

      logger.debug('code_execution_requested', { sessionId, language });

      // Validate session
      const session = await getSession(sessionId);
      if (!session || !session.active) {
        return socket.emit('error', {
          message: 'Invalid session',
          code: 'SESSION_INVALID'
        });
      }

      // Security check on code
      if (!isCodeSafe(code, language)) {
        logger.warn('code_execution_blocked: unsafe_code', {
          sessionId,
          language
        });
        return io.to(sessionId).emit('terminal-output', {
          sessionId,
          output: "Error: Code contains prohibited patterns\n"
        });
      }

      try {
        // Execute via Piston API
        const response = await axios.post(PISTON_API_URL, {
          language: language,
          version: ALLOWED_LANGUAGES[language].version,
          files: [{ content: code }],
          stdin: '',
          args: [],
          compile_timeout: COMPILE_TIMEOUT,
          run_timeout: RUN_TIMEOUT,
          compile_memory_limit: -1,
          run_memory_limit: -1
        });

        const result = response.data;
        let output = '';

        // Handle compilation errors
        if (result.compile && result.compile.stderr) {
          output += `Compilation Error:\n${result.compile.stderr}\n`;
        }

        // Handle runtime errors
        if (result.run.stderr) {
          output += `Runtime Error:\n${result.run.stderr}\n`;
        }

        // Handle standard output
        if (result.run.stdout) {
          output += `Output:\n${result.run.stdout}\n`;
        }

        // Sanitize and limit output length
        const sanitizedOutput = output
          .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
          .slice(0, MAX_OUTPUT_LENGTH);

        // Send output to all room members
        io.to(sessionId).emit('terminal-output', {
          sessionId,
          output: sanitizedOutput
        });

        // Signal execution complete
        io.to(sessionId).emit('execution-complete', { sessionId });

        logger.debug('code_execution_complete', { sessionId, language });

      } catch (error) {
        logger.error('run-code handler failed', error, { sessionId, language });

        const errorMessage = error.response?.data?.output || error.message;
        io.to(sessionId).emit('terminal-output', {
          sessionId,
          output: `Execution error: ${errorMessage}\n`
        });
      }
    });

    // --------------------------------------------------------------------------
    // ROOM LIFECYCLE: Disconnect Cleanup
    // --------------------------------------------------------------------------

    /**
     * Handle socket disconnection.
     * Cleans up user from all sessions they were part of.
     * 
     * @emits 'user-left' - Notification to remaining room members
     */
    socket.on('disconnect', async () => {
      try {
        logger.socket('client_disconnected', { socketId: socket.id });

        // Find all sessions this socket was in
        const sessions = await Session.find({
          'users.socketId': socket.id
        });

        for (const session of sessions) {
          const user = session.users.find(u => u.socketId === socket.id);

          if (user) {
            // Remove user from session
            await Session.updateOne(
              { sessionId: session.sessionId },
              { $pull: { users: { socketId: socket.id } } }
            );

            logger.room('user_disconnected', {
              sessionId: session.sessionId,
              userName: user.name
            });

            // Notify room
            io.to(session.sessionId).emit('user-left', {
              user: user.name,
              message: `${user.name} has disconnected`
            });

            // Check if room should be destroyed
            const updatedSession = await getSession(session.sessionId);
            if (updatedSession && updatedSession.users.length === 0) {
              logger.room('session_destroying_empty', {
                sessionId: session.sessionId
              });
              await Session.deleteOne({ sessionId: session.sessionId });
              logger.room('session_destroyed', {
                sessionId: session.sessionId,
                reason: 'empty_after_disconnect'
              });
            }
          }
        }

      } catch (error) {
        logger.error('disconnect cleanup failed', error, {
          socketId: socket.id
        });
      }
    });
  });
};

module.exports = initSocket;