import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import Split from 'react-split';
import useSocket, { ConnectionState } from '../hooks/useSocket';
import TerminalUI from '../components/TerminalUI';
import StatusChip from '../components/StatusChip';
import useStatusChips from '../hooks/useStatusChips';
import Button from '../components/Button';

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
        <div className="playground-container">
            <StatusChip chips={chips} onClose={removeChip} />

            {/* End Session Confirm Modal */}
            {showEndConfirm && (
                <div className="modal-overlay" onClick={() => setShowEndConfirm(false)}>
                    <div className="modal-box" onClick={(e) => e.stopPropagation()}>
                        <h3 className="modal-title">End Session?</h3>
                        <p className="modal-message">
                            All current work will be lost. This action cannot be undone.
                        </p>
                        <div className="modal-actions">
                            <Button variant="secondary" size="small" onClick={() => setShowEndConfirm(false)}>
                                Cancel
                            </Button>
                            <Button variant="error" size="small" onClick={handleEndSession}>
                                End Session
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Top bar */}
            <div className="playground-header">
                <div className="playground-header-left">
                    <span className="playground-file-name">
                        main.{EXTENSIONS[language]}
                    </span>

                    <div className="lang-select-wrapper">
                        <button
                            className="lang-select"
                            onClick={() => setShowLangDropdown(!showLangDropdown)}
                        >
                            {toTitleCase(language)} ↓
                        </button>
                        {showLangDropdown && (
                            <div className="lang-select-dropdown">
                                {langOptions.map((lang) => (
                                    <div
                                        className="lang-select-option"
                                        key={lang}
                                        onClick={() => handleLanguageChange(lang)}
                                    >
                                        <span style={{ visibility: lang === language ? 'visible' : 'hidden' }}>✓</span>
                                        {toTitleCase(lang)}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="playground-header-right">
                    <button
                        className="run-button"
                        onClick={handleRunCode}
                        disabled={isRunning || terminalNotReady}
                    >
                        {isRunning ? 'Running...' : 'Run'}
                    </button>
                    <Button variant="error" size="small" onClick={() => setShowEndConfirm(true)}>
                        End Session
                    </Button>
                </div>
            </div>

            {/* Split: Editor | Terminal */}
            <Split
                sizes={[55, 45]}
                minSize={200}
                gutterSize={6}
                direction="horizontal"
                cursor="col-resize"
                className="playground-split"
            >
                <div className="playground-editor-panel">
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
                        }}
                    />
                </div>
                <div className="playground-terminal-panel">
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
            </Split>
        </div>
    );
}
