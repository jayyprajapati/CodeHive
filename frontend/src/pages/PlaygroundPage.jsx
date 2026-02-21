import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import Split from 'react-split';
import useSocket, { ConnectionState } from '../hooks/useSocket';
import TerminalUI from '../components/TerminalUI';
import StatusChip from '../components/StatusChip';
import useStatusChips from '../hooks/useStatusChips';
import { Play, Loader2, FileCode, ChevronDown, Check, Terminal, X, Download } from 'lucide-react';

const LANGUAGE_TEMPLATES = {
    javascript: '// Start coding here\nconsole.log("Hello, World!");\n',
    python: '# Start coding here\nprint("Hello, World!")\n',
    java: '// Start coding here\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n',
};

const EXTENSIONS = { javascript: 'js', python: 'py', java: 'java' };

const langOptions = Object.keys(LANGUAGE_TEMPLATES);
function toTitleCase(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

export default function PlaygroundPage() {
    const navigate = useNavigate();

    const [language, setLanguage] = useState('javascript');
    const [code, setCode] = useState(LANGUAGE_TEMPLATES.javascript);
    const [sessionId, setSessionId] = useState(null);
    const [isReady, setIsReady] = useState(false);
    const [showLangDropdown, setShowLangDropdown] = useState(false);
    const [showEndConfirm, setShowEndConfirm] = useState(false);
    const [pendingLanguage, setPendingLanguage] = useState(null);
    const [pendingNavigation, setPendingNavigation] = useState(null);
    const [isRunning, setIsRunning] = useState(false);
    const [runBlockMessage, setRunBlockMessage] = useState('');

    const { chips, addChip, removeChip } = useStatusChips();

    const {
        socket,
        isConnected,
        connectionState,
        error: socketError,
        reconnect,
    } = useSocket({ roomId: 'playground' });

    // Join playground
    useEffect(() => {
        if (!socket || !isConnected || isReady) return;

        const handlePlaygroundReady = (data) => {
            setSessionId(data.sessionId);
            setIsReady(true);
        };

        socket.on('playground-ready', handlePlaygroundReady);
        socket.emit('join-playground', { language });

        return () => {
            socket.off('playground-ready', handlePlaygroundReady);
        };
    }, [socket, isConnected, isReady, language]);

    // Error handling
    useEffect(() => {
        if (!socket) return;

        const handleTerminalError = (data) => {
            addChip('error', data?.message || 'Terminal error');
        };
        const handleTerminalClosed = () => {
            addChip('warning', 'Terminal session closed');
        };

        socket.on('terminal-error', handleTerminalError);
        socket.on('terminal-closed', handleTerminalClosed);

        return () => {
            socket.off('terminal-error', handleTerminalError);
            socket.off('terminal-closed', handleTerminalClosed);
        };
    }, [socket, addChip]);

    // Connection error chip
    useEffect(() => {
        if (connectionState === ConnectionState.ERROR) {
            const msg = 'Execution service unavailable';
            addChip('error', msg);
            setRunBlockMessage(msg);
            setIsRunning(false);
        } else if (connectionState === ConnectionState.RECONNECTING) {
            addChip('warning', 'Reconnecting to execution service...');
            setRunBlockMessage('Reconnecting to execution service...');
        } else if (connectionState === ConnectionState.CONNECTED && !socketError) {
            setRunBlockMessage('');
        }
    }, [connectionState, addChip, socketError]);

    useEffect(() => {
        if (!socketError) return;
        const msg = socketError.message || 'Execution service error';
        addChip('error', msg);
        setRunBlockMessage(msg);
        setIsRunning(false);
    }, [socketError, addChip]);

    // Execution complete listener
    useEffect(() => {
        if (!socket) return;
        const handle = () => setIsRunning(false);
        socket.on('execution-complete', handle);
        return () => socket.off('execution-complete', handle);
    }, [socket]);

    // beforeunload warning
    useEffect(() => {
        const handler = (e) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, []);

    const handleEditorChange = useCallback(
        (value) => {
            setCode(value || '');
            if (socket && sessionId) {
                socket.emit('code-change', { sessionId, code: value || '' });
            }
        },
        [socket, sessionId]
    );

    const handleLanguageChange = (newLang) => {
        setShowLangDropdown(false);
        if (code !== LANGUAGE_TEMPLATES[language] && code !== '') {
            setPendingLanguage(newLang);
        } else {
            applyLanguageChange(newLang);
        }
    };

    const applyLanguageChange = (newLang) => {
        setPendingLanguage(null);
        setLanguage(newLang);
        setCode(LANGUAGE_TEMPLATES[newLang]);
    };

    const handleDownloadCode = () => {
        const ext = EXTENSIONS[language] || 'txt';
        const blob = new Blob([code], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `main.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleRunCode = () => {
        if (!socket || !sessionId || runBlockMessage) return;
        setIsRunning(true);
        socket.emit('run-code', { sessionId, code, language });
    };

    const handleEndSession = () => {
        if (socket && sessionId) {
            socket.emit('terminal-shutdown', { sessionId });
        }
        navigate('/');
    };

    const handleEndClick = () => {
        setShowEndConfirm(true);
    };

    const handleNavigateAway = (path) => {
        setPendingNavigation(path);
    };

    const confirmNavigation = () => {
        const path = pendingNavigation;
        setPendingNavigation(null);
        if (socket && sessionId) {
            socket.emit('terminal-shutdown', { sessionId });
        }
        navigate(path);
    };

    const terminalNotReady = !isConnected || connectionState === ConnectionState.ERROR;
    const runDisabled = isRunning || terminalNotReady || !!runBlockMessage || !isReady;

    return (
        <div className="sandbox">
            <StatusChip chips={chips} onClose={removeChip} />

            {/* Language Switch Confirm Modal */}
            {pendingLanguage && (
                <div className="sandbox-overlay" onClick={() => setPendingLanguage(null)}>
                    <div className="sandbox-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Switch Language?</h3>
                        <p>Switching language will reset current code. Continue?</p>
                        <div className="sandbox-modal-footer">
                            <button className="sandbox-btn sandbox-btn--ghost" onClick={() => setPendingLanguage(null)}>Cancel</button>
                            <button className="sandbox-btn sandbox-btn--danger" onClick={() => applyLanguageChange(pendingLanguage)}>Switch</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Navigation Confirm Modal */}
            {pendingNavigation && (
                <div className="sandbox-overlay" onClick={() => setPendingNavigation(null)}>
                    <div className="sandbox-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Leave Playground?</h3>
                        <p>Your code and terminal output will be lost. This cannot be undone.</p>
                        <div className="sandbox-modal-footer">
                            <button className="sandbox-btn sandbox-btn--ghost" onClick={() => setPendingNavigation(null)}>Cancel</button>
                            <button className="sandbox-btn sandbox-btn--danger" onClick={confirmNavigation}>Leave</button>
                        </div>
                    </div>
                </div>
            )}

            {/* End Session Confirm Modal */}
            {showEndConfirm && (
                <div className="sandbox-overlay" onClick={() => setShowEndConfirm(false)}>
                    <div className="sandbox-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>End Session?</h3>
                        <p>Your code and terminal output will be lost. This cannot be undone.</p>
                        <div className="sandbox-modal-footer">
                            <button className="sandbox-btn sandbox-btn--ghost" onClick={() => setShowEndConfirm(false)}>Cancel</button>
                            <button className="sandbox-btn sandbox-btn--danger" onClick={handleEndSession}>End Session</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toolbar */}
            <div className="sandbox-toolbar">
                <div className="sandbox-toolbar__file">
                    <FileCode size={15} className="sandbox-toolbar__file-icon" />
                    <span className="sandbox-toolbar__filename">main.{EXTENSIONS[language]}</span>
                </div>

                <div className="sandbox-toolbar__divider" />

                <div className="sandbox-lang-wrapper">
                    <button className="sandbox-lang-btn" onClick={() => setShowLangDropdown(!showLangDropdown)} disabled={isRunning}>
                        {toTitleCase(language)}
                        <ChevronDown size={13} />
                    </button>
                    {showLangDropdown && (
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

                <button className="sandbox-run" onClick={handleRunCode} disabled={runDisabled}>
                    {isRunning ? <Loader2 size={14} className="sandbox-spin" /> : <Play size={14} />}
                    <span>{isRunning ? 'Running' : 'Run'}</span>
                </button>
                {runBlockMessage && (
                    <span className="sandbox-run-error">{runBlockMessage}</span>
                )}

                <button className="sandbox-run" onClick={handleDownloadCode} title="Download Code">
                    <Download size={14} />
                    <span>Download</span>
                </button>

                <button className="sandbox-end" onClick={handleEndClick}>
                    <X size={14} />
                    <span>End</span>
                </button>
            </div>

            {/* Body: Editor | Terminal */}
            <Split
                sizes={[55, 45]}
                minSize={200}
                gutterSize={4}
                direction="horizontal"
                cursor="col-resize"
                className="sandbox-split"
            >
                <div className="sandbox-editor">
                    <Editor
                        width="100%"
                        height="100%"
                        language={language}
                        value={code}
                        onChange={handleEditorChange}
                        theme="vs-dark"
                        options={{
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
                        }}
                    />
                </div>

                <div className="sandbox-terminal-wrapper">
                    <div className="sandbox-panel-header">
                        <Terminal size={13} />
                        <span>Terminal</span>
                    </div>
                    <div className="sandbox-panel-content">
                        <TerminalUI
                            socket={socket}
                            sessionId={sessionId}
                            currentUser={null}
                            userRole="owner"
                            users={[]}
                            terminalController={null}
                            sessionType="playground"
                        />
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
                </div>
                <div className="sandbox-statusbar__right">
                    <span>{toTitleCase(language)}</span>
                </div>
            </div>
        </div>
    );
}
