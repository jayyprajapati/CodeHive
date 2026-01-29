const { io } = require("socket.io-client");

const sessionId = "jK3W-t7Vn-ZduJ-7XUO";
const password = "8ehjd6";
const userId = "tester-1";
const user = "tester";

const socket = io("http://localhost:8000", {
  transports: ["websocket"],
});

socket.on("connect", () => {
  console.log("connected", socket.id);
  socket.emit("join-session", { sessionId, password, userId, user });
});

socket.on("session-data", (d) => console.log("session-data", d));
socket.on("error", (e) => console.log("error", e));
socket.on("terminal-output", (m) => console.log("TERMINAL OUT:", m.output));
socket.on("terminal-closed", (m) => console.log("TERMINAL CLOSED:", m));

setTimeout(() => {
  console.log("sending input: ls");
  socket.emit("terminal-input", { sessionId, input: "ls\n" });
}, 2000);

setTimeout(() => {
  console.log("sending input: node -v");
  socket.emit("terminal-input", { sessionId, input: "node -v\n" });
}, 4000);

setTimeout(() => {
  console.log("run-code simple console.log");
  socket.emit("run-code", {
    sessionId,
    code: "console.log('hello from run code');",
    language: "javascript",
  });
}, 6000);

// exit after 15s
setTimeout(() => {
  console.log("done");
  socket.close();
  process.exit(0);
}, 15000);