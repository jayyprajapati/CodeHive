const Docker = require('dockerode');
const EventEmitter = require('events');
const stream = require('stream');
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
      logger.debug('execution_image_ready', { image: EXECUTION_IMAGE });
      return;
    } catch (err) {
      logger.warn('execution_image_missing_pulling', { image: EXECUTION_IMAGE });
    }

    await new Promise((resolve, reject) => {
      this.docker.pull(EXECUTION_IMAGE, (pullErr, pullStream) => {
        if (pullErr) return reject(pullErr);
        this.docker.modem.followProgress(pullStream, (progressErr) => {
          if (progressErr) return reject(progressErr);
          this.imageReady = true;
          logger.debug('execution_image_pulled', { image: EXECUTION_IMAGE });
          resolve();
        });
      });
    });
  }

  async ensureSession(sessionId, hooks = {}) {
    let session = this.sessions.get(sessionId);
    if (session) {
      // Session already exists - don't add more hooks!
      // The existing hook already broadcasts to all room members via io.to(sessionId)
      logger.debug('execution_session_reused', { sessionId });
      return session;
    }

    await this.ensureImage();

    logger.debug('execution_container_creating', { sessionId, image: EXECUTION_IMAGE });

    const container = await this.docker.createContainer({
      Image: EXECUTION_IMAGE,
      Cmd: ['/bin/sh'],
      User: 'node',
      WorkingDir: '/home/node/workspace',
      Tty: true,
      OpenStdin: true,
      StdinOnce: false,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Env: ['TERM=dumb', 'PS1=$ '],
      HostConfig: {
        AutoRemove: true,
        NetworkMode: 'none',
        // Note: ReadonlyRootfs removed - we need writable tmpfs for code files
        PidsLimit: PIDS_LIMIT,
        Memory: MEMORY_LIMIT_BYTES,
        NanoCpus: CPU_NANOS,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        Tmpfs: {
          // uid=1000,gid=1000 ensures node user can write
          '/home/node/workspace': 'rw,exec,size=134217728,uid=1000,gid=1000',
          '/tmp': 'rw,size=67108864,uid=1000,gid=1000'
        }
      }
    });

    logger.debug('execution_container_starting', { sessionId, containerId: container.id });

    // Attach BEFORE starting for proper stream capture
    const attachStream = await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true
    });

    await container.start();

    logger.debug('execution_container_started', { sessionId, containerId: container.id });

    const emitter = new EventEmitter();
    const outputHooks = hooks.onOutput ? [hooks.onOutput] : [];
    const exitHooks = hooks.onExit ? [hooks.onExit] : [];

    // Since TTY is enabled, stdout and stderr are multiplexed into a single stream
    // No demuxing needed - just read directly from the attach stream
    attachStream.on('data', (chunk) => {
      const data = chunk.toString('utf8');
      logger.debug('execution_output', { sessionId, length: data.length, sample: data.slice(0, 100) });
      emitter.emit('data', data);
      // Broadcast to all registered output hooks
      for (const hook of outputHooks) {
        try {
          hook(data);
        } catch (err) {
          logger.error('output_hook_error', err, { sessionId });
        }
      }
    });

    attachStream.on('end', () => {
      logger.debug('execution_stream_end', { sessionId });
      emitter.emit('close');
      this.cleanupSession(sessionId, 'stream_end');
    });

    attachStream.on('error', (err) => {
      logger.error('execution_stream_error', err, { sessionId });
      emitter.emit('error', err);
    });

    container.wait()
      .then((result) => {
        logger.debug('execution_container_exited', { sessionId, result });
        emitter.emit('close');
        this.cleanupSession(sessionId, 'container_exited');
      })
      .catch((err) => {
        logger.error('execution_container_wait_error', err, { sessionId });
        emitter.emit('error', err);
        this.cleanupSession(sessionId, 'container_exit_error');
      });

    const lifetimeTimer = setTimeout(() => {
      this.shutdown(sessionId, 'lifetime_exceeded', true);
    }, MAX_LIFETIME_MS);

    session = {
      container,
      stdin: attachStream,
      emitter,
      outputHooks,
      exitHooks,
      clients: 0,
      idleTimer: null,
      lifetimeTimer,
      destroyed: false
    };

    this.sessions.set(sessionId, session);
    logger.session('execution_session_created', { sessionId, containerId: container.id });

    return session;
  }

  cleanupSession(sessionId, reason) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.destroyed = true;
    this.sessions.delete(sessionId);

    // Notify all exit hooks
    for (const hook of session.exitHooks) {
      try {
        hook(reason);
      } catch (err) {
        logger.error('exit_hook_error', err, { sessionId });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Client accounting
  // ---------------------------------------------------------------------------

  async registerClient(sessionId, hooks = {}) {
    const session = await this.ensureSession(sessionId, hooks);
    session.clients += 1;
    this.resetIdleTimer(sessionId);
    logger.debug('execution_client_registered', { sessionId, clients: session.clients });
    return session;
  }

  async deregisterClient(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.clients = Math.max(0, session.clients - 1);
    logger.debug('execution_client_deregistered', { sessionId, clients: session.clients });
    this.resetIdleTimer(sessionId);
  }

  resetIdleTimer(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.idleTimer) clearTimeout(session.idleTimer);

    session.idleTimer = setTimeout(() => {
      if (session.clients === 0) {
        logger.debug('execution_idle_timeout', { sessionId });
        this.shutdown(sessionId, 'idle_timeout');
      }
    }, IDLE_TIMEOUT_MS);
  }

  // ---------------------------------------------------------------------------
  // IO operations
  // ---------------------------------------------------------------------------

  async write(sessionId, data) {
    if (!data) return;

    const session = this.sessions.get(sessionId);
    if (!session || session.destroyed) {
      logger.warn('execution_write_no_session', { sessionId });
      return;
    }

    const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;

    if (payload.length > MAX_STDIN_BYTES) {
      throw new Error('Input too large');
    }

    logger.debug('execution_write', { sessionId, length: payload.length, sample: payload.toString('utf8').slice(0, 50) });
    session.stdin.write(payload);
    this.resetIdleTimer(sessionId);
  }

  /**
   * Run code in a temporary container with the appropriate language runtime.
   * Creates a new container for each execution, supporting multi-language switching.
   * 
   * @param {Object} options
   * @param {string} options.image - Docker image to use (e.g., 'python:3.12-alpine')
   * @param {string} options.code - Code content to execute
   * @param {string} options.filename - Filename to write (e.g., 'main.py')
   * @param {string} options.runCmd - Command to run (e.g., 'python main.py')
   * @param {Function} options.onOutput - Callback for output chunks
   * @returns {Promise<{exitCode: number}>}
   */
  async runInTempContainer({ image, code, filename, runCmd, onOutput }) {
    // Ensure image is available
    try {
      await this.docker.getImage(image).inspect();
    } catch (err) {
      logger.debug('pulling_image_for_execution', { image });
      if (onOutput) onOutput(`Pulling ${image}...\n`);
      await new Promise((resolve, reject) => {
        this.docker.pull(image, (pullErr, pullStream) => {
          if (pullErr) return reject(pullErr);
          this.docker.modem.followProgress(pullStream, (progressErr) => {
            if (progressErr) return reject(progressErr);
            resolve();
          });
        });
      });
    }

    // Create a shell script that writes the code and runs it
    const scriptContent = `
cat > /tmp/workspace/${filename} << 'CODEEOF'
${code}
CODEEOF
cd /tmp/workspace && ${runCmd}
`;

    logger.debug('temp_container_creating', { image, filename, runCmd });

    // Create temp container
    const container = await this.docker.createContainer({
      Image: image,
      Cmd: ['/bin/sh', '-c', scriptContent],
      Tty: false,
      OpenStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        AutoRemove: true,
        NetworkMode: 'none',
        Memory: 256 * 1024 * 1024, // 256 MB
        NanoCpus: 500_000_000, // 0.5 CPU
        PidsLimit: 32,
        Tmpfs: {
          '/tmp/workspace': 'rw,exec,size=67108864' // 64 MB
        }
      }
    });

    // Attach to get output
    const stream = await container.attach({
      stream: true,
      stdout: true,
      stderr: true
    });

    return new Promise(async (resolve, reject) => {
      // Demux stdout/stderr
      container.modem.demuxStream(stream, {
        write: (chunk) => {
          const text = chunk.toString('utf8');
          if (onOutput) onOutput(text);
        }
      }, {
        write: (chunk) => {
          const text = chunk.toString('utf8');
          if (onOutput) onOutput(text);
        }
      });

      // Start container
      try {
        await container.start();
      } catch (startErr) {
        logger.error('temp_container_start_failed', startErr);
        reject(startErr);
        return;
      }

      // Wait for completion
      try {
        const result = await container.wait();
        logger.debug('temp_container_finished', { exitCode: result.StatusCode });
        resolve({ exitCode: result.StatusCode });
      } catch (waitErr) {
        logger.error('temp_container_wait_failed', waitErr);
        resolve({ exitCode: -1 });
      }
    });
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

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  async shutdown(sessionId, reason = 'manual_shutdown', force = false) {
    const session = this.sessions.get(sessionId);
    if (!session || session.destroyed) return;

    session.destroyed = true;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    if (session.lifetimeTimer) clearTimeout(session.lifetimeTimer);

    logger.debug('execution_shutdown_starting', { sessionId, reason, force });

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
      this.cleanupSession(sessionId, reason);
      logger.session('execution_session_ended', { sessionId, reason });
    }
  }
}

module.exports = {
  ExecutionManager,
  executionManager: new ExecutionManager()
};
