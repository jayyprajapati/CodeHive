const mongoose = require("mongoose");
require("dotenv").config();
const mongoUserName = process.env.MONGODB_USERNAME;
const mongoUserPassword = process.env.MONGODB_PASSWORD;
const mongoURI = `mongodb+srv://${mongoUserName}:${mongoUserPassword}@unifiedcluster.bj7dm.mongodb.net/?retryWrites=true&w=majority&appName=UnifiedCluster`;

mongoose.set('strictQuery', true);

const connectToMongo = () => {
  mongoose.connect(mongoURI, (err) => {
    if (err) console.log(err);
    else console.log("Connected to Mongo");
  });
};

module.exports = connectToMongo;
