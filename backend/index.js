const connectToMongo = require("./db");
// const { connectRedisCloud } = require("./redis");
const express = require("express");
const cors = require("cors");
const bodyParser = require('body-parser');
const { createServer } = require("http");
const initSocket = require("./socket");
const errorHandler = require("./utils/errorHandler");
require("dotenv").config();

connectToMongo();
// connectRedisCloud();

const app = express();
const port = process.env.PORT || 8000;

// CORS Configuration
app.use(cors({
  origin: '*'
}));

app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const httpServer = createServer(app);

// Initialize WebSocket server
initSocket(httpServer);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// Available Routes
// app.use("/api/auth/", require("./Routes/auth"));
// app.use("/api/notes/", require("./Routes/notes"));
// app.use("/api/stocks/", require("./Routes/stocks"));
// app.use("/api/connect/", require("./Routes/messages"));
app.use("/api/validateSession/", require("./Routes/sessionsValidation"));

// Error handling middleware
app.use(errorHandler);

httpServer.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});