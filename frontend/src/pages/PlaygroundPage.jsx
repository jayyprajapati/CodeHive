import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import Split from 'react-split';
import useSocket, { ConnectionState } from '../hooks/useSocket';
import TerminalUI from '../components/TerminalUI';
import StatusChip from '../components/StatusChip';
import useStatusChips from '../hooks/useStatusChips';
import { Play, Loader2, FileCode, ChevronDown, Check, Terminal, X } from 'lucide-react';

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
    const [isRunning, setIsRunning] = useState(false);

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
            addChip('error', 'Execution server unavailable');
        }
    }, [connectionState, addChip]);

    // Execution complete listener
    useEffect(() => {
        if (!socket) return;
        const handle = () => setIsRunning(false);
        socket.on('execution-complete', handle);
        return () => socket.off('execution-complete', handle);
    }, [socket]);

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
        setLanguage(newLang);
        setCode(LANGUAGE_TEMPLATES[newLang]);
    };

    const handleRunCode = () => {
        if (!socket || !sessionId) return;
        setIsRunning(true);
        socket.emit('run-code', { sessionId, code, language });
    };

    const handleEndSession = () => {
        if (socket && sessionId) {
            socket.emit('terminal-shutdown', { sessionId });
        }
        navigate('/');
    };

    const terminalNotReady = !isConnected || connectionState === ConnectionState.ERROR;

    return (
        <div className="sandbox">
            <StatusChip chips={chips} onClose={removeChip} />

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
                    <button className="sandbox-lang-btn" onClick={() => setShowLangDropdown(!showLangDropdown)}>
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

                <button className="sandbox-run" onClick={handleRunCode} disabled={isRunning || terminalNotReady}>
                    {isRunning ? <Loader2 size={14} className="sandbox-spin" /> : <Play size={14} />}
                    <span>{isRunning ? 'Running' : 'Run'}</span>
                </button>

                <button className="sandbox-end" onClick={() => setShowEndConfirm(true)}>
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
