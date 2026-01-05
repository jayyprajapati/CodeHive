const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');


const sessionSchema = new mongoose.Schema({
    sessionId: String,
    users: [{
      socketId: String,
      name: String,
      userId: String,
      role: String
    }],
    code: String,
    chat: [{
      user: String,
      message: String,
      timestamp: Date
    }],
    password: String,
    owner: String,
    createdAt: Date,
    active: Boolean
  });
  
  const Session = mongoose.model('Session', sessionSchema);

    Session.collection.createIndex({ sessionId: 1 }, { unique: true });
    Session.collection.createIndex({ "users.socketId": 1 });
    Session.collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 });
  
  module.exports = { Session, session, MongoStore };