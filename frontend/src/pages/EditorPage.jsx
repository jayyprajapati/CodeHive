import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import Split from "react-split";
import { useAuth } from "../contexts/AuthContext";
import useSocket from "../hooks/useSocket";
import Loader from "../components/Loader";
import Chat from "../components/Chat";
import RoleManager from "../components/RoleManager";
import TerminalUI from "../components/TerminalUI";
import { CopyToClipboard } from "react-copy-to-clipboard";
import {Check, Clipboard, Key, EllipsisVertical} from 'lucide-react'

import Button from '../components/Button';

const LANGUAGE_TEMPLATES = {
  python: "# New Python Session Started\n\n",
  javascript: "// New JavaScript Session Started\n\n",
  java: `public class code {\n    public static void main(String[] args) {\n        // New Java Session Started. Do not change the template. Start coding from here.\n        \n\n    }\n}\n`,
};

const langOptions = ["javascript", "python", "java"];

const toTitleCase = (text) =>
  text.replace(
    /\w\S*/g,
    (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );

export default function EditorPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const location = useLocation();
  const { socket, isConnected } = useSocket();
  const { currentUser } = useAuth();
  const editorRef = useRef(null);
  const debounceTimeoutRef = useRef(null);

  const [sessionState, setSessionState] = useState({
    code: "",
    language: "javascript",
    users: [],
    userRole: "editor",
    chatMessages: [],
  });

  const [uiState, setUiState] = useState({
    copiedSessionId: false,
    copiedPass: false,
    isLangSelectDropdownOpen: false,
    toggleRoleManagerDropdown: false,
  });

  const [loading, setLoading] = useState({
    isCodeRunning: false,
    isSessionEnding: false,
  });

  const { code, language, users, userRole, chatMessages } = sessionState;
  const { isCodeRunning, isSessionEnding } = loading;
  const sessionPassword = location.state?.sessionPassword;

  // Socket event handlers
  useEffect(() => {
    if (!isConnected || !socket || !currentUser) return;

    const handleSessionData = ({ code: initialCode, chat, role, language: initialLanguage }) => {
      setSessionState((prev) => ({
        ...prev,
        code: initialCode || LANGUAGE_TEMPLATES[initialLanguage || prev.language],
        userRole: role,
        chatMessages: chat || [],
        language: initialLanguage || prev.language,
      }));
    };

    const handleCodeUpdate = (newCode) => {
      setSessionState((prev) => ({ ...prev, code: newCode }));
    };

    const handleLanguageUpdate = (newLanguage) => {
      setSessionState((prev) => ({ ...prev, language: newLanguage }));
    };

    const handleUserList = (userList) => {
      setSessionState((prev) => ({
        ...prev,
        users: userList.filter((u) => u.name !== currentUser.displayName),
      }));
    };

    const handleRoleUpdated = ({ user, newRole }) => {
      if (user === currentUser.displayName) {
        setSessionState((prev) => ({ ...prev, userRole: newRole }));
      }
      setSessionState((prev) => ({
        ...prev,
        users: prev.users.map((u) =>
          u.name === user ? { ...u, role: newRole } : u
        ),
      }));
    };

    const handleUserLeft = ({ user, message }) => {
      setSessionState((prev) => ({
        ...prev,
        users: prev.users.filter((u) => u.name !== user),
        chatMessages: [...prev.chatMessages, { type: "system", message }],
      }));
    };

    const handleChatMessage = (message) => {
      setSessionState((prev) => ({
        ...prev,
        chatMessages: [...prev.chatMessages, message],
      }));
    };

    const handleSessionEnded = () => navigate("/dashboard");
    const handleExecutionComplete = () => setLoading((prev) => ({ ...prev, isCodeRunning: false }));

    socket.emit("join-session", {
      sessionId,
      user: currentUser.displayName,
      password: sessionPassword,
      userId: currentUser.uid,
    });

    socket.on("session-data", handleSessionData);
    socket.on("code-update", handleCodeUpdate);
    socket.on("language-update", handleLanguageUpdate);
    socket.on("user-list", handleUserList);
    socket.on("role-updated", handleRoleUpdated);
    socket.on("user-left", handleUserLeft);
    socket.on("chat-message", handleChatMessage);
    socket.on("session-ended", handleSessionEnded);
    socket.on("execution-complete", handleExecutionComplete);

    return () => {
      socket.off("session-data", handleSessionData);
      socket.off("code-update", handleCodeUpdate);
      socket.off("language-update", handleLanguageUpdate);
      socket.off("user-list", handleUserList);
      socket.off("role-updated", handleRoleUpdated);
      socket.off("user-left", handleUserLeft);
      socket.off("chat-message", handleChatMessage);
      socket.off("session-ended", handleSessionEnded);
      socket.off("execution-complete", handleExecutionComplete);
    };
  }, [isConnected, socket, sessionId, currentUser, sessionPassword, navigate]);

  const handleEditorChange = useCallback(
    (value) => {
      setSessionState((prev) => ({ ...prev, code: value }));
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(() => {
        if (socket?.connected) {
          socket.emit("code-change", { sessionId, code: value });
        }
      }, 500);
    },
    [socket, sessionId]
  );

  const handleLanguageChange = (newLang) => {
    if (
      code !== LANGUAGE_TEMPLATES[language] &&
      code !== "" &&
      !confirm("Changing language will reset the editor. Continue?")
    ) {
      return;
    }
    setUiState((prev) => ({ ...prev, isLangSelectDropdownOpen: false }));
    const newCode = LANGUAGE_TEMPLATES[newLang];
    setSessionState((prev) => ({ ...prev, language: newLang, code: newCode }));
    socket.emit("code-change", { sessionId, code: newCode });
    socket.emit("language-change", { sessionId, language: newLang });
  };

  const handleRunCode = () => {
    setLoading((prev) => ({ ...prev, isCodeRunning: true }));
    socket.emit("run-code", { sessionId, code, language });
  };

  const handleEndSession = () => {
    setLoading((prev) => ({ ...prev, isSessionEnding: true }));
    socket.emit("end-session", { sessionId, userId: currentUser.uid });
  };

  const handleLeaveSession = () => {
    socket.emit("leave-session", sessionId);
    navigate("/dashboard");
  };

  const handleNewMessage = useCallback((message) => {
    socket.emit("chat-message", { sessionId, message, user: currentUser.displayName });
  }, [socket, sessionId, currentUser]);
  
  const handleCopy = (type) => {
    setUiState((prev) => ({ ...prev, [type]: true }));
    setTimeout(() => setUiState((prev) => ({ ...prev, [type]: false })), 1500);
  };

  const editorOptions = {
    readOnly: userRole === "viewer",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
  };

  if (!isConnected || !currentUser) {
    return <Loader />;
  }

  return (
    <div className="editor-container">
      <div className="editor-header">
        <div className="session-details">
          <h2>{sessionId}</h2>
          <CopyToClipboard text={sessionId} onCopy={() => handleCopy("copiedSessionId")}>
            <button title="Copy Session ID" className="copy-btn">
              {uiState.copiedSessionId ? <Check /> : <Clipboard />}
            </button>
          </CopyToClipboard>
          <CopyToClipboard text={sessionPassword} onCopy={() => handleCopy("copiedPass")}>
            <button title="Copy Password" className="copy-btn">
              {uiState.copiedPass ? <Check /> : <Key />}
            </button>
          </CopyToClipboard>
        </div>

        <div className="avatar-role-manager">
          <div className="user-avatars">
            {users.slice(0, 4).map((user) => (
              <div key={user.name} className="user-avatar" title={user.name}>
                {user.name[0].toUpperCase()}
              </div>
            ))}
            {users.length > 0 && userRole === "owner" && (
              <button
                className="manage-users-btn"
                onClick={() =>
                  setUiState((prev) => ({
                    ...prev,
                    toggleRoleManagerDropdown: !prev.toggleRoleManagerDropdown,
                  }))
                }
                title="Manage Users"
              >
                <EllipsisVertical />
              </button>
            )}
          </div>
          {userRole === "owner" && uiState.toggleRoleManagerDropdown && (
            <RoleManager
              users={users}
              onRoleChange={(user, role) => {
                socket.emit("change-role", {
                  sessionId,
                  targetUser: user,
                  newRole: role,
                });
              }}
            />
          )}
        </div>

        {userRole === "owner" ? (
          <Button
            variant="error"
            onClick={handleEndSession}
            disabled={isSessionEnding}
            startIcon={isSessionEnding ? <div className="spinner"></div> : null}
            className="end-session-btn"
          >
            {isSessionEnding ? "Ending..." : "End Session"}
          </Button>
        ) : (
          <Button
            variant="warning"
            onClick={handleLeaveSession}
            disabled={isSessionEnding}
            className="leave-session-btn"
          >
            Leave Session
          </Button>
        )}
      </div>

      <div style={{ height: "calc(100vh - 60px)" }}>
        <Split
          sizes={[50, 50]}
          minSize={100}
          expandToMin={false}
          gutterSize={10}
          gutterAlign="center"
          direction="horizontal"
          cursor="col-resize"
          className="wrap"
        >
          <div className="h-full">
            <div className="editor-head">
              <div className="editor-title">
                 <span>Editor</span>
              </div>
              <div className="editor-file-name">
                Code.{language === "javascript" ? "js" : language === "python" ? "py" : "java"}
              </div>
              <div className="editor-actions">
                <div className="lang-select-wrapper">
                  <button
                    className="lang-select"
                    onClick={() =>
                      setUiState((prev) => ({
                        ...prev,
                        isLangSelectDropdownOpen: !prev.isLangSelectDropdownOpen,
                      }))
                    }
                  >
                    {toTitleCase(language)} ↓
                  </button>
                  {uiState.isLangSelectDropdownOpen && (
                    <div className="lang-select-dropdown">
                      {langOptions.map((lang) => (
                        <div
                          className="lang-select-option"
                          key={lang}
                          onClick={() => handleLanguageChange(lang)}
                        >
                          <span
                            style={{
                              visibility: lang === language ? "visible" : "hidden",
                            }}
                          >✓</span>
                          {toTitleCase(lang)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  className="run-button"
                  onClick={handleRunCode}
                  disabled={isCodeRunning}
                >
                  {isCodeRunning ? "Running..." : "Run"}
                </button>
              </div>
            </div>
            <Editor
              width="100%"
              height="calc(100% - 40px)"
              language={language}
              value={code}
              onChange={handleEditorChange}
              theme="vs-dark"
              onMount={(editor) => (editorRef.current = editor)}
              options={editorOptions}
            />
          </div>

          <Split
            sizes={[50, 50]}
            minSize={[100, 100]}
            expandToMin={false}
            gutterSize={10}
            direction="vertical"
            cursor="row-resize"
            className="h-full flex flex-col"
          >
            <TerminalUI
              socket={socket}
              sessionId={sessionId}
              isRunning={isCodeRunning}
            />
            <Chat
              socket={socket}
              sessionId={sessionId}
              currentUser={currentUser}
              messages={chatMessages}
              onNewMessage={handleNewMessage}
            />
          </Split>
        </Split>
      </div>
    </div>
  );
}
