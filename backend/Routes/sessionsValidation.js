const express = require("express");
// const Session = require("../Models/Session");
const router = express.Router();
const {createSession, verifySession, sessionExists} = require('../middleware/SessionManagement')


 router.post('/verify-session', async(req, res, next) => {
    try {
      const { sessionId, password } = req.body;
      if (!(await sessionExists(sessionId))) {
        return res.status(404).json({ valid: false, error: 'Session does not exist' });
      }
      if (!(await verifySession(sessionId, password))) {
        return res.status(401).json({ valid: false, error: 'Invalid password' });
      }
      res.json({ valid: true });
    } catch (error) {
      next(error);
    }
  });

  router.post('/create-session', async (req, res, next) => {
    try {
      const { sessionId, password, owner } = req.body;
      if (await sessionExists(sessionId)) {
        return res.status(400).json({ valid: false, error: 'Session ID exists' });
      }
      await createSession(sessionId, password, owner);
      res.json({ valid: true });
    } catch (error) {
      next(error);
    }
  });


  module.exports = router;