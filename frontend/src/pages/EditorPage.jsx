import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import Split from "react-split";
import { useAuth } from "../contexts/AuthContext";
import useSocket, { ConnectionState } from "../hooks/useSocket";
import useStatusChips from "../hooks/useStatusChips";
import Loader from "../components/Loader";
import Chat from "../components/Chat";
import RoleManager from "../components/RoleManager";
import TerminalUI from "../components/TerminalUI";
import ConnectionStatus from "../components/ConnectionStatus";
import StatusChip from "../components/StatusChip";
import { CopyToClipboard } from "react-copy-to-clipboard";
import { Check, Copy, Key, MoreVertical, Play, Loader2, FileCode, ChevronDown, Terminal as TerminalIcon, MessageSquare, X, LogOut, Download } from 'lucide-react';

const LANGUAGE_TEMPLATES = {
  python: "# New Python Session Started\n\n",
  javascript: "// New JavaScript Session Started\n\n",
  java: `public class Code {\n    public static void main(String[] args) {\n        // New Java Session Started. Do not change the template. Start coding from here.\n        \n\n    }\n}\n`,
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

  const {
    socket,
    isConnected,
    connectionState,
    error: connectionError,
    reconnectInfo,
    reconnect
  } = useSocket({ roomId: sessionId });

  const { currentUser } = useAuth();
  const { chips, addChip, removeChip } = useStatusChips();
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const debounceTimeoutRef = useRef(null);
  const presenceThrottleRef = useRef({ lastSent: 0, timer: null, pending: null });
  const presenceDecorationIdsRef = useRef([]);
  const editorDisposableRef = useRef([]);

  const [sessionState, setSessionState] = useState({
    code: "",
    language: "javascript",
    users: [],
    userRole: "editor",
    chatMessages: [],
    terminalController: null,
    ownerId: null,
    sessionTitle: "",
  });

  const [presenceState, setPresenceState] = useState({});

  const [uiState, setUiState] = useState({
    copiedSessionId: false,
    copiedPass: false,
    isLangSelectDropdownOpen: false,
    toggleRoleManagerDropdown: false,
  });

  const [loading, setLoading] = useState({
    isCodeRunning: false,
    isSessionEnding: false,
    requestingExecution: false,
  });

  const [permissionNotice, setPermissionNotice] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [executionRequest, setExecutionRequest] = useState(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [showTransferPicker, setShowTransferPicker] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [pendingNavigation, setPendingNavigation] = useState(null);

  const { code, language, users, userRole, chatMessages, terminalController, ownerId, sessionTitle } = sessionState;
  const { isCodeRunning, isSessionEnding, requestingExecution } = loading;
  const sessionPassword = location.state?.sessionPassword;

  const getFileName = useCallback((lang) => {
    if (lang === "python") return "Code.py";
    if (lang === "java") return "Code.java";
    return "Code.js";
  }, []);

  const fileName = getFileName(language);

  const getPresenceColorIndex = useCallback((id) => {
    if (!id) return 0;
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
      hash = (hash << 5) - hash + id.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % 6;
  }, []);

  const queuePresenceUpdate = useCallback((payload) => {
    if (!socket?.connected) return;
    const throttle = presenceThrottleRef.current;
    throttle.pending = { ...throttle.pending, ...payload };
    const now = Date.now();
    const delay = 80;

    if (now - throttle.lastSent >= delay) {
      const toSend = throttle.pending;
      throttle.pending = null;
      throttle.lastSent = now;
      socket.emit("presence-update", { sessionId, ...toSend });
      return;
    }

    if (!throttle.timer) {
      throttle.timer = setTimeout(() => {
        throttle.timer = null;
        if (!throttle.pending) return;
        const toSend = throttle.pending;
        throttle.pending = null;
        throttle.lastSent = Date.now();
        socket.emit("presence-update", { sessionId, ...toSend });
      }, delay - (now - throttle.lastSent));
    }
  }, [socket, sessionId]);

  // Socket event handlers
  useEffect(() => {
    if (!isConnected || !socket || !currentUser) return;

    const handleSessionData = ({
      code: initialCode,
      chat,
      role,
      language: initialLanguage,
      ownerId: sessionOwnerId,
      terminalController: controller,
      title: sessionTitle
    }) => {
      setSessionState((prev) => ({
        ...prev,
        code: initialCode || LANGUAGE_TEMPLATES[initialLanguage || prev.language],
        userRole: role,
        chatMessages: chat || [],
        language: initialLanguage || prev.language,
        terminalController: controller || null,
        ownerId: sessionOwnerId || null,
        sessionTitle: sessionTitle || '',
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

    const handleSessionEnded = () => {
      window.__codehive_leaving = true;
      navigate("/");
    };

    const handleOwnershipTransferred = ({ newOwnerId }) => {
      setSessionState((prev) => {
        const newRole = currentUser.uid === newOwnerId ? 'owner' : prev.userRole;
        return { ...prev, ownerId: newOwnerId, userRole: newRole };
      });
    };
    const handleExecutionComplete = () => setLoading((prev) => ({ ...prev, isCodeRunning: false }));
    const handleExecutionStarted = () => setLoading((prev) => ({ ...prev, requestingExecution: false, isCodeRunning: true }));
    const handleExecutionRequest = ({ requesterName, requesterSocketId }) => {
      setExecutionRequest({ requesterName, requesterSocketId });
    };
    const handleExecutionRejected = () => {
      setLoading((prev) => ({ ...prev, requestingExecution: false }));
      addChip('warning', 'Execution request was declined');
    };
    const handleTerminalControlChanged = ({ controller }) => {
      setSessionState((prev) => ({
        ...prev,
        terminalController: controller || null,
      }));
    };

    const handlePresenceState = ({ presence }) => {
      const map = {};
      (presence || []).forEach((item) => {
        if (item?.socketId) {
          map[item.socketId] = item;
        }
      });
      setPresenceState(map);
    };

    const handlePresenceUpdate = ({ presence }) => {
      if (!presence?.socketId) return;
      setPresenceState((prev) => ({
        ...prev,
        [presence.socketId]: presence,
      }));
    };

    const handlePresenceRemoved = ({ socketId }) => {
      if (!socketId) return;
      setPresenceState((prev) => {
        const next = { ...prev };
        delete next[socketId];
        return next;
      });
    };

    const handleSocketError = (payload) => {
      if (!payload || payload.code !== 'PERMISSION_DENIED') return;
      setPermissionNotice(payload.message || 'Action not allowed for your role.');
    };

    const handleTerminalError = (data) => {
      addChip('error', data?.message || 'Terminal error');
    };

    const handleTerminalClosed = () => {
      addChip('warning', 'Terminal session closed');
    };

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
    socket.on("execution-started", handleExecutionStarted);
    socket.on("execution-request", handleExecutionRequest);
    socket.on("execution-rejected", handleExecutionRejected);
    socket.on("terminal-control-changed", handleTerminalControlChanged);
    socket.on("ownership-transferred", handleOwnershipTransferred);
    socket.on("presence-state", handlePresenceState);
    socket.on("presence-update", handlePresenceUpdate);
    socket.on("presence-removed", handlePresenceRemoved);
    socket.on("error", handleSocketError);
    socket.on("terminal-error", handleTerminalError);
    socket.on("terminal-closed", handleTerminalClosed);

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
      socket.off("execution-started", handleExecutionStarted);
      socket.off("execution-request", handleExecutionRequest);
      socket.off("execution-rejected", handleExecutionRejected);
      socket.off("terminal-control-changed", handleTerminalControlChanged);
      socket.off("ownership-transferred", handleOwnershipTransferred);
      socket.off("presence-state", handlePresenceState);
      socket.off("presence-update", handlePresenceUpdate);
      socket.off("presence-removed", handlePresenceRemoved);
      socket.off("error", handleSocketError);
      socket.off("terminal-error", handleTerminalError);
      socket.off("terminal-closed", handleTerminalClosed);
    };
  }, [isConnected, socket, sessionId, currentUser, sessionPassword, navigate, addChip]);

  useEffect(() => {
    if (!socket?.connected) return;
    queuePresenceUpdate({ file: fileName });
  }, [socket, queuePresenceUpdate, fileName]);

  useEffect(() => {
    const throttle = presenceThrottleRef.current;
    return () => {
      if (throttle.timer) {
        clearTimeout(throttle.timer);
      }
    };
  }, []);

  useEffect(() => {
    if (!permissionNotice) return;
    const timer = setTimeout(() => setPermissionNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [permissionNotice]);

  // Connection error chip
  useEffect(() => {
    if (connectionState === ConnectionState.ERROR) {
      addChip('error', 'Execution server unavailable');
    }
  }, [connectionState, addChip]);

  // beforeunload warning
  useEffect(() => {
    const handler = (e) => {
      if (window.__codehive_leaving) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // popstate (browser back) interception
  useEffect(() => {
    const handler = () => {
      window.history.pushState(null, '', window.location.href);
      if (userRole === 'owner') {
        setShowEndModal(true);
      } else {
        setShowLeaveConfirm(true);
      }
    };
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [userRole]);

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
    if (userRole === "viewer") {
      setPermissionNotice("Viewers cannot change language");
      return;
    }
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
    if (userRole === "viewer") {
      setPermissionNotice("Viewers cannot run code");
      return;
    }
    const isOwner = ownerId === currentUser?.uid;
    if (!isOwner) {
      setLoading((prev) => ({ ...prev, requestingExecution: true }));
      socket.emit("execution-request", { sessionId });
      return;
    }
    setIsTerminalOpen(true);
    setLoading((prev) => ({ ...prev, isCodeRunning: true }));
    socket.emit("run-code", { sessionId, code, language });
  };

  const handleApproveExecution = () => {
    setExecutionRequest(null);
    setIsTerminalOpen(true);
    setLoading((prev) => ({ ...prev, isCodeRunning: true }));
    socket.emit("run-code", { sessionId, code, language });
  };

  const handleDeclineExecution = () => {
    if (executionRequest) {
      socket.emit("execution-decline", { sessionId, requesterSocketId: executionRequest.requesterSocketId });
    }
    setExecutionRequest(null);
  };

  const handleDownloadCode = () => {
    const extensions = { javascript: 'js', python: 'py', java: 'java' };
    const ext = extensions[language] || 'txt';
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `code.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleEndSession = () => {
    setLoading((prev) => ({ ...prev, isSessionEnding: true }));
    socket.emit("end-session", { sessionId, userId: currentUser.uid });
  };

  const handleLeaveSession = () => {
    window.__codehive_leaving = true;
    socket.emit("leave-session", sessionId);
    navigate("/");
  };

  const handleEndClick = () => {
    setShowEndModal(true);
  };

  const handleLeaveClick = () => {
    setShowLeaveConfirm(true);
  };

  const confirmEndForAll = () => {
    setShowEndModal(false);
    handleEndSession();
  };

  const handleTransferAndLeave = () => {
    setShowEndModal(false);
    setTransferTarget('');
    setShowTransferPicker(true);
  };

  const confirmTransfer = () => {
    if (!transferTarget) return;
    socket.emit("transfer-ownership", { sessionId, targetUserName: transferTarget });
    setShowTransferPicker(false);
    window.__codehive_leaving = true;
    socket.emit("leave-session", sessionId);
    navigate("/");
  };

  const confirmLeave = () => {
    setShowLeaveConfirm(false);
    handleLeaveSession();
  };

  const confirmNavigation = () => {
    const path = pendingNavigation;
    setPendingNavigation(null);
    if (userRole === 'owner') {
      handleEndSession();
    } else {
      handleLeaveSession();
    }
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
    fontSize: 14,
    fontFamily: "'Fira Code', monospace",
    fontLigatures: true,
    padding: { top: 16 },
    renderLineHighlight: 'gutter',
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
  };

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !currentUser) return;

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const decorations = [];

    Object.values(presenceState).forEach((presence) => {
      if (!presence?.socketId || !presence?.name) return;
      if (presence.userId === currentUser.uid || presence.name === currentUser.displayName) return;

      const colorIndex = getPresenceColorIndex(presence.socketId);
      const cursor = presence.cursor;
      const selection = presence.selection;

      if (selection && selection.startLineNumber && selection.endLineNumber) {
        const selectionRange = new monaco.Range(
          selection.startLineNumber,
          selection.startColumn,
          selection.endLineNumber,
          selection.endColumn
        );
        decorations.push({
          range: selectionRange,
          options: {
            className: `presence-selection presence-color-${colorIndex}`,
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
          }
        });
      }

      if (cursor && cursor.lineNumber && cursor.column) {
        const cursorRange = new monaco.Range(
          cursor.lineNumber,
          cursor.column,
          cursor.lineNumber,
          cursor.column + 1
        );
        decorations.push({
          range: cursorRange,
          options: {
            className: `presence-cursor presence-color-${colorIndex}`,
            hoverMessage: { value: presence.name },
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
          }
        });
      }
    });

    presenceDecorationIdsRef.current = editor.deltaDecorations(
      presenceDecorationIdsRef.current,
      decorations
    );
  }, [presenceState, currentUser, getPresenceColorIndex]);

  const presenceList = useMemo(() => {
    const list = Object.values(presenceState);
    const hasSelf = list.some((item) => item.userId === currentUser?.uid || item.name === currentUser?.displayName);

    if (!hasSelf && currentUser) {
      list.push({
        socketId: "local",
        userId: currentUser.uid,
        name: currentUser.displayName,
        role: userRole,
        file: fileName
      });
    }

    return list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [presenceState, currentUser, userRole, fileName]);

  if (!socket || connectionState === ConnectionState.CONNECTING || !currentUser) {
    return <Loader />;
  }

  return (
    <div className="sandbox">
      <StatusChip chips={chips} onClose={removeChip} />

      {/* Execution Request Modal (Owner Only) */}
      {executionRequest && (
        <div className="sandbox-overlay" onClick={handleDeclineExecution}>
          <div className="sandbox-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Execution Request</h3>
            <p>{executionRequest.requesterName} wants to run the code.</p>
            <div className="sandbox-modal-footer">
              <button className="sandbox-btn sandbox-btn--ghost" onClick={handleDeclineExecution}>Decline</button>
              <button className="sandbox-btn sandbox-btn--danger" onClick={handleApproveExecution}>Approve</button>
            </div>
          </div>
        </div>
      )}

      {/* Owner End Session Modal — two options */}
      {showEndModal && (
        <div className="sandbox-overlay" onClick={() => setShowEndModal(false)}>
          <div className="sandbox-modal" onClick={(e) => e.stopPropagation()}>
            <h3>End Session</h3>
            <p>What would you like to do?</p>
            <div className="sandbox-modal-footer">
              <button className="sandbox-btn sandbox-btn--ghost" onClick={() => setShowEndModal(false)}>Cancel</button>
              {users.length > 0 && (
                <button className="sandbox-btn sandbox-btn--ghost" onClick={handleTransferAndLeave}>Transfer & Leave</button>
              )}
              <button className="sandbox-btn sandbox-btn--danger" onClick={confirmEndForAll}>End for All</button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Ownership Picker */}
      {showTransferPicker && (
        <div className="sandbox-overlay" onClick={() => setShowTransferPicker(false)}>
          <div className="sandbox-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Transfer Ownership</h3>
            <p>Select the new owner:</p>
            <select
              className="sandbox-lang-btn"
              value={transferTarget}
              onChange={(e) => setTransferTarget(e.target.value)}
              style={{ width: '100%', marginBottom: 12 }}
            >
              <option value="">Select a member</option>
              {users.map((u) => (
                <option key={u.name} value={u.name}>{u.name}</option>
              ))}
            </select>
            <div className="sandbox-modal-footer">
              <button className="sandbox-btn sandbox-btn--ghost" onClick={() => setShowTransferPicker(false)}>Cancel</button>
              <button className="sandbox-btn sandbox-btn--danger" onClick={confirmTransfer} disabled={!transferTarget}>Transfer & Leave</button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Confirm Modal (non-owner) */}
      {showLeaveConfirm && (
        <div className="sandbox-overlay" onClick={() => setShowLeaveConfirm(false)}>
          <div className="sandbox-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Leave Session?</h3>
            <p>Are you sure you want to leave this session?</p>
            <div className="sandbox-modal-footer">
              <button className="sandbox-btn sandbox-btn--ghost" onClick={() => setShowLeaveConfirm(false)}>Cancel</button>
              <button className="sandbox-btn sandbox-btn--danger" onClick={confirmLeave}>Leave</button>
            </div>
          </div>
        </div>
      )}

      <ConnectionStatus
        connectionState={connectionState}
        reconnectInfo={reconnectInfo}
        error={connectionError}
        onRetry={reconnect}
      />

      {/* Toolbar */}
      <div className="sandbox-toolbar">
        {/* Session Info */}
        <div className="sandbox-session-info">
          {sessionTitle && <span className="sandbox-session-title" title={sessionTitle}>{sessionTitle}</span>}
          <span className="sandbox-session-id" title={sessionId}>{sessionId}</span>
          <CopyToClipboard text={sessionId} onCopy={() => handleCopy("copiedSessionId")}>
            <button className={`sandbox-copy-btn ${uiState.copiedSessionId ? 'sandbox-copy-btn--copied' : ''}`} title="Copy Session ID">
              {uiState.copiedSessionId ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </CopyToClipboard>
          <CopyToClipboard text={sessionPassword} onCopy={() => handleCopy("copiedPass")}>
            <button className={`sandbox-copy-btn ${uiState.copiedPass ? 'sandbox-copy-btn--copied' : ''}`} title="Copy Password">
              {uiState.copiedPass ? <Check size={13} /> : <Key size={13} />}
            </button>
          </CopyToClipboard>
        </div>

        <div className="sandbox-toolbar__divider" />

        {/* Users */}
        <div className="sandbox-users">
          {users.slice(0, 4).map((user) => {
            const colorIdx = getPresenceColorIndex(
              Object.values(presenceState).find(p => p.name === user.name)?.socketId || user.name
            );
            return (
              <div
                key={user.name}
                className={`sandbox-avatar presence-color-${colorIdx}`}
                title={user.name}
              >
                {user.name[0].toUpperCase()}
              </div>
            );
          })}
          {users.length > 0 && userRole === "owner" && (
            <button
              className="sandbox-manage-btn"
              onClick={() =>
                setUiState((prev) => ({
                  ...prev,
                  toggleRoleManagerDropdown: !prev.toggleRoleManagerDropdown,
                }))
              }
              title="Manage Users"
            >
              <MoreVertical size={13} />
            </button>
          )}
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

        <div className="sandbox-toolbar__divider" />

        {/* File + Language */}
        <div className="sandbox-toolbar__file">
          <FileCode size={15} className="sandbox-toolbar__file-icon" />
          <span className="sandbox-toolbar__filename">{fileName}</span>
        </div>

        <div className="sandbox-lang-wrapper">
          <button
            className="sandbox-lang-btn"
            onClick={() =>
              setUiState((prev) => ({
                ...prev,
                isLangSelectDropdownOpen: !prev.isLangSelectDropdownOpen,
              }))
            }
            disabled={true}
          >
            {toTitleCase(language)}
            <ChevronDown size={13} />
          </button>
          {uiState.isLangSelectDropdownOpen && (
            <div className="sandbox-dropdown">
              {langOptions.map((lang) => (
                <button
                  key={lang}
                  className={`sandbox-dropdown__item ${lang === language ? 'active' : ''}`}
                  onClick={() => handleLanguageChange(lang)}
                >
                  {toTitleCase(lang)}
                  {lang === language && <Check size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="sandbox-toolbar__spacer" />

        {/* Actions */}
        <button className="sandbox-run" onClick={handleRunCode} disabled={isCodeRunning || userRole === "viewer" || requestingExecution}>
          {isCodeRunning ? <Loader2 size={14} className="sandbox-spin" /> : requestingExecution ? <Loader2 size={14} className="sandbox-spin" /> : <Play size={14} />}
          <span>{isCodeRunning ? 'Running' : requestingExecution ? 'Requesting...' : 'Run'}</span>
        </button>

        <button className="sandbox-run" onClick={handleDownloadCode} title="Download Code">
          <Download size={14} />
          <span>Download</span>
        </button>

        {userRole === "owner" ? (
          <button className="sandbox-end" onClick={handleEndClick} disabled={isSessionEnding}>
            <X size={14} />
            <span>{isSessionEnding ? 'Ending...' : 'End'}</span>
          </button>
        ) : (
          <button className="sandbox-end" onClick={handleLeaveClick}>
            <LogOut size={14} />
            <span>Leave</span>
          </button>
        )}
      </div>

      {/* Presence Strip */}
      {presenceList.length > 0 && (
        <div className="sandbox-presence">
          {presenceList.map((presence) => {
            const presenceFile = presence.file || "Unknown";
            const colorIndex = getPresenceColorIndex(presence.socketId || presence.userId || presence.name);
            return (
              <span
                key={presence.socketId || presence.userId || presence.name}
                className={`sandbox-presence-pill presence-color-${colorIndex}`}
              >
                {presence.name}
                <span className="sandbox-presence-file">({presenceFile})</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Permission Notice */}
      {permissionNotice && (
        <div className="sandbox-permission-notice" role="status" aria-live="polite">
          {permissionNotice}
        </div>
      )}

      {/* Body: Editor | Terminal + Chat */}
      <Split
        sizes={[50, 50]}
        minSize={100}
        expandToMin={false}
        gutterSize={4}
        gutterAlign="center"
        direction="horizontal"
        cursor="col-resize"
        className="sandbox-split"
        style={{ flex: 1, minHeight: 0 }}
      >
        {/* Left: Editor */}
        <div className="sandbox-editor">
          <Editor
            width="100%"
            height="100%"
            language={language}
            value={code}
            onChange={handleEditorChange}
            theme="vs-dark"
            onMount={(editor, monaco) => {
              editorRef.current = editor;
              monacoRef.current = monaco;

              editorDisposableRef.current.forEach((disposable) => disposable.dispose());
              editorDisposableRef.current = [];

              editorDisposableRef.current.push(
                editor.onDidChangeCursorPosition((event) => {
                  queuePresenceUpdate({
                    cursor: {
                      lineNumber: event.position.lineNumber,
                      column: event.position.column
                    }
                  });
                })
              );

              editorDisposableRef.current.push(
                editor.onDidChangeCursorSelection((event) => {
                  const selection = event.selection;
                  if (!selection) return;
                  if (selection.isEmpty()) {
                    queuePresenceUpdate({ selection: null });
                    return;
                  }
                  const start = selection.getStartPosition
                    ? selection.getStartPosition()
                    : { lineNumber: selection.startLineNumber, column: selection.startColumn };
                  const end = selection.getEndPosition
                    ? selection.getEndPosition()
                    : { lineNumber: selection.endLineNumber, column: selection.endColumn };
                  queuePresenceUpdate({
                    selection: {
                      startLineNumber: start.lineNumber,
                      startColumn: start.column,
                      endLineNumber: end.lineNumber,
                      endColumn: end.column
                    }
                  });
                })
              );
            }}
            options={editorOptions}
          />
        </div>

        {/* Right: Terminal + Chat */}
        <div className="sandbox-right">
          <div className={`sandbox-terminal-wrapper ${!isTerminalOpen ? 'sandbox-terminal-wrapper--collapsed' : ''}`} style={isTerminalOpen ? (isChatOpen ? { height: '60%' } : { flex: 1 }) : {}}>
            <div className="sandbox-panel-header sandbox-panel-header--terminal" onClick={() => setIsTerminalOpen(!isTerminalOpen)}>
              <TerminalIcon size={13} />
              <span>Terminal</span>
              <div className="sandbox-panel-header__spacer" />
              <ChevronDown size={12} className={`sandbox-panel-header__toggle ${!isTerminalOpen ? 'collapsed' : ''}`} />
            </div>
            {isTerminalOpen && (
              <div className="sandbox-panel-content">
                <TerminalUI
                  socket={socket}
                  sessionId={sessionId}
                  currentUser={currentUser}
                  userRole={userRole}
                  users={users}
                  terminalController={terminalController}
                />
              </div>
            )}
          </div>

          <div className={`sandbox-chat-section ${isChatOpen ? (isTerminalOpen ? 'sandbox-chat-section--open' : 'sandbox-chat-section--expanded') : 'sandbox-chat-section--collapsed'}`}>
            <div className="sandbox-panel-header sandbox-panel-header--chat" onClick={() => setIsChatOpen(!isChatOpen)}>
              <MessageSquare size={13} />
              <span>Chat</span>
              <div className="sandbox-panel-header__spacer" />
              <ChevronDown size={12} className={`sandbox-panel-header__toggle ${!isChatOpen ? 'collapsed' : ''}`} />
            </div>
            {isChatOpen && (
              <Chat
                socket={socket}
                sessionId={sessionId}
                currentUser={currentUser}
                messages={chatMessages}
                onNewMessage={handleNewMessage}
              />
            )}
          </div>
        </div>
      </Split>

      {/* Status Bar */}
      <div className="sandbox-statusbar">
        <div className="sandbox-statusbar__left">
          <div className="sandbox-statusbar__item">
            <span className={`sandbox-statusbar__dot ${isConnected ? 'sandbox-statusbar__dot--on' : 'sandbox-statusbar__dot--off'}`} />
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <span className="sandbox-statusbar__item">{users.length + 1} user{users.length !== 0 ? 's' : ''}</span>
        </div>
        <div className="sandbox-statusbar__right">
          <span>{userRole}</span>
          <span>·</span>
          <span>{toTitleCase(language)}</span>
        </div>
      </div>
    </div>
  );
}
