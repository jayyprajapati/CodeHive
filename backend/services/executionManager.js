const Docker = require('dockerode');
const { PassThrough } = require('stream');
const EventEmitter = require('events');
const logger = require('../utils/logger');

// Resource and lifecycle configuration
const EXECUTION_IMAGE = process.env.EXECUTION_IMAGE || 'node:20-alpine';
const CPU_NANOS = Number(process.env.EXECUTION_NANO_CPUS || 500_000_000); // 0.5 CPU
const MEMORY_LIMIT_BYTES = Number(process.env.EXECUTION_MEMORY_BYTES || 512 * 1024 * 1024); // 512 MB
const PIDS_LIMIT = Number(process.env.EXECUTION_PIDS_LIMIT || 64);
const IDLE_TIMEOUT_MS = Number(process.env.EXECUTION_IDLE_TIMEOUT_MS || 5 * 60 * 1000); // 5 minutes
const MAX_LIFETIME_MS = Number(process.env.EXECUTION_MAX_LIFETIME_MS || 60 * 60 * 1000); // 1 hour
const FORCE_KILL_TIMEOUT_MS = Number(process.env.EXECUTION_FORCE_KILL_TIMEOUT_MS || 5000);
const MAX_STDIN_BYTES = Number(process.env.EXECUTION_MAX_STDIN_BYTES || 64 * 1024);

/**
 * ExecutionManager
 *
 * Manages per-room Docker containers that host a persistent PTY-backed shell.
 * Provides streaming stdin/stdout, lifecycle tracking, and safety limits.
 */
class ExecutionManager {
  constructor() {
    this.docker = new Docker();
    this.sessions = new Map(); // sessionId -> session data
    this.imageReady = false;
  }

  // ---------------------------------------------------------------------------
  // Container bootstrap
  // ---------------------------------------------------------------------------

  async ensureImage() {
    if (this.imageReady) return;

    try {
      await this.docker.getImage(EXECUTION_IMAGE).inspect();
      this.imageReady = true;
      return;
    } catch (err) {
      logger.warn('execution_image_missing_pulling', { image: EXECUTION_IMAGE });
    }

    await new Promise((resolve, reject) => {
      this.docker.pull(EXECUTION_IMAGE, (pullErr, stream) => {
        if (pullErr) return reject(pullErr);
        this.docker.modem.followProgress(stream, (progressErr) => {
          if (progressErr) return reject(progressErr);
          this.imageReady = true;
          resolve();
        });
      });
    });
  }

  async ensureSession(sessionId, hooks = {}) {
    let session = this.sessions.get(sessionId);
    if (session) {
      session.outputHook = session.outputHook || hooks.onOutput;
      session.exitHook = session.exitHook || hooks.onExit;
      return session;
    }

    await this.ensureImage();

    const container = await this.docker.createContainer({
      Image: EXECUTION_IMAGE,
      Cmd: ['/bin/sh'],
      User: 'node',
      WorkingDir: '/home/node/workspace',
      Tty: true,
      OpenStdin: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Env: ['FORCE_COLOR=0'],
      HostConfig: {
        AutoRemove: true,
        NetworkMode: 'none',
        ReadonlyRootfs: true,
        PidsLimit: PIDS_LIMIT,
        Memory: MEMORY_LIMIT_BYTES,
        NanoCpus: CPU_NANOS,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        Tmpfs: {
          '/home/node/workspace': 'rw,size=134217728', // 128 MB
          '/tmp': 'rw,size=67108864' // 64 MB
        }
      }
    });

    await container.start();

    const attachStream = await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true
    });

    const stdinStream = new PassThrough();
    stdinStream.pipe(attachStream);

    const emitter = new EventEmitter();
    const outputHook = hooks.onOutput;
    const exitHook = hooks.onExit;

    attachStream.on('data', (chunk) => {
      const data = chunk.toString('utf8');
      emitter.emit('data', data);
      if (outputHook) outputHook(data);
    });

    attachStream.on('error', (err) => {
      emitter.emit('error', err);
    });

    container.wait()
      .then(() => {
        emitter.emit('close');
        this.sessions.delete(sessionId);
        if (exitHook) exitHook('container_exited');
      })
      .catch((err) => {
        emitter.emit('error', err);
        this.sessions.delete(sessionId);
        if (exitHook) exitHook('container_exit_error');
      });

    const lifetimeTimer = setTimeout(() => {
      this.shutdown(sessionId, 'lifetime_exceeded', true);
    }, MAX_LIFETIME_MS);

    session = {
      container,
      stdin: stdinStream,
      emitter,
      outputHook,
      exitHook,
      clients: 0,
      idleTimer: null,
      lifetimeTimer,
      destroyed: false
    };

    // Prepare workspace directory for the non-root user
    stdinStream.write('mkdir -p /home/node/workspace\n');

    this.sessions.set(sessionId, session);
    logger.session('execution_session_created', { sessionId });
    return session;
  }

  // ---------------------------------------------------------------------------
  // Client accounting
  // ---------------------------------------------------------------------------

  async registerClient(sessionId, hooks = {}) {
    const session = await this.ensureSession(sessionId, hooks);
    session.clients += 1;
    this.resetIdleTimer(sessionId);
    return session;
  }

  async deregisterClient(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.clients = Math.max(0, session.clients - 1);
    this.resetIdleTimer(sessionId);
  }

  resetIdleTimer(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.idleTimer) clearTimeout(session.idleTimer);

    session.idleTimer = setTimeout(() => {
      if (session.clients === 0) {
        this.shutdown(sessionId, 'idle_timeout');
      }
    }, IDLE_TIMEOUT_MS);
  }

  // ---------------------------------------------------------------------------
  // IO operations
  // ---------------------------------------------------------------------------

  async write(sessionId, data) {
    if (!data) return;

    const session = await this.ensureSession(sessionId);
    const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;

    if (payload.length > MAX_STDIN_BYTES) {
      throw new Error('Input too large');
    }

    session.stdin.write(payload);
    this.resetIdleTimer(sessionId);
  }

  async resize(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      await session.container.resize({ w: cols, h: rows });
    } catch (err) {
      logger.warn('terminal_resize_failed', { sessionId, error: err.message });
    }
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  async shutdown(sessionId, reason = 'manual_shutdown', force = false) {
    const session = this.sessions.get(sessionId);
    if (!session || session.destroyed) return;

    session.destroyed = true;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    if (session.lifetimeTimer) clearTimeout(session.lifetimeTimer);

    try {
      if (force) {
        await session.container.kill({ signal: 'SIGKILL' });
      } else {
        await session.container.stop({ t: Math.ceil(FORCE_KILL_TIMEOUT_MS / 1000) });
      }
    } catch (err) {
      logger.warn('execution_shutdown_fallback_kill', { sessionId, error: err.message });
      try {
        await session.container.kill({ signal: 'SIGKILL' });
      } catch (killErr) {
        logger.error('execution_shutdown_failed', killErr, { sessionId });
      }
    } finally {
      this.sessions.delete(sessionId);
      if (session.exitHook) session.exitHook(reason);
      logger.session('execution_session_ended', { sessionId, reason });
    }
  }
}

module.exports = {
  ExecutionManager,
  executionManager: new ExecutionManager()
};
