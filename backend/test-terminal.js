const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:8000";

// ============================================================================
// Test 1: Playground Mode (no login, no password)
// ============================================================================

function testPlayground() {
  console.log("\n=== TEST: Playground Mode ===\n");

  const socket = io(SERVER_URL, { transports: ["websocket"] });

  let playgroundSessionId = null;

  socket.on("connect", () => {
    console.log("[playground] connected:", socket.id);
    socket.emit("join-playground", { language: "javascript" });
  });

  socket.on("playground-ready", (data) => {
    console.log("[playground] ready:", data);
    playgroundSessionId = data.sessionId;
  });

  socket.on("error", (e) => console.log("[playground] error:", e));
  socket.on("terminal-output", (m) =>
    console.log("[playground] TERMINAL OUT:", m.output)
  );
  socket.on("terminal-closed", (m) =>
    console.log("[playground] TERMINAL CLOSED:", m)
  );

  setTimeout(() => {
    console.log("[playground] sending: ls");
    socket.emit("terminal-input", {
      sessionId: playgroundSessionId,
      input: "ls\n",
    });
  }, 3000);

  setTimeout(() => {
    console.log("[playground] sending: node -v");
    socket.emit("terminal-input", {
      sessionId: playgroundSessionId,
      input: "node -v\n",
    });
  }, 5000);

  setTimeout(() => {
    console.log("[playground] run-code: console.log('hello from playground')");
    socket.emit("run-code", {
      sessionId: playgroundSessionId,
      code: "console.log('hello from playground');",
      language: "javascript",
    });
  }, 7000);

  setTimeout(() => {
    console.log("[playground] disconnecting (container should be destroyed)");
    socket.close();
    console.log("[playground] DONE\n");
  }, 12000);
}

// ============================================================================
// Test 2: Collaborative Mode (existing behavior)
// ============================================================================

function testCollaborative() {
  console.log("\n=== TEST: Collaborative Mode ===\n");

  const sessionId = "jK3W-t7Vn-ZduJ-7XUO";
  const password = "8ehjd6";
  const userId = "tester-1";
  const user = "tester";

  const socket = io(SERVER_URL, { transports: ["websocket"] });

  socket.on("connect", () => {
    console.log("[collab] connected:", socket.id);
    socket.emit("join-session", { sessionId, password, userId, user });
  });

  socket.on("session-data", (d) => console.log("[collab] session-data:", d));
  socket.on("error", (e) => console.log("[collab] error:", e));
  socket.on("terminal-output", (m) =>
    console.log("[collab] TERMINAL OUT:", m.output)
  );
  socket.on("terminal-closed", (m) =>
    console.log("[collab] TERMINAL CLOSED:", m)
  );

  setTimeout(() => {
    console.log("[collab] sending: ls");
    socket.emit("terminal-input", { sessionId, input: "ls\n" });
  }, 2000);

  setTimeout(() => {
    console.log("[collab] sending: node -v");
    socket.emit("terminal-input", { sessionId, input: "node -v\n" });
  }, 4000);

  setTimeout(() => {
    console.log("[collab] run-code");
    socket.emit("run-code", {
      sessionId,
      code: "console.log('hello from collab');",
      language: "javascript",
    });
  }, 6000);

  setTimeout(() => {
    console.log("[collab] disconnecting");
    socket.close();
    console.log("[collab] DONE\n");
  }, 12000);
}

// ============================================================================
// Main
// ============================================================================

const mode = process.argv[2] || "playground";

if (mode === "playground") {
  testPlayground();
} else if (mode === "collaborative") {
  testCollaborative();
} else if (mode === "both") {
  testPlayground();
  setTimeout(() => testCollaborative(), 15000);
} else {
  console.log("Usage: node test-terminal.js [playground|collaborative|both]");
  process.exit(1);
}