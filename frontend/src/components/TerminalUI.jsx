import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import PropTypes from "prop-types";
import 'xterm/css/xterm.css';

const TERMINAL_ERROR_CODES = new Set([
  'TERMINAL_CONTROL_REQUIRED',
  'TERMINAL_CONTROL_FORBIDDEN',
  'TERMINAL_CONTROL_BUSY',
  'STDIN_TOO_LARGE'
]);

export default function TerminalUI({
  socket,
  sessionId,
  currentUser,
  userRole,
  users,
  terminalController,
  sessionType = 'collaborative'
}) {
  const terminalRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const resizeTimeout = useRef(null);
  const lastControlState = useRef(null);
  const inputEnabledRef = useRef(false);
  const controllerNameRef = useRef('');

  const [controlNotice, setControlNotice] = useState('');
  const [transferTarget, setTransferTarget] = useState('');

  const isPlayground = sessionType === 'playground';

  // --- Derived state: playground always has full control ---
  const controllerName = isPlayground ? 'You' : (terminalController?.name || 'Unclaimed');
  const canControl = isPlayground || userRole === 'owner' || userRole === 'editor';
  const isController = isPlayground || (terminalController?.userId
    ? terminalController.userId === currentUser?.uid
    : terminalController?.name === currentUser?.displayName);
  const isInputEnabled = isPlayground || (canControl && (!terminalController || isController));
  const isOwner = isPlayground || userRole === 'owner';

  const eligibleUsers = useMemo(
    () => (isPlayground ? [] : users.filter((user) => user.role !== 'viewer')),
    [users, isPlayground]
  );

  useEffect(() => {
    inputEnabledRef.current = isInputEnabled;
    controllerNameRef.current = controllerName;
  }, [isInputEnabled, controllerName]);

  // Initialize terminal once per session/socket
  useEffect(() => {
    if (!socket || !terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#09090B',
        foreground: '#E4E4E7',
        cursor: '#06B6D4',
        cursorAccent: '#09090B',
        selectionBackground: '#27272A',
        selectionForeground: '#FAFAFA',
      },
      fontFamily: "'Fira Code', monospace",
      fontSize: 13,
      scrollback: 2000,
      convertEol: true,
      disableStdin: false,
      cursorBlink: true,
      allowProposedApi: true
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    // Defer fit so the container has layout dimensions
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* container may lack dimensions */ }
    });
    term.focus();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Emit initial size
    const emitResize = () => {
      try {
        fitAddon.fit();
        const cols = term.cols;
        const rows = term.rows;
        if (socket?.connected) {
          socket.emit('terminal-resize', { sessionId, cols, rows });
        }
      } catch (_) {
        console.warn('Terminal resize failed: ' + _);
      }
    };

    emitResize();

    const handleWindowResize = () => {
      if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
      resizeTimeout.current = setTimeout(emitResize, 50);
    };

    window.addEventListener('resize', handleWindowResize);

    // Incoming output stream with filtering to hide shell commands
    const shellPatterns = [
      /^cat\s*>\s*\w+\.\w+\s*<</,   // cat > file << 'EOF'
      /^\$\s*cat\s*>\s*\w+\.\w+/,   // $ cat > file (prompted)
      /^>\s/,                        // heredoc continuation lines
      /^\$\s*(python|node|java)/,    // $ python/node/java commands
      /^EOF_\d+$/,                   // EOF delimiter
      /^\$\s*\[6n$/,                 // ANSI cursor query in prompt
      /__EXEC_DONE_\d+__/,           // execution sentinel marker
      /^\{"stream":true/,            // Docker attach header leak
      /^\$\s*;?\s*echo\s+"__EXEC/,   // echo sentinel command
    ];

    const isShellNoise = (line) => {
      const trimmed = line.trim();
      return shellPatterns.some(pattern => pattern.test(trimmed));
    };

    const filterOutput = (rawOutput) => {
      const lines = rawOutput.split(/\r?\n/);
      const filtered = lines.filter(line => !isShellNoise(line));
      return filtered.join('\n');
    };

    const outputHandler = (data) => {
      if (!data || data.sessionId !== sessionId) return;
      const filtered = filterOutput(data.output);
      if (filtered.trim() || filtered.includes('\n')) {
        term.write(filtered.replace(/\n/g, '\r\n'));
      }
    };

    const closedHandler = (data) => {
      if (data?.sessionId !== sessionId) return;
      term.writeln(`\r\n[server] Terminal closed: ${data.reason || 'unknown'}`);
    };

    socket.on('terminal-output', outputHandler);
    socket.on('terminal-closed', closedHandler);

    // Forward keystrokes (includes paste)
    const dataDisposable = term.onData((chunk) => {
      if (!socket?.connected) {
        term.writeln('\r\n[server] Disconnected. Input not sent.');
        return;
      }
      // Playground: always allow input
      if (!isPlayground && !inputEnabledRef.current) {
        term.writeln(`\r\n[server] Input locked. Controller: ${controllerNameRef.current}.`);
        return;
      }
      socket.emit('terminal-input', { sessionId, input: chunk });
    });

    // Handle socket connect/disconnect
    const handleConnect = () => {
      term.writeln('\r\n[server] Connected to terminal.');
      emitResize();
    };

    const handleDisconnect = () => {
      term.writeln('\r\n[server] Disconnected from terminal.');
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    const handleSocketError = (payload) => {
      if (!payload || !TERMINAL_ERROR_CODES.has(payload.code)) return;
      const message = payload.message || 'Terminal input rejected.';
      setControlNotice(message);
      term.writeln(`\r\n[server] ${message}`);
    };

    socket.on('error', handleSocketError);

    // Cleanup
    return () => {
      socket.off('terminal-output', outputHandler);
      socket.off('terminal-closed', closedHandler);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('error', handleSocketError);
      dataDisposable.dispose();
      window.removeEventListener('resize', handleWindowResize);
      if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
      if (termRef.current) {
        termRef.current.dispose();
      }
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [socket, sessionId, isPlayground]);

  // Control state messaging (collaborative only)
  useEffect(() => {
    if (isPlayground || !termRef.current) return;

    termRef.current.options.disableStdin = !isInputEnabled;

    const nextState = isInputEnabled ? 'enabled' : 'disabled';
    if (lastControlState.current !== nextState) {
      lastControlState.current = nextState;
      if (!isInputEnabled) {
        termRef.current.writeln(`\r\n[server] Input disabled. Controller: ${controllerName}.`);
      } else {
        termRef.current.writeln(`\r\n[server] Input enabled.`);
      }
    }
  }, [isInputEnabled, controllerName, isPlayground]);

  useEffect(() => {
    if (!controlNotice) return;
    const timeout = setTimeout(() => setControlNotice(''), 3000);
    return () => clearTimeout(timeout);
  }, [controlNotice]);

  const handleTransfer = () => {
    if (!transferTarget || !socket?.connected) return;
    socket.emit('terminal-transfer-control', {
      sessionId,
      targetUser: transferTarget
    });
    setTransferTarget('');
  };

  const handleRequestControl = () => {
    if (!socket?.connected) return;
    socket.emit('terminal-request-control', { sessionId });
  };

  return (
    <div className="terminal-panel">
      {/* Collaborative only: control bar */}
      {!isPlayground && (
        <div className="terminal-control-bar">
          <div className="terminal-control-status">
            <span className="terminal-control-label">Controller:</span>
            <span className={`terminal-control-name ${isController ? 'is-controller' : ''}`}>
              {controllerName}
            </span>
            {!isInputEnabled && (
              <span className="terminal-control-note">Input disabled</span>
            )}
          </div>
          {isOwner && eligibleUsers.length > 0 && (
            <div className="terminal-control-transfer">
              <select
                className="terminal-control-select"
                value={transferTarget}
                onChange={(event) => setTransferTarget(event.target.value)}
              >
                <option value="">Transfer control...</option>
                {eligibleUsers.map((user) => (
                  <option key={user.name} value={user.name}>
                    {user.name} ({user.role})
                  </option>
                ))}
              </select>
              <button
                className="terminal-control-button"
                onClick={handleTransfer}
                disabled={!transferTarget}
              >
                Transfer
              </button>
            </div>
          )}
          {!isOwner && canControl && !isController && (
            <button
              className="terminal-control-button"
              onClick={handleRequestControl}
              disabled={!!terminalController}
            >
              Request control
            </button>
          )}
        </div>
      )}
      {!isPlayground && controlNotice && (
        <div className="terminal-control-alert" role="status" aria-live="polite">
          {controlNotice}
        </div>
      )}
      <div ref={terminalRef} style={{ width: '100%' }} className='terminal-ui' />
    </div>
  );
}

TerminalUI.propTypes = {
  socket: PropTypes.object,
  sessionId: PropTypes.string,
  currentUser: PropTypes.object,
  userRole: PropTypes.string,
  users: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string.isRequired,
      role: PropTypes.string.isRequired
    })
  ),
  terminalController: PropTypes.shape({
    name: PropTypes.string,
    userId: PropTypes.string,
    socketId: PropTypes.string
  }),
  sessionType: PropTypes.oneOf(['playground', 'collaborative'])
};

TerminalUI.defaultProps = {
  sessionType: 'collaborative',
  users: [],
  userRole: 'editor'
};