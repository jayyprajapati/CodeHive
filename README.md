# CodeHive Monorepo

End-to-end guide for running the collaborative editor locally. This repo has a Node/Express backend with Socket.IO + Docker-based execution, and a Vite/React frontend.

## Prerequisites
- Node.js 20+ (backend and frontend)
- npm 10+
- Docker Desktop (for the sandboxed executor containers)
- MongoDB instance reachable from your machine

## Environment Variables

### Backend (`backend/.env`)
Required:
- `MONGODB_URI` – connection string for MongoDB
- `PORT` – port for the HTTP/Socket.IO server (default 8000)

Execution tuning (optional – defaults in code):
- `EXECUTION_IMAGE` (default `codehive-executor`)
- `EXECUTION_NANO_CPUS` (default `500000000` ≈ 0.5 vCPU)
- `EXECUTION_MEMORY_BYTES` (default `536870912` = 512MB)
- `EXECUTION_PIDS_LIMIT` (default `64`)
- `EXECUTION_IDLE_TIMEOUT_MS` (default `300000` = 5 minutes)
- `EXECUTION_MAX_LIFETIME_MS` (default `3600000` = 1 hour)
- `EXECUTION_FORCE_KILL_TIMEOUT_MS` (default `5000` ms)
- `EXECUTION_MAX_STDIN_BYTES` (default `65536` bytes)

### Frontend (`frontend/.env`)
- `VITE_API_KEY`
- `VITE_AUTH_DOMAIN`
- `VITE_PROJECT_ID`
- `VITE_STORAGE_BUCKET`
- `VITE_SENDER_ID`
- `VITE_APP_ID`
- `VITE_WEBSOCKET_URL` – base URL of the backend (e.g., `http://localhost:8000`)

## Backend Setup
1) Install deps
```bash
cd backend
npm install
```
2) Build the executor image (only once, requires Docker)
```bash
docker build -t codehive-executor -f Dockerfile.executor .
```
3) Start MongoDB (local or remote). Ensure `MONGODB_URI` is reachable.
4) Run the server
```bash
# dev with auto-reload (requires npx to find local nodemon)
npx nodemon index.js
# or plain node
node index.js
```
The server exposes REST and Socket.IO on `PORT` (default 8000).

## Frontend Setup
1) Install deps
```bash
cd frontend
npm install
```
2) Create `.env` with the values above. Set `VITE_WEBSOCKET_URL` to the backend URL (include protocol and port).
3) Run dev server
```bash
npm run dev
```
Vite defaults to `http://localhost:5173`.

## Services to Have Running
- Docker daemon (for execution containers)
- MongoDB (for sessions and chat state)
- Backend server (Express + Socket.IO)
- Frontend dev server (Vite)

Start them in this order: MongoDB → Docker → backend → frontend.

## Available Commands

### Backend
- `npm install` – install dependencies
- `docker build -t codehive-executor -f Dockerfile.executor .` – build executor image
- `npx nodemon index.js` – run backend with reload
- `node index.js` – run backend without reload

### Frontend
- `npm install` – install dependencies
- `npm run dev` – start Vite dev server
- `npm run build` – production build
- `npm run preview` – preview the production build
- `npm run lint` – run ESLint

## Notes
- Socket.IO CORS is configured for `https://*.jayprajapati.me`; in dev, `VITE_WEBSOCKET_URL` should be `http://localhost:8000`.
- The executor runs inside Docker with no network access and temporary storage; code and files are ephemeral per session.
