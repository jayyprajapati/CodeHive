import { useState, useEffect } from "react";
import PropTypes from "prop-types";

export default function Chat({ socket, sessionId, currentUser, messages, onNewMessage }) {
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (msg) => {
      onNewMessage(msg);
    };

    socket.on("chat-message", handleNewMessage);

    return () => {
      socket.off("chat-message", handleNewMessage);
    };
  }, [socket, onNewMessage]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (message.trim()) {
      socket.emit("send-chat-message", {
        sessionId,
        message: message.trim(),
        userId: currentUser.uid,
        userName: currentUser.displayName,
      });
      onNewMessage({ type: "user", message: message.trim(), user: currentUser.displayName });
      setMessage("");
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`message ${
              msg.type === "system" ? "system-message" : ""
            }`}
          >
            {msg.type === "system" ? (
              <em>{msg.message}</em>
            ) : (
              <>
              <div  className={`user-message ${msg.user == currentUser.displayName ? "message-sender" : ""}`}>
                <div>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{color: '#999'}}>
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                  </svg>
                </div>
              <div className="message-text">
              <div className="message-sender-name">{msg.user}</div>
              <div className={`message-content ${msg.user == currentUser.displayName ? "message-sender-content" : ""}`}>{msg.message}</div>
              </div>
              </div>
              
              
                {/* <strong>{msg.user}:</strong> {msg.message} */}
              </>
            )}
          </div>
        ))}
      </div>

        <div className="send-chat-input">
          <form onSubmit={sendMessage} className="chat-form">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Send a message..."
              className="chat-input"
            />
            <button type="submit" className="chat-send-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </form>
        </div>
      

      {/* <form onSubmit={sendMessage}>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message..."
        />
        <button type="submit">Send</button>
      </form> */}
    </div>
  );
}

Chat.propTypes = {
  socket: PropTypes.object.isRequired,
  sessionId: PropTypes.string.isRequired,
  currentUser: PropTypes.object.isRequired,
  messages: PropTypes.array.isRequired,
  onNewMessage: PropTypes.func.isRequired
};
