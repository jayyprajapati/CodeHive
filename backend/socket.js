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
const { Session } = require('./Models/Session');
const {
  verifySession,
  sessionExists,
  getSession,
  removeUserFromSession,
  isCodeSafe
} = require('./middleware/SessionManagement');
const logger = require('./utils/logger');
const { executionManager } = require('./services/executionManager');

// ============================================================================
// Constants
// ============================================================================

const SUPPORTED_LANGUAGES = {
  javascript: { file: 'main.js', run: 'node main.js', image: 'node:20-alpine' },
  python: { file: 'main.py', run: 'python main.py', image: 'python:3.12-alpine' },
  java: { file: 'Code.java', run: 'javac Code.java && java Code', image: 'amazoncorretto:17-alpine' }
};

const DEFAULT_LANGUAGE = 'javascript';
const MAX_STDIN_CHARS = 64 * 1024; // Keep stdin bursts bounded

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getSessionWithMembership(sessionId, socketId) {
  const session = await getSession(sessionId);
  const isMember = session?.users?.some(u => u.socketId === socketId) || false;
  return { session, isMember };
}

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

  // ============================================================================
  // Connection Handler
  // ============================================================================

  io.on('connect', (socket) => {
    logger.socket('client_connected', { socketId: socket.id });

    const joinedSessions = new Set();

    const terminalHooks = (sessionId) => ({
      onOutput: (chunk) => {
        const output = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
        logger.debug('terminal_chunk', { sessionId, sample: output.slice(0, 120) });
        io.to(sessionId).emit('terminal-output', {
          sessionId,
          output
        });
      },
      onExit: (reason) => io.to(sessionId).emit('terminal-closed', {
        sessionId,
        reason
      })
    });

    const ensureTerminal = async (sessionId) => {
      await executionManager.ensureSession(sessionId, terminalHooks(sessionId));
    };

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

        await executionManager.registerClient(sessionId, terminalHooks(sessionId));
        joinedSessions.add(sessionId);

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

        await executionManager.shutdown(sessionId, 'owner_ended', true);

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

        await executionManager.deregisterClient(sessionId);
        joinedSessions.delete(sessionId);

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
          await executionManager.shutdown(sessionId, 'room_empty');
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
    // Interactive Terminal
    // --------------------------------------------------------------------------

    socket.on('terminal-input', async (data = {}) => {
      try {
        const { sessionId, input } = data;

        if (!sessionId || !input) return;
        if (typeof input !== 'string' || input.length > MAX_STDIN_CHARS) {
          return socket.emit('error', {
            message: 'Input too large',
            code: 'STDIN_TOO_LARGE'
          });
        }

        const { session, isMember } = await getSessionWithMembership(sessionId, socket.id);
        if (!session || !isMember) {
          logger.warn('terminal_input_rejected', { sessionId, socketId: socket.id, hasSession: !!session, isMember });
          return socket.emit('error', {
            message: 'You are not part of this session',
            code: 'NOT_IN_SESSION'
          });
        }

        await ensureTerminal(sessionId);
        await executionManager.write(sessionId, input);

      } catch (error) {
        logger.error('terminal-input handler failed', error, { sessionId: data?.sessionId });
        socket.emit('error', {
          message: 'Failed to send input to terminal',
          code: 'TERMINAL_INPUT_ERROR'
        });
      }
    });

    socket.on('terminal-resize', async (data = {}) => {
      try {
        const { sessionId, cols, rows } = data;
        if (!sessionId || !cols || !rows) return;

        const { session, isMember } = await getSessionWithMembership(sessionId, socket.id);
        if (!session || !isMember) return;

        await executionManager.resize(sessionId, cols, rows);
      } catch (error) {
        logger.warn('terminal-resize handler failed', { error: error.message, sessionId: data?.sessionId });
      }
    });

    socket.on('terminal-shutdown', async (data = {}) => {
      try {
        const { sessionId, userId, force } = data;
        if (!sessionId) return;

        const session = await getSession(sessionId);
        if (!session) {
          return socket.emit('error', {
            message: 'Session not found',
            code: 'SESSION_NOT_FOUND'
          });
        }

        if (session.owner !== userId) {
          return socket.emit('error', {
            message: 'Only the session owner can stop the terminal',
            code: 'UNAUTHORIZED'
          });
        }

        await executionManager.shutdown(sessionId, 'manual_shutdown', !!force);
        io.to(sessionId).emit('terminal-closed', { sessionId, reason: 'manual_shutdown' });

      } catch (error) {
        logger.error('terminal-shutdown handler failed', error, { sessionId: data?.sessionId });
        socket.emit('error', {
          message: 'Failed to stop terminal',
          code: 'TERMINAL_STOP_ERROR'
        });
      }
    });
    /**
     * Handle code execution requests by injecting commands into the PTY shell.
     * This enables interactive stdin support for programs like Python input().
     */
    socket.on('run-code', async (data = {}) => {
      const { sessionId, code = '', language } = data;

      logger.debug('code_execution_requested', { sessionId, language });

      try {
        const { session, isMember } = await getSessionWithMembership(sessionId, socket.id);

        if (!session || !session.active) {
          return socket.emit('error', {
            message: 'Invalid session',
            code: 'SESSION_INVALID'
          });
        }

        if (!isMember) {
          return socket.emit('error', {
            message: 'You are not part of this session',
            code: 'NOT_IN_SESSION'
          });
        }

        const langKey = SUPPORTED_LANGUAGES[language] ? language : DEFAULT_LANGUAGE;
        const langConfig = SUPPORTED_LANGUAGES[langKey];

        if (!SUPPORTED_LANGUAGES[language] && language) {
          io.to(sessionId).emit('terminal-output', {
            sessionId,
            output: `[server] Language ${language} not enabled; using ${langKey}.\n`
          });
        }

        if (!isCodeSafe(code, langKey)) {
          logger.warn('code_execution_blocked: unsafe_code', { sessionId, language: langKey });
          return io.to(sessionId).emit('terminal-output', {
            sessionId,
            output: 'Error: Code contains prohibited patterns\n'
          });
        }

        // Ensure container is running with multi-language support
        await ensureTerminal(sessionId);

        // Use heredoc to write code file and run it through the PTY
        // This allows interactive stdin since the PTY has live terminal I/O
        const delimiter = `EOF_${Date.now()}`;
        const commands = [
          `cat > ${langConfig.file} << '${delimiter}'`,
          code,
          delimiter,
          langConfig.run
        ].join('\n');

        // Write commands to the PTY shell
        await executionManager.write(sessionId, commands + '\n');

        // Notify that execution has started (output streams via PTY)
        io.to(sessionId).emit('execution-started', { sessionId, language: langKey });

        logger.debug('code_execution_started', { sessionId, language: langKey });

      } catch (error) {
        logger.error('run-code handler failed', error, { sessionId, language });
        io.to(sessionId).emit('terminal-output', {
          sessionId,
          output: `Execution error: ${error.message}\n`
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

            await executionManager.deregisterClient(session.sessionId);
            joinedSessions.delete(session.sessionId);

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
              await executionManager.shutdown(session.sessionId, 'empty_after_disconnect');
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