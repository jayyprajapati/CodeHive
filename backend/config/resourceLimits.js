/**
 * Resource & Lifecycle Limits — Centralized Configuration
 *
 * All values are sourced from environment variables with sensible defaults.
 * These limits are MANDATORY for public deployment.
 *
 * @module config/resourceLimits
 */

const limits = Object.freeze({
    /** Maximum concurrent sessions (playground + collaborative combined) */
    MAX_ACTIVE_SESSIONS: Number(process.env.MAX_ACTIVE_SESSIONS || 10),

    /** Idle timeout per session in ms (no terminal-input, run-code, or socket activity) */
    IDLE_TIMEOUT_MS: Number(process.env.IDLE_TIMEOUT_MS || 5 * 60 * 1000), // 5 minutes

    /** Maximum execution time per run-code invocation in ms */
    MAX_EXECUTION_TIME_MS: Number(process.env.MAX_EXECUTION_TIME_MS || 15_000), // 15 seconds

    /** Grace period after SIGINT before sending SIGKILL, in ms */
    SIGKILL_GRACE_MS: 3_000,

    /** Maximum memory per container in bytes */
    MAX_MEMORY_BYTES: Number(process.env.MAX_MEMORY_MB || 256) * 1024 * 1024,

    /** Maximum concurrent Docker containers */
    MAX_CONTAINERS: Number(process.env.MAX_CONTAINERS || 15),

    /** PID limit per container */
    PIDS_LIMIT: 64,

    /** CPU allocation (0.5 CPU in nanocpus) */
    CPU_NANOS: 500_000_000,

    /** Docker image for execution */
    EXECUTION_IMAGE: process.env.EXECUTION_IMAGE || 'codehive-executor',

    /** Max container lifetime in ms */
    MAX_LIFETIME_MS: Number(process.env.EXECUTION_MAX_LIFETIME_MS || 60 * 60 * 1000),

    /** Force-kill timeout for graceful shutdown, in ms */
    FORCE_KILL_TIMEOUT_MS: 5_000,

    /** Max stdin payload size in bytes */
    MAX_STDIN_BYTES: 64 * 1024
});

module.exports = limits;
