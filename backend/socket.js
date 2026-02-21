/**
 * WebSocket Server - Real-time Collaboration + Playground Handler
 * 
 * Manages Socket.IO connections for the collaborative coding platform.
 * Supports two session types:
 *   - "playground"     → ephemeral, in-memory, single user, no DB
 *   - "collaborative"  → DB-backed, multi-user, roles, chat, presence
 * 
 * Both modes share the same PTY/Docker execution engine.
 * 
 * @module socket
 */

const { Server } = require('socket.io');
const { Session } = require('./models/Session');
const {
  verifySession,
  sessionExists,
  getSession,
  removeUserFromSession,
  isCodeSafe
} = require('./middleware/SessionManagement');
const logger = require('./utils/logger');
const { executionManager } = require('./services/executionManager');
const limits = require('./config/resourceLimits');
const crypto = require('crypto');

// ============================================================================
// Constants
// ============================================================================

const SUPPORTED_LANGUAGES = {
  javascript: { file: 'main.js', run: 'node main.js', image: 'node:20-alpine' },
  python: { file: 'main.py', run: 'python main.py', image: 'python:3.12-alpine' },
  java: { file: 'Code.java', run: 'javac Code.java && java Code', image: 'amazoncorretto:17-alpine' }
};

const DEFAULT_LANGUAGE = 'javascript';
const MAX_STDIN_CHARS = 64 * 1024;
const TERMINAL_CONTROL_ROLES = new Set(['owner', 'editor']);
const presenceBySession = new Map();

// ============================================================================
// Global Session Counter
// ============================================================================

let activeSessionCount = 0;

function getActiveSessionCount() {
  return activeSessionCount;
}

function incrementSessionCount() {
  activeSessionCount++;
  logger.debug('session_count_incremented', { count: activeSessionCount });
}

function decrementSessionCount() {
  activeSessionCount = Math.max(0, activeSessionCount - 1);
  logger.debug('session_count_decremented', { count: activeSessionCount });
}

function isCapacityAvailable() {
  return activeSessionCount < limits.MAX_ACTIVE_SESSIONS;
}

// ============================================================================
// Playground In-Memory Store
// ============================================================================

/**
 * In-memory store for playground sessions.
 * Each entry: { sessionId, socketId, code, language, createdAt }
 * No DB persistence, no password, no roles.
 */
const playgroundSessions = new Map();

/**
 * Set of playground sessionIds for O(1) lookup.
 */
function isPlayground(sessionId) {
  return playgroundSessions.has(sessionId);
}

function generatePlaygroundId() {
  return 'pg-' + crypto.randomBytes(8).toString('hex');
}

// ============================================================================
// Shared Helpers
// ============================================================================

async function getSessionWithMembership(sessionId, socketId) {
  // Playground sessions — single user is always a member
  if (isPlayground(sessionId)) {
    const pg = playgroundSessions.get(sessionId);
    if (pg && pg.socketId === socketId) {
      return { session: pg, isMember: true, isPlaygroundSession: true };
    }
    return { session: null, isMember: false, isPlaygroundSession: true };
  }

  // Collaborative sessions — DB lookup
  const session = await getSession(sessionId);
  const isMember = session?.users?.some(u => u.socketId === socketId) || false;
  return { session, isMember, isPlaygroundSession: false };
}

function canControlTerminal(user) {
  return !!user && TERMINAL_CONTROL_ROLES.has(user.role);
}

function getPresenceMap(sessionId) {
  if (!presenceBySession.has(sessionId)) {
    presenceBySession.set(sessionId, new Map());
  }
  return presenceBySession.get(sessionId);
}

// ============================================================================
// Socket Server Initialization
// ============================================================================

