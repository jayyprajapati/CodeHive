const { Server } = require('socket.io');
const Docker = require('dockerode');
const { Buffer } = require('buffer');
const axios = require('axios');
const { Session } = require('./Models/Session');
const { verifySession, sessionExists, getSession, removeUserFromSession, isCodeSafe} = require('./middleware/SessionManagement');

const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: "https://*.jayprajapati.me",
      methods: ["GET", "POST"],
      allowedHeaders: ["Authorization"],
      credentials: true
    },
    transports: ['websocket']
  });

  const docker = new Docker();

  io.on('connect', (socket) => {
    console.log('Client connected:', socket.id);
  
    socket.on('join-session', async (data) => {
      try {
        const { sessionId, password, user, userId } = data;
        const session = await getSession(sessionId);
        
        if (!(await sessionExists(sessionId)) || !(await verifySession(sessionId, password))) {
          return socket.emit('error', { message: 'Invalid session or password' });
        }
  
        
        const userEntry = {
            socketId: socket.id,
            name: user,
            userId,
            role: userId === session.owner ? 'owner' : 'editor'
        };

        await Session.updateOne(
            { sessionId },
            { $push: { users: userEntry } }
        );

        const updatedSession = await getSession(sessionId);
        socket.join(sessionId);
        io.to(sessionId).emit('user-list', updatedSession.users.map(u => ({ name: u.name, role: u.role })));
        socket.broadcast.to(sessionId).emit('user-joined', { user });
        socket.emit('session-data', {
            code: updatedSession.code,
            chat: updatedSession.chat,
            role: updatedSession.users.find(u => u.socketId === socket.id)?.role || 'viewer'
        });
      } catch (error) {
        socket.emit('error', { message: 'Internal server error' });
      }
    });

    socket.on('change-role', async (data) => {
        try {
            const { sessionId, targetUser, newRole } = data;
                    const session = await getSession(sessionId);
                    
                    if (session) {
                    const requester = session.users.find(u => u.socketId === socket.id);
                      
                      if (requester?.role === 'owner') {
                        await Session.findOneAndUpdate(
                            { 
                              sessionId,
                              "users.name": targetUser 
                            },
                            { $set: { "users.$.role": newRole } }
                          );
            
                        const updatedSession = await getSession(sessionId);
                        io.to(sessionId).emit('role-updated', {
                            user: targetUser,
                            newRole: newRole,
                            userList: updatedSession.users.map(u => ({
                              name: u.name,
                              role: u.role
                            }))
                          });
                      }
                    }
        } catch (error) {
            console.error('Role change error:', error);
            socket.emit('error', { message: 'Role change failed' });
          }
        
    });

    socket.on('end-session', async (data) => {
        try {
            console.log("session end signal received")
            const { sessionId, userId } = data;
            const session = await getSession(sessionId);
            if (session?.owner === userId) {
                await Session.deleteOne({ sessionId });
                console.log("session deleted");
                
                io.to(sessionId).emit('session-ended');
            }
        } catch (error) {
            console.error('Session termination error:', error);
          }
        
    });

    socket.on('leave-session', async (sessionId) => {
        try {
            console.log("leave session signal received")
            const session = await getSession(sessionId);
            if (session) {
                const user = session.users.find(u => u.socketId === socket.id);
                // console.log("user: ", user)
                if (user) {
                await removeUserFromSession(sessionId, socket.id);
                socket.leave(sessionId);
                // console.log(user);
                io.to(sessionId).emit('user-left', {
                    user: user.name,
                    message: `${user.name} has left the session`
                });
                }
            }
        } catch (error) {
            console.error('Leave session error:', error);
          }
        
    });
  
    socket.on('code-change', async (data) => {
        try {
            await Session.findOneAndUpdate(
                { sessionId: data.sessionId },
                { $set: { code: data.code } }
              );
              socket.broadcast.to(data.sessionId).emit('code-update', data.code);
        } catch (error) {
            console.error('Code update error:', error);
          }
      
    });
  
    socket.on('send-chat-message', async (data) => {
        try {
            const session = await getSession(data.sessionId);
            if (session) {
            const user = session.users.find(u => u.socketId === socket.id);
            const message = {
                user: user.name,
                message: data.message,
                timestamp: new Date().toISOString()
            };

            await Session.findOneAndUpdate(
                { sessionId: data.sessionId },
                { $push: { chat: message } }
            );
            io.to(data.sessionId).emit('chat-message', message);
            }
        } catch (error) {
            console.error('Chat message error:', error);
        }
      
    });
  
    socket.on('run-code', async (data) => {
        const { sessionId, code, language } = data;
        const encodedCode = Buffer.from(code).toString('base64');

        const session = await getSession(sessionId);
        if (!session || !session.active) {
            return socket.emit('error', { message: 'Invalid session' });
        }

        if (!isCodeSafe(data.code, data.language)) {
          return io.to(data.sessionId).emit('terminal-output', {
            sessionId: data.sessionId,
            output: "Error: Code contains prohibited patterns\n"
          });
        }
    
        try {

          const PISTON_API_URL = 'https://emkc.org/api/v2/piston/execute';
const ALLOWED_LANGUAGES = {
  javascript: { version: '18.15.0' },
  python: { version: '3.10.0' },
  java: { version: '15.0.2' }
};

          // Execute via Piston API
    const response = await axios.post(PISTON_API_URL, {
      language: language,
      version: ALLOWED_LANGUAGES[language].version,
      files: [{ content: code }],
      stdin: '',
      args: [],
      compile_timeout: 10000,
      run_timeout: 5000,
      compile_memory_limit: -1,
      run_memory_limit: -1
    });

    const result = response.data;
    let output = '';

    if (result.compile && result.compile.stderr) {
      output += `Compilation Error:\n${result.compile.stderr}\n`;
    }

    if (result.run.stderr) {
      output += `Runtime Error:\n${result.run.stderr}\n`;
    }

    if (result.run.stdout) {
      output += `Output:\n${result.run.stdout}\n`;
    }

    // Sanitize and limit output
    const sanitizedOutput = output
      .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
      .slice(0, 2000);
          
          io.to(sessionId).emit('terminal-output', {
            sessionId,
            output: sanitizedOutput
          });

          // Emit completion
          io.to(sessionId).emit('execution-complete', { sessionId });
    
          // Cleanup
    
        } catch (error) {
          console.error('Execution error:', error);
          const output = error.response?.data?.output || error.message;
          io.to(sessionId).emit('terminal-output', {
            sessionId,
            output:  `Execution error: ${output}\n`
          });
        }
    });

    socket.on('disconnect', async () => {
        try {
            const sessions = await Session.find({
                'users.socketId': socket.id
            });

            for (const session of sessions) {
                await Session.updateOne(
                  { sessionId: session.sessionId },
                  { $pull: { users: { socketId: socket.id } } }
                );
        
                const user = session.users.find(u => u.socketId === socket.id);
                if (user) {
                  io.to(session.sessionId).emit('user-left', { 
                    user: user.name,
                    message: `${user.name} has disconnected`
                  });
                }
              }
        } catch (error) {
            console.error('Disconnect cleanup error:', error);
          }
      
    });
  });
};

module.exports = initSocket;