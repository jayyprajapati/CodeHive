/**
 * ExecutionManager — Docker Container Lifecycle Manager
 *
 * Manages per-session Docker containers with a persistent PTY-backed shell.
 * Enforces resource limits, idle timeouts, per-run execution timeouts,
 * OOM detection, and global container caps.
 *
 * @module services/executionManager
 */

const Docker = require('dockerode');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const limits = require('../config/resourceLimits');

// ============================================================================
// ExecutionManager
// ============================================================================

class ExecutionManager {
  constructor() {
    this.docker = new Docker();
    this.sessions = new Map();   // sessionId → session data
    this.imageReady = false;
    this.containerCount = 0;     // Global container counter
  }

  // --------------------------------------------------------------------------
  // Container bootstrap
  // --------------------------------------------------------------------------

  async ensureImage() {
    if (this.imageReady) return;

    try {
      await this.docker.getImage(limits.EXECUTION_IMAGE).inspect();
      this.imageReady = true;
      logger.debug('execution_image_ready', { image: limits.EXECUTION_IMAGE });
      return;
    } catch (err) {
      logger.warn('execution_image_missing_pulling', { image: limits.EXECUTION_IMAGE });
    }

    await new Promise((resolve, reject) => {
      this.docker.pull(limits.EXECUTION_IMAGE, (pullErr, pullStream) => {
        if (pullErr) return reject(pullErr);
        this.docker.modem.followProgress(pullStream, (progressErr) => {
          if (progressErr) return reject(progressErr);
          this.imageReady = true;
          logger.debug('execution_image_pulled', { image: limits.EXECUTION_IMAGE });
          resolve();
        });
      });
    });
  }

  // --------------------------------------------------------------------------
  // Session creation with resource enforcement
  // --------------------------------------------------------------------------

  async ensureSession(sessionId, hooks = {}) {
    let session = this.sessions.get(sessionId);
    if (session) {
      logger.debug('execution_session_reused', { sessionId });
      return session;
    }

    // ── Global container cap ──
    if (this.containerCount >= limits.MAX_CONTAINERS) {
      logger.safety('container_limit_reached', {
        sessionId,
        containerCount: this.containerCount,
        max: limits.MAX_CONTAINERS
      });
      throw new Error('CONTAINER_LIMIT_REACHED');
    }

    await this.ensureImage();

    logger.debug('execution_container_creating', {
      sessionId,
      image: limits.EXECUTION_IMAGE
    });

    const container = await this.docker.createContainer({
      Image: limits.EXECUTION_IMAGE,
      Cmd: ['/bin/sh'],
      User: 'codeuser',
      WorkingDir: '/home/codeuser/workspace',
      Tty: true,
      OpenStdin: true,
      StdinOnce: false,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Env: ['TERM=dumb', 'PS1=$ '],
      Labels: { codehive: 'true', session: sessionId },
      HostConfig: {
        AutoRemove: true,
        NetworkMode: 'none',
        PidsLimit: limits.PIDS_LIMIT,
        Memory: limits.MAX_MEMORY_BYTES,
        MemorySwap: limits.MAX_MEMORY_BYTES,   // disables swap
        NanoCpus: limits.CPU_NANOS,
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        Tmpfs: {
          '/home/codeuser/workspace': 'rw,exec,size=134217728,uid=1000,gid=1000',
          '/tmp': 'rw,size=67108864,uid=1000,gid=1000'
        }
      }
    });

    logger.debug('execution_container_starting', {
      sessionId,
      containerId: container.id
    });

    // Attach BEFORE starting for proper stream capture
    const attachStream = await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true
    });

    await container.start();
    this.containerCount++;

    logger.safety('session_created', {
      sessionId,
      containerId: container.id,
      containerCount: this.containerCount
    });

    const emitter = new EventEmitter();
    const outputHooks = hooks.onOutput ? [hooks.onOutput] : [];
    const exitHooks = hooks.onExit ? [hooks.onExit] : [];

    // Filter Docker attach noise
    const ATTACH_JSON_RE = /\{"stream":true[^}]*\}/g;

    attachStream.on('data', (chunk) => {
      let data = chunk.toString('utf8');

      if (data.includes('"stream":true')) {
        data = data.replace(ATTACH_JSON_RE, '');
        if (!data.replace(/[\r\n\s$\u001b\[J]/g, '').trim()) {
          return;
        }
      }

      logger.debug('execution_output', {
        sessionId,
        length: data.length,
        sample: data.slice(0, 100)
      });
      emitter.emit('data', data);
      for (const hook of outputHooks) {
        try { hook(data); } catch (err) {
          logger.error('output_hook_error', err, { sessionId });
        }
      }
    });

    attachStream.on('end', () => {
      logger.debug('execution_stream_end', { sessionId });
      emitter.emit('close');
      this._cleanupSession(sessionId, 'stream_end');
    });

    attachStream.on('error', (err) => {
      logger.error('execution_stream_error', err, { sessionId });
      emitter.emit('error', err);
    });

    // ── OOM detection via container wait ──
    container.wait()
      .then((result) => {
        const exitCode = result?.StatusCode;
        const oomKilled = exitCode === 137;

        if (oomKilled) {
          logger.safety('memory_limit_hit', {
            sessionId,
            exitCode,
            memoryLimitMB: limits.MAX_MEMORY_BYTES / (1024 * 1024)
          });
          // Notify via exit hooks with specific OOM reason
          for (const hook of exitHooks) {
            try { hook('memory_limit_exceeded'); } catch (e) {
              logger.error('exit_hook_error', e, { sessionId });
            }
          }
          emitter.emit('oom', { sessionId, exitCode });
        }

        logger.debug('execution_container_exited', { sessionId, result, oomKilled });
        emitter.emit('close');
        this._cleanupSession(sessionId, oomKilled ? 'oom_killed' : 'container_exited');
      })
      .catch((err) => {
        logger.error('execution_container_wait_error', err, { sessionId });
        emitter.emit('error', err);
        this._cleanupSession(sessionId, 'container_exit_error');
      });

    // ── Max lifetime timer ──
    const lifetimeTimer = setTimeout(() => {
      this.shutdown(sessionId, 'lifetime_exceeded', true);
    }, limits.MAX_LIFETIME_MS);

    session = {
      container,
      stdin: attachStream,
      emitter,
      outputHooks,
      exitHooks,
      clients: 0,
      idleTimer: null,
      lifetimeTimer,
      executionTimer: null,
      executionGraceTimer: null,
      destroyed: false
    };

    this.sessions.set(sessionId, session);
    logger.session('execution_session_created', {
      sessionId,
      containerId: container.id
    });

    return session;
  }

  // --------------------------------------------------------------------------
  // Internal cleanup
  // --------------------------------------------------------------------------

  _cleanupSession(sessionId, reason) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.destroyed = true;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    if (session.lifetimeTimer) clearTimeout(session.lifetimeTimer);
    if (session.executionTimer) clearTimeout(session.executionTimer);
    if (session.executionGraceTimer) clearTimeout(session.executionGraceTimer);

    this.sessions.delete(sessionId);
    this.containerCount = Math.max(0, this.containerCount - 1);

    logger.safety('session_destroyed', {
      sessionId,
      reason,
      containerCount: this.containerCount
    });

    // Notify all exit hooks
    for (const hook of session.exitHooks) {
      try { hook(reason); } catch (err) {
        logger.error('exit_hook_error', err, { sessionId });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Client accounting
  // --------------------------------------------------------------------------

  async registerClient(sessionId, hooks = {}) {
    const session = await this.ensureSession(sessionId, hooks);
    session.clients += 1;
    this.touchActivity(sessionId);
    logger.debug('execution_client_registered', {
      sessionId,
      clients: session.clients
    });
    return session;
  }

  async deregisterClient(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.clients = Math.max(0, session.clients - 1);
    logger.debug('execution_client_deregistered', {
      sessionId,
      clients: session.clients
    });
    this.touchActivity(sessionId);
  }

  // --------------------------------------------------------------------------
  // Idle timeout — resets on ANY socket activity
  // --------------------------------------------------------------------------

  /**
   * Reset the idle timer. Called on terminal-input, run-code,
   * code-change, chat, terminal-resize, or any meaningful activity.
   */
  touchActivity(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.destroyed) return;

    if (session.idleTimer) clearTimeout(session.idleTimer);

    session.idleTimer = setTimeout(() => {
      logger.safety('idle_timeout', {
        sessionId,
        timeoutMs: limits.IDLE_TIMEOUT_MS
      });
      this.shutdown(sessionId, 'idle_timeout', true);
    }, limits.IDLE_TIMEOUT_MS);
  }

  // --------------------------------------------------------------------------
  // Per-run execution timer (SIGINT → grace → SIGKILL)
  // --------------------------------------------------------------------------

  /**
   * Start an execution timer for a run-code invocation.
   * After MAX_EXECUTION_TIME_MS:
   *   1. Send SIGINT to the container's main process
   *   2. Wait SIGKILL_GRACE_MS
   *   3. If still alive, SIGKILL the container
   *
   * @param {string} sessionId
   * @returns {{ cancel: Function }} Handle to cancel the timer on normal completion
   */
  startExecutionTimer(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.destroyed) return { cancel: () => { } };

    // Clear any previous execution timer
    this.stopExecutionTimer(sessionId);

    logger.safety('execution_started', {
      sessionId,
      timeoutMs: limits.MAX_EXECUTION_TIME_MS
    });

    session.executionTimer = setTimeout(async () => {
      if (session.destroyed) return;

      logger.safety('execution_killed_timeout', {
        sessionId,
        timeoutMs: limits.MAX_EXECUTION_TIME_MS
      });

      // Step 1: SIGINT (graceful interrupt)
      try {
        await session.container.kill({ signal: 'SIGINT' });
      } catch (err) {
        logger.warn('execution_sigint_failed', {
          sessionId,
          error: err.message
        });
      }

      // Step 2: Grace period, then SIGKILL
      session.executionGraceTimer = setTimeout(async () => {
        if (session.destroyed) return;

        logger.warn('execution_sigkill_after_grace', { sessionId });
        try {
          await session.container.kill({ signal: 'SIGKILL' });
        } catch (err) {
          // Container may already be gone
          logger.debug('execution_sigkill_noop', {
            sessionId,
            error: err.message
          });
        }
      }, limits.SIGKILL_GRACE_MS);

      // Emit timeout event through the emitter so socket layer can relay it
      session.emitter.emit('execution_timeout', { sessionId });

    }, limits.MAX_EXECUTION_TIME_MS);

    return {
      cancel: () => this.stopExecutionTimer(sessionId)
    };
  }

  /**
   * Cancel the active execution timer (called when sentinel is detected).
   */
  stopExecutionTimer(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.executionTimer) {
      clearTimeout(session.executionTimer);
      session.executionTimer = null;
    }
    if (session.executionGraceTimer) {
      clearTimeout(session.executionGraceTimer);
      session.executionGraceTimer = null;
    }
  }

  // --------------------------------------------------------------------------
  // IO operations
  // --------------------------------------------------------------------------

  async write(sessionId, data) {
    if (!data) return;

    const session = this.sessions.get(sessionId);
    if (!session || session.destroyed) {
      logger.warn('execution_write_no_session', { sessionId });
      return;
    }

    let normalized = data;
    if (typeof normalized === 'string') {
      // Defensive: strip rare Docker attach header leaks that can corrupt stdin.
      normalized = normalized
        .replace(/^\s*\{stream:true,stdin:true,stdout:true,stderr:true,hijack:true\}/, '')
        .replace(/^\s*\{"stream":true,"stdin":true,"stdout":true,"stderr":true,"hijack":true\}/, '');
    }

    const payload = typeof normalized === 'string' ? Buffer.from(normalized, 'utf8') : normalized;

    if (payload.length > limits.MAX_STDIN_BYTES) {
      throw new Error('Input too large');
    }

    logger.debug('execution_write', {
      sessionId,
      length: payload.length,
      sample: payload.toString('utf8').slice(0, 50)
    });
    session.stdin.write(payload);
    this.touchActivity(sessionId);
  }

  async resize(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      await session.container.resize({ w: cols, h: rows });
      logger.debug('execution_resize', { sessionId, cols, rows });
    } catch (err) {
      logger.warn('terminal_resize_failed', { sessionId, error: err.message });
    }
  }

  // --------------------------------------------------------------------------
  // Getters
  // --------------------------------------------------------------------------

  /** Current number of active containers */
  getContainerCount() {
    return this.containerCount;
  }

  // --------------------------------------------------------------------------
  // Shutdown
  // --------------------------------------------------------------------------

  async shutdown(sessionId, reason = 'manual_shutdown', force = false) {
    const session = this.sessions.get(sessionId);
    if (!session || session.destroyed) return;

    session.destroyed = true;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    if (session.lifetimeTimer) clearTimeout(session.lifetimeTimer);
    this.stopExecutionTimer(sessionId);

    logger.debug('execution_shutdown_starting', { sessionId, reason, force });

    try {
      if (force) {
        await session.container.kill({ signal: 'SIGKILL' });
      } else {
        await session.container.stop({
          t: Math.ceil(limits.FORCE_KILL_TIMEOUT_MS / 1000)
        });
      }
    } catch (err) {
      logger.warn('execution_shutdown_fallback_kill', {
        sessionId,
        error: err.message
      });
      try {
        await session.container.kill({ signal: 'SIGKILL' });
      } catch (killErr) {
        logger.error('execution_shutdown_failed', killErr, { sessionId });
      }
    } finally {
      this._cleanupSession(sessionId, reason);
      logger.session('execution_session_ended', { sessionId, reason });
    }
  }
}

module.exports = {
  ExecutionManager,
  executionManager: new ExecutionManager()
};
