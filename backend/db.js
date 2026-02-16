const mongoose = require("mongoose");
require("dotenv").config();

const mongoURI = process.env.MONGODB_URI;

mongoose.set('strictQuery', true);

const connectToMongo = () => {
  mongoose.connect(mongoURI, (err) => {
    if (err) console.log(err);
    else console.log("Connected to Mongo");
  });
};

module.exports = connectToMongo;
