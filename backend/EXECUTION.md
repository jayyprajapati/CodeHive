# Execution Subsystem

This backend now runs a persistent, per-room shell inside a Docker sandbox and streams terminal I/O over Socket.IO. Use this document as the authoritative guide for how stdin/stdout flow, how sessions are created/destroyed, and what the current limitations are.

## Data Flow (stdin/stdout)
- Clients emit `terminal-input` with `{ sessionId, input }`.
- The server validates membership, then writes the payload into the room's PTY-backed shell via `executionManager.write()`.
- The Docker-attached stream emits stdout/stderr chunks; these are forwarded immediately as `terminal-output` with `{ sessionId, output }` to everyone in the room.
- When owners issue `terminal-shutdown` (or the room ends/empties), the server emits `terminal-closed` with `{ sessionId, reason }`.
- `run-code` is still supported: code is written into a file inside the sandbox and executed through the live shell so output arrives through the same `terminal-output` stream; `execution-complete` is emitted once the request is queued.

## Session Lifecycle
1. First user join: `join-session` now calls `executionManager.registerClient()`, which starts a Docker container (if absent) and attaches the output hooks.
2. While users are present: `registerClient` bumps an idle timer; stdin/stdout remain live for the room.
3. Last user leaves/disconnects: `deregisterClient` runs; if the client count reaches zero an idle timer (default 5 minutes) will stop the container.
4. Hard stops: the owner can emit `end-session` or `terminal-shutdown`; both trigger `executionManager.shutdown()` immediately. Unexpected container exits also surface as `terminal-closed`.

## Sandbox & Limits
- Image: `node:20-alpine` (override via `EXECUTION_IMAGE`).
- Runtime: PTY-backed `/bin/sh` running as the `node` user.
- Isolation: `NetworkMode=none`, `ReadonlyRootfs=true`, `Tmpfs` mounts for `/home/node/workspace` (128MB) and `/tmp` (64MB), `CapDrop=ALL`, `no-new-privileges`.
- Resource limits: `NanoCpus=500000000` (~0.5 vCPU), `Memory=512MB`, `PidsLimit=64` (tune via env vars).
- Lifetimes: idle timeout 5 minutes when no clients, hard cap 1 hour per container. Graceful stop falls back to `SIGKILL` after 5s.

## Known Limitations
- Single runtime: only JavaScript (Node) is enabled; other languages will be rejected with a server notice.
- Files are ephemeral: the workspace lives on tmpfs and is destroyed when the container stops.
- `execution-complete` is best-effort; the terminal stream is the source of truth for command output/finish.
- Docker must be available to the backend host with enough privileges to run the constrained containers.

## Operational Notes
- Key server code lives in [services/executionManager.js](services/executionManager.js) and [socket.js](socket.js).
- Tune limits via env vars: `EXECUTION_IMAGE`, `EXECUTION_NANO_CPUS`, `EXECUTION_MEMORY_BYTES`, `EXECUTION_PIDS_LIMIT`, `EXECUTION_IDLE_TIMEOUT_MS`, `EXECUTION_MAX_LIFETIME_MS`, `EXECUTION_FORCE_KILL_TIMEOUT_MS`, `EXECUTION_MAX_STDIN_BYTES`.
- Python execution image default: `codehive-python:latest` (override with `PYTHON_EXECUTION_IMAGE`, for example `codehive-python:v1`).
- Rebuild and refresh the Python image on the server when Dockerfile/package changes are made:

```bash
cd backend/execution-images/python
docker build -t codehive-python:latest .
docker stop $(docker ps -aq --filter "ancestor=codehive-python") || true
docker rm $(docker ps -aq --filter "ancestor=codehive-python") || true
docker image prune -f
```

- `terminal-output` is streaming; do not buffer on the client side if you need real-time behavior.