const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
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
    const joinedPlaygrounds = new Set();

    const terminalHooks = (sessionId) => ({
      onOutput: (chunk) => {
        const output = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
        logger.debug('terminal_chunk', { sessionId, sample: output.slice(0, 120) });
        io.to(sessionId).emit('terminal-output', {
          sessionId,
          output
        });
      },
      onExit: (reason) => {
        // Emit specific terminal-error events for OOM and timeout
        if (reason === 'memory_limit_exceeded') {
          io.to(sessionId).emit('terminal-error', {
            sessionId,
            reason: 'memory_limit_exceeded',
            message: 'Container killed: memory limit exceeded'
          });
        }
        io.to(sessionId).emit('terminal-closed', {
          sessionId,
          reason
        });
      }
    });

    const ensureTerminal = async (sessionId) => {
      try {
        await executionManager.ensureSession(sessionId, terminalHooks(sessionId));
      } catch (err) {
        if (err.message === 'CONTAINER_LIMIT_REACHED') {
          logger.safety('container_spawn_failed', { sessionId, reason: 'container_limit' });
          socket.emit('error', {
            message: 'Server container limit reached. Please try again later.',
            code: 'CONTAINER_LIMIT_REACHED'
          });
          throw err;
        }
        throw err;
      }
    };

    const getControllerPayload = (user) => {
      if (!user) return null;
      return {
        socketId: user.socketId,
        userId: user.userId,
        name: user.name
      };
    };

    const setTerminalController = async (sessionId, controllerUser, reason, actorUser) => {
      const controllerPayload = getControllerPayload(controllerUser);

      await Session.updateOne(
        { sessionId },
        { $set: { terminalController: controllerPayload } }
      );

      logger.room('terminal_control_changed', {
        sessionId,
        controller: controllerPayload?.name || null,
        reason,
        actor: actorUser?.name || actorUser?.socketId || null
      });

      io.to(sessionId).emit('terminal-control-changed', {
        sessionId,
        controller: controllerPayload,
        reason
      });
    };

    const updatePresence = (sessionId, user, payload = {}) => {
      const map = getPresenceMap(sessionId);
      const previous = map.get(user.socketId) || {};
      const presence = {
        socketId: user.socketId,
        userId: user.userId,
        name: user.name,
        role: user.role,
        file: payload.file ?? previous.file ?? null,
        cursor: payload.cursor ?? previous.cursor ?? null,
        selection: payload.selection ?? previous.selection ?? null,
        updatedAt: Date.now()
      };
      map.set(user.socketId, presence);
      return presence;
    };

    const removePresence = (sessionId, socketId) => {
      const map = presenceBySession.get(sessionId);
      if (!map) return;
      map.delete(socketId);
      if (map.size === 0) {
        presenceBySession.delete(sessionId);
      }
    };

    // ========================================================================
    // PLAYGROUND MODE: Join
    // ========================================================================

    /**
     * Handle playground session creation.
     * No DB, no password, no roles. Single user only.
     * 
     * @emits 'playground-ready' - Session data to the joining user
     */
    socket.on('join-playground', async (data = {}) => {
      try {
        // ── Session cap check ──
        if (!isCapacityAvailable()) {
          logger.safety('server_capacity_reached', {
            socketId: socket.id,
            activeSessionCount: getActiveSessionCount(),
            max: limits.MAX_ACTIVE_SESSIONS,
            type: 'playground'
          });
          return socket.emit('error', {
            message: 'Server is at capacity. Please try again later.',
            code: 'SERVER_CAPACITY_REACHED'
          });
        }

        const language = data.language || DEFAULT_LANGUAGE;
        const sessionId = generatePlaygroundId();

        logger.room('playground_creating', { sessionId, socketId: socket.id });

        // Create in-memory session
        const pgSession = {
          sessionId,
          sessionType: 'playground',
          socketId: socket.id,
          code: '',
          language,
          active: true,
          createdAt: Date.now()
        };

        playgroundSessions.set(sessionId, pgSession);
        incrementSessionCount();

        // Join socket room
        socket.join(sessionId);
        joinedPlaygrounds.add(sessionId);

        // Initialize container
        await ensureTerminal(sessionId);
        await executionManager.registerClient(sessionId, terminalHooks(sessionId));

        // Listen for execution timeout events from this session
        const execSession = executionManager.sessions.get(sessionId);
        if (execSession) {
          execSession.emitter.on('execution_timeout', () => {
            io.to(sessionId).emit('terminal-error', {
              sessionId,
              reason: 'execution_time_exceeded',
              message: 'Code execution timed out'
            });
          });
          execSession.emitter.on('oom', () => {
            io.to(sessionId).emit('terminal-error', {
              sessionId,
              reason: 'memory_limit_exceeded',
              message: 'Container killed: memory limit exceeded'
            });
          });
        }

        logger.room('playground_ready', { sessionId, socketId: socket.id });

        // Notify client
        socket.emit('playground-ready', {
          sessionId,
          language
        });

      } catch (error) {
        logger.error('join-playground handler failed', error);
        socket.emit('error', {
          message: 'Failed to create playground session',
          code: 'PLAYGROUND_ERROR'
        });
      }
    });

    // ========================================================================
    // COLLABORATIVE MODE: Join Session
    // ========================================================================

    socket.on('join-session', async (data) => {
      try {
        const { sessionId, password, user, userId } = data;

        // ── Session cap check ──
        if (!isCapacityAvailable()) {
          logger.safety('server_capacity_reached', {
            socketId: socket.id,
            activeSessionCount: getActiveSessionCount(),
            max: limits.MAX_ACTIVE_SESSIONS,
            type: 'collaborative'
          });
          return socket.emit('error', {
            message: 'Server is at capacity. Please try again later.',
            code: 'SERVER_CAPACITY_REACHED'
          });
        }

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

        // Max 5 members per room
        if (session && session.users.length >= 5) {
          logger.warn('join_failed: room_full', { sessionId, userName: user, currentUsers: session.users.length });
          return socket.emit('error', {
            message: 'This room is full (max 5 members)',
            code: 'ROOM_FULL'
          });
        }

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
          role: updatedSession.users.find(u => u.socketId === socket.id)?.role || 'viewer',
          language: updatedSession.language || 'javascript',
          ownerId: updatedSession.owner,
          terminalController: updatedSession.terminalController || null,
          title: updatedSession.title || ''
        });

        const presence = updatePresence(sessionId, userEntry);
        socket.emit('presence-state', {
          sessionId,
          presence: Array.from(getPresenceMap(sessionId).values())
        });
        socket.broadcast.to(sessionId).emit('presence-update', {
          sessionId,
          presence
        });

        await executionManager.registerClient(sessionId, terminalHooks(sessionId));
        joinedSessions.add(sessionId);
        incrementSessionCount();

        // Listen for execution timeout / OOM events from this session
        const execSession = executionManager.sessions.get(sessionId);
        if (execSession) {
          execSession.emitter.on('execution_timeout', () => {
            io.to(sessionId).emit('terminal-error', {
              sessionId,
              reason: 'execution_time_exceeded',
              message: 'Code execution timed out'
            });
          });
          execSession.emitter.on('oom', () => {
            io.to(sessionId).emit('terminal-error', {
              sessionId,
              reason: 'memory_limit_exceeded',
              message: 'Container killed: memory limit exceeded'
            });
          });
        }

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

    // ========================================================================
    // Role Management (Collaborative Only)
    // ========================================================================

    socket.on('change-role', async (data) => {
      try {
        const { sessionId, targetUser, newRole } = data;
        if (isPlayground(sessionId)) return;

        logger.debug('role_change_requested', { sessionId, targetUser, newRole });

        const session = await getSession(sessionId);
        if (!session) {
          return socket.emit('error', {
            message: 'Session not found',
            code: 'SESSION_NOT_FOUND'
          });
        }

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

        await Session.findOneAndUpdate(
          { sessionId, "users.name": targetUser },
          { $set: { "users.$.role": newRole } }
        );

        const updatedSession = await getSession(sessionId);

        logger.room('role_changed', { sessionId, targetUser, newRole });

        const controllerSocketId = updatedSession.terminalController?.socketId;
        const controllerUser = updatedSession.users.find(u => u.socketId === controllerSocketId);
        if (controllerSocketId && controllerUser?.name === targetUser && newRole === 'viewer') {
          await setTerminalController(sessionId, null, 'controller_role_demoted', requester);
        }

        const targetSessionUser = updatedSession.users.find(u => u.name === targetUser);
        if (targetSessionUser) {
          const presence = updatePresence(sessionId, { ...targetSessionUser, role: newRole });
          io.to(sessionId).emit('presence-update', {
            sessionId,
            presence
          });
        }

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

    // ========================================================================
    // Terminal Control Transfer (Collaborative Only)
    // ========================================================================

    socket.on('terminal-transfer-control', async (data) => {
      try {
        const { sessionId, targetUser } = data || {};
        if (!sessionId || !targetUser || isPlayground(sessionId)) return;

        logger.debug('terminal_transfer_requested', { sessionId, targetUser });

        const session = await getSession(sessionId);
        if (!session) {
          return socket.emit('error', {
            message: 'Session not found',
            code: 'SESSION_NOT_FOUND'
          });
        }

        const requester = session.users.find(u => u.socketId === socket.id);
        if (requester?.role !== 'owner') {
          logger.warn('terminal_transfer_unauthorized', { sessionId, socketId: socket.id });
          return socket.emit('error', {
            message: 'Only the session owner can transfer terminal control',
            code: 'UNAUTHORIZED'
          });
        }

        const target = session.users.find(u => u.name === targetUser || u.userId === targetUser);
        if (!target) {
          return socket.emit('error', {
            message: 'Target user not found in session',
            code: 'USER_NOT_FOUND'
          });
        }

        if (!canControlTerminal(target)) {
          return socket.emit('error', {
            message: 'Target user cannot control the terminal',
            code: 'TERMINAL_CONTROL_FORBIDDEN'
          });
        }

        if (session.terminalController?.socketId === target.socketId) {
          return;
        }

        await setTerminalController(sessionId, target, 'owner_transfer', requester);
      } catch (error) {
        logger.error('terminal-transfer-control handler failed', error, {
          sessionId: data?.sessionId
        });
        socket.emit('error', {
          message: 'Failed to transfer terminal control',
          code: 'TERMINAL_TRANSFER_ERROR'
        });
      }
    });

    socket.on('terminal-request-control', async (data) => {
      try {
        const { sessionId } = data || {};
        if (!sessionId || isPlayground(sessionId)) return;

        const { session, isMember } = await getSessionWithMembership(sessionId, socket.id);
        if (!session || !isMember) {
          return socket.emit('error', {
            message: 'You are not part of this session',
            code: 'NOT_IN_SESSION'
          });
        }

        const user = session.users.find(u => u.socketId === socket.id);
        if (!user || !canControlTerminal(user)) {
          logger.warn('terminal_request_rejected_role', { sessionId, socketId: socket.id, role: user?.role });
          return socket.emit('error', {
            message: 'Your role cannot control the terminal',
            code: 'TERMINAL_CONTROL_FORBIDDEN'
          });
        }

        if (session.terminalController?.socketId) {
          return socket.emit('error', {
            message: 'Another user is controlling the terminal',
            code: 'TERMINAL_CONTROL_BUSY'
          });
        }

        await setTerminalController(sessionId, user, 'request_granted', user);
      } catch (error) {
        logger.error('terminal-request-control handler failed', error, {
          sessionId: data?.sessionId
        });
        socket.emit('error', {
          message: 'Failed to request terminal control',
          code: 'TERMINAL_REQUEST_ERROR'
        });
      }
    });

    // ========================================================================
    // Transfer Ownership (Collaborative Only)
    // ========================================================================

    socket.on('transfer-ownership', async (data = {}) => {
      try {
        const { sessionId, targetUserName } = data;
        if (!sessionId || !targetUserName || isPlayground(sessionId)) return;

        const session = await getSession(sessionId);
        if (!session) {
          return socket.emit('error', { message: 'Session not found', code: 'SESSION_NOT_FOUND' });
        }

        const requester = session.users.find(u => u.socketId === socket.id);
        if (!requester || requester.userId !== session.owner) {
          return socket.emit('error', { message: 'Only the session owner can transfer ownership', code: 'UNAUTHORIZED' });
        }

        const target = session.users.find(u => u.name === targetUserName);
        if (!target) {
          return socket.emit('error', { message: 'Target user not found in session', code: 'USER_NOT_FOUND' });
        }

        // Update owner field and roles in DB
        await Session.findOneAndUpdate(
          { sessionId, 'users.userId': target.userId },
          { $set: { owner: target.userId, 'users.$.role': 'owner' } }
        );
        await Session.findOneAndUpdate(
          { sessionId, 'users.userId': requester.userId },
          { $set: { 'users.$.role': 'editor' } }
        );

        const updatedSession = await getSession(sessionId);

        logger.room('ownership_transferred', { sessionId, from: requester.name, to: target.name });

        io.to(sessionId).emit('ownership-transferred', { newOwnerId: target.userId });
        io.to(sessionId).emit('role-updated', {
          user: target.name,
          newRole: 'owner',
          userList: updatedSession.users.map(u => ({ name: u.name, role: u.role }))
        });

      } catch (error) {
        logger.error('transfer-ownership handler failed', error, { sessionId: data?.sessionId });
        socket.emit('error', { message: 'Failed to transfer ownership', code: 'TRANSFER_ERROR' });
      }
    });

    // ========================================================================
    // End Session (Collaborative Only)
    // ========================================================================

    socket.on('end-session', async (data) => {
      try {
        const { sessionId, userId } = data;
        if (isPlayground(sessionId)) return;

        logger.room('session_end_requested', { sessionId, userId });

        const session = await getSession(sessionId);

        if (session?.owner !== userId) {
          logger.warn('end_session_unauthorized', { sessionId, userId });
          return socket.emit('error', {
            message: 'Only the session owner can end the session',
            code: 'UNAUTHORIZED'
          });
        }

        await Session.deleteOne({ sessionId });
        await executionManager.shutdown(sessionId, 'owner_ended', true);
        presenceBySession.delete(sessionId);
        decrementSessionCount();

        logger.room('session_destroyed', {
          sessionId,
          reason: 'owner_ended',
          userCount: session.users.length
        });

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

    // ========================================================================
    // Leave Session (Collaborative Only)
    // ========================================================================

    socket.on('leave-session', async (sessionId) => {
      try {
        // Playground: just clean up
        if (isPlayground(sessionId)) {
          await cleanupPlayground(sessionId);
          socket.leave(sessionId);
          joinedPlaygrounds.delete(sessionId);
          return;
        }

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

        if (session.terminalController?.socketId === socket.id) {
          await setTerminalController(sessionId, null, 'controller_left', user);
        }

        removePresence(sessionId, socket.id);
        io.to(sessionId).emit('presence-removed', {
          sessionId,
          socketId: socket.id,
          userId: user.userId,
          name: user.name
        });

        await removeUserFromSession(sessionId, socket.id);
        socket.leave(sessionId);

        await executionManager.deregisterClient(sessionId);
        joinedSessions.delete(sessionId);

        logger.room('user_left', {
          sessionId,
          userName: user.name,
          role: user.role
        });

        io.to(sessionId).emit('user-left', {
          user: user.name,
          message: `${user.name} has left the session`
        });

        const updatedSession = await getSession(sessionId);
        if (updatedSession && updatedSession.users.length === 0) {
          logger.room('session_destroying_empty', { sessionId });
          await Session.deleteOne({ sessionId });
          await executionManager.shutdown(sessionId, 'room_empty');
          logger.room('session_destroyed', { sessionId, reason: 'empty' });
          presenceBySession.delete(sessionId);
          decrementSessionCount();
        }

      } catch (error) {
        logger.error('leave-session handler failed', error, { sessionId });
      }
    });

    // ========================================================================
    // Language Change (Block in Collaborative — language is immutable)
    // ========================================================================

    socket.on('language-change', async (data = {}) => {
      const { sessionId } = data;
      if (!sessionId) return;
      // Playground: allow language changes (handled client-side)
      if (isPlayground(sessionId)) return;
      // Collaborative: language is set at room creation and cannot be changed
      logger.warn('language_change_blocked', { sessionId, socketId: socket.id });
      socket.emit('error', {
        message: 'Language cannot be changed after room creation',
        code: 'PERMISSION_DENIED'
      });
    });

    // ========================================================================
    // Code Synchronization
    // ========================================================================

    socket.on('code-change', async (data) => {
      try {
        const { sessionId, code } = data || {};
        if (!sessionId) return;

        // Playground: store in memory only, no broadcast (single user)
        if (isPlayground(sessionId)) {
          const pg = playgroundSessions.get(sessionId);
          if (pg && pg.socketId === socket.id) {
            pg.code = code;
          }
          return;
        }

        // Collaborative: DB persist + broadcast
        const { session, isMember } = await getSessionWithMembership(sessionId, socket.id);
        if (!session || !isMember) {
          return socket.emit('error', {
            message: 'You are not part of this session',
            code: 'NOT_IN_SESSION'
          });
        }

        const user = session.users.find(u => u.socketId === socket.id);
        if (!user || user.role === 'viewer') {
          logger.warn('code_change_rejected_role', { sessionId, socketId: socket.id, role: user?.role });
          return socket.emit('error', {
            message: 'Viewers cannot edit code',
            code: 'PERMISSION_DENIED'
          });
        }

        await Session.findOneAndUpdate(
          { sessionId },
          { $set: { code } }
        );
        socket.broadcast.to(sessionId).emit('code-update', code);

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

    // ========================================================================
    // Chat (Collaborative Only)
    // ========================================================================

    socket.on('send-chat-message', async (data) => {
      try {
        if (isPlayground(data?.sessionId)) return;

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
          senderId: user.userId,
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

    // ========================================================================
    // Presence (Collaborative Only)
    // ========================================================================

    socket.on('presence-update', async (data = {}) => {
      try {
        const { sessionId, cursor, selection, file } = data;
        if (!sessionId || isPlayground(sessionId)) return;

        const { session, isMember } = await getSessionWithMembership(sessionId, socket.id);
        if (!session || !isMember) return;

        const user = session.users.find(u => u.socketId === socket.id);
        if (!user) return;

        const presence = updatePresence(sessionId, user, { cursor, selection, file });
        io.to(sessionId).emit('presence-update', {
          sessionId,
          presence
        });
      } catch (error) {
        logger.warn('presence-update handler failed', {
          sessionId: data?.sessionId,
          error: error.message
        });
      }
    });

    // ========================================================================
    // Execution Requests (Collaborative Only)
    // ========================================================================

    socket.on('execution-request', async (data = {}) => {
      try {
        const { sessionId } = data;
        if (!sessionId || isPlayground(sessionId)) return;

        const session = await getSession(sessionId);
        if (!session) return;

        const requester = session.users.find(u => u.socketId === socket.id);
        if (!requester || requester.role === 'viewer') {
          return socket.emit('error', {
            message: 'Viewers cannot request execution',
            code: 'PERMISSION_DENIED'
          });
        }

        const ownerUser = session.users.find(u => u.userId === session.owner);
        if (!ownerUser) return;

        logger.debug('execution_request', { sessionId, requester: requester.name, owner: ownerUser.name });

        io.to(ownerUser.socketId).emit('execution-request', {
          sessionId,
          requesterName: requester.name,
          requesterSocketId: socket.id
        });
      } catch (error) {
        logger.error('execution-request handler failed', error, { sessionId: data?.sessionId });
      }
    });

    socket.on('execution-decline', async (data = {}) => {
      try {
        const { sessionId, requesterSocketId } = data;
        if (!sessionId || isPlayground(sessionId)) return;

        const session = await getSession(sessionId);
        if (!session) return;

        const user = session.users.find(u => u.socketId === socket.id);
        if (!user || user.userId !== session.owner) return;

        logger.debug('execution_declined', { sessionId, requesterSocketId });

        io.to(requesterSocketId).emit('execution-rejected', {
          message: 'Execution request declined by owner'
        });
      } catch (error) {
        logger.error('execution-decline handler failed', error, { sessionId: data?.sessionId });
      }
    });

    // ========================================================================
    // Interactive Terminal (Both Modes)
    // ========================================================================

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

        // --- Playground: no role checks, single user always has control ---
        if (isPlayground(sessionId)) {
          const pg = playgroundSessions.get(sessionId);
          if (!pg || pg.socketId !== socket.id) {
            return socket.emit('error', {
              message: 'Invalid playground session',
              code: 'NOT_IN_SESSION'
            });
          }
          await ensureTerminal(sessionId);
          await executionManager.write(sessionId, input);
          return;
        }

        // --- Collaborative: full role + controller checks ---
        const { session, isMember } = await getSessionWithMembership(sessionId, socket.id);
        if (!session || !isMember) {
          logger.warn('terminal_input_rejected', { sessionId, socketId: socket.id, hasSession: !!session, isMember });
          return socket.emit('error', {
            message: 'You are not part of this session',
            code: 'NOT_IN_SESSION'
          });
        }

        const user = session.users.find(u => u.socketId === socket.id);
        if (!user) {
          return socket.emit('error', {
            message: 'You are not part of this session',
            code: 'NOT_IN_SESSION'
          });
        }

        if (!canControlTerminal(user)) {
          logger.warn('terminal_input_rejected_role', {
            sessionId,
            socketId: socket.id,
            role: user.role
          });
          return socket.emit('error', {
            message: 'Your role cannot control the terminal',
            code: 'TERMINAL_CONTROL_FORBIDDEN'
          });
        }

        const controllerSocketId = session.terminalController?.socketId;
        if (controllerSocketId && controllerSocketId !== socket.id) {
          logger.warn('terminal_input_rejected_controller', {
            sessionId,
            socketId: socket.id,
            controllerSocketId
          });
          return socket.emit('error', {
            message: 'Another user is controlling the terminal',
            code: 'TERMINAL_CONTROL_REQUIRED'
          });
        }

        if (!controllerSocketId) {
          await setTerminalController(sessionId, user, 'input_acquired', user);
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

        // Playground: just resize, no membership check needed
        if (isPlayground(sessionId)) {
          await executionManager.resize(sessionId, cols, rows);
          return;
        }

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

        // Playground: anyone can shut down their own session
        if (isPlayground(sessionId)) {
          await executionManager.shutdown(sessionId, 'manual_shutdown', !!force);
          io.to(sessionId).emit('terminal-closed', { sessionId, reason: 'manual_shutdown' });
          return;
        }

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

    // ========================================================================
    // Run Code (Both Modes)
    // ========================================================================

    socket.on('run-code', async (data = {}) => {
      const { sessionId, code = '', language } = data;

      logger.debug('code_execution_requested', { sessionId, language });

      try {
        // --- Playground: skip DB, no role checks ---
        if (isPlayground(sessionId)) {
          const pg = playgroundSessions.get(sessionId);
          if (!pg || pg.socketId !== socket.id) {
            return socket.emit('error', {
              message: 'Invalid playground session',
              code: 'SESSION_INVALID'
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

          await ensureTerminal(sessionId);

          // Start execution timer — will SIGINT then SIGKILL on timeout
          const execTimer = executionManager.startExecutionTimer(sessionId);

          const sentinel = `__EXEC_DONE_${Date.now()}__`;
          const delimiter = `EOF_${Date.now()}`;
          const commands = [
            `cat > ${langConfig.file} << '${delimiter}'`,
            code,
            delimiter,
            `${langConfig.run}; echo "${sentinel}"`
          ].join('\n');

          // Listen for sentinel to know execution finished
          const session = executionManager.sessions.get(sessionId);
          if (session) {
            const onData = (chunk) => {
              const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
              if (text.includes(sentinel)) {
                session.emitter.off('data', onData);
                execTimer.cancel();
                io.to(sessionId).emit('execution-complete', { sessionId });
                logger.debug('playground_code_execution_complete', { sessionId });
              }
            };
            session.emitter.on('data', onData);
            // Safety fallback: cancel listener if execution timer fires
            session.emitter.once('execution_timeout', () => {
              session.emitter.off('data', onData);
              io.to(sessionId).emit('execution-complete', { sessionId });
            });
          }

          await executionManager.write(sessionId, commands + '\n');
          io.to(sessionId).emit('execution-started', { sessionId, language: langKey });

          logger.debug('playground_code_execution_started', { sessionId, language: langKey });
          return;
        }

        // --- Collaborative: full checks ---
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

        const user = session.users.find(u => u.socketId === socket.id);
        if (!user || user.userId !== session.owner) {
          logger.warn('run_code_rejected_not_owner', { sessionId, socketId: socket.id, role: user?.role });
          return socket.emit('error', {
            message: 'Only the session owner can run code directly',
            code: 'PERMISSION_DENIED'
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

        await ensureTerminal(sessionId);

        // Start execution timer — will SIGINT then SIGKILL on timeout
        const execTimer = executionManager.startExecutionTimer(sessionId);

        const sentinel = `__EXEC_DONE_${Date.now()}__`;
        const delimiter = `EOF_${Date.now()}`;
        const commands = [
          `cat > ${langConfig.file} << '${delimiter}'`,
          code,
          delimiter,
          `${langConfig.run}; echo "${sentinel}"`
        ].join('\n');

        // Listen for sentinel to know execution finished
        const execSession = executionManager.sessions.get(sessionId);
        if (execSession) {
          const onData = (chunk) => {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            if (text.includes(sentinel)) {
              execSession.emitter.off('data', onData);
              execTimer.cancel();
              io.to(sessionId).emit('execution-complete', { sessionId });
              logger.debug('code_execution_complete', { sessionId });
            }
          };
          execSession.emitter.on('data', onData);
          // Safety fallback: cancel listener if execution timer fires
          execSession.emitter.once('execution_timeout', () => {
            execSession.emitter.off('data', onData);
            io.to(sessionId).emit('execution-complete', { sessionId });
          });
        }

        await executionManager.write(sessionId, commands + '\n');
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

    // ========================================================================
    // Playground Cleanup Helper
    // ========================================================================

    async function cleanupPlayground(sessionId) {
      if (!playgroundSessions.has(sessionId)) return;

      logger.room('playground_destroying', { sessionId });
      playgroundSessions.delete(sessionId);
      decrementSessionCount();

      try {
        await executionManager.deregisterClient(sessionId);
        await executionManager.shutdown(sessionId, 'playground_disconnect', true);
      } catch (err) {
        logger.error('playground_cleanup_failed', err, { sessionId });
      }

      logger.room('playground_destroyed', { sessionId });
    }

    // ========================================================================
    // Disconnect Cleanup (Both Modes)
    // ========================================================================

    socket.on('disconnect', async () => {
      try {
        logger.socket('client_disconnected', { socketId: socket.id });

        // --- Clean up playground sessions ---
        for (const pgSessionId of joinedPlaygrounds) {
          await cleanupPlayground(pgSessionId);
        }
        joinedPlaygrounds.clear();

        // --- Clean up collaborative sessions ---
        const sessions = await Session.find({
          'users.socketId': socket.id
        });

        for (const session of sessions) {
          const user = session.users.find(u => u.socketId === socket.id);

          if (user) {
            if (session.terminalController?.socketId === socket.id) {
              await setTerminalController(session.sessionId, null, 'controller_disconnected', user);
            }

            removePresence(session.sessionId, socket.id);
            io.to(session.sessionId).emit('presence-removed', {
              sessionId: session.sessionId,
              socketId: socket.id,
              userId: user.userId,
              name: user.name
            });

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

            io.to(session.sessionId).emit('user-left', {
              user: user.name,
              message: `${user.name} has disconnected`
            });

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
              presenceBySession.delete(session.sessionId);
              decrementSessionCount();
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