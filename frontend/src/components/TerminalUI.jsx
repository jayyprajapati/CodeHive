import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import PropTypes from "prop-types";
import 'xterm/css/xterm.css';

export default function TerminalUI({ socket, sessionId }) {
  const terminalRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const resizeTimeout = useRef(null);

  // Initialize terminal once per session/socket
  useEffect(() => {
    if (!socket || !terminalRef.current) return;

    const term = new Terminal({
      theme: { background: '#1e1e1e', foreground: '#ffffff' },
      fontSize: 14,
      scrollback: 2000,
      convertEol: true,
      disableStdin: false,
      cursorBlink: true,
      allowProposedApi: true
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
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
        /* ignore */
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
    // Filter patterns for heredoc and execution commands
    const shellPatterns = [
      /^cat\s*>\s*\w+\.\w+\s*<</, // cat > file << 'EOF'
      /^>\s/,                     // heredoc continuation lines
      /^\$\s*(python|node|java)/, // $ python/node/java commands
      /^EOF_\d+$/,                // EOF delimiter
      /^\$\s*\[6n$/,              // ANSI cursor query in prompt
      /^\$\s*$/,                  // Empty prompt
    ];

    const isShellNoise = (line) => {
      const trimmed = line.trim();
      return shellPatterns.some(pattern => pattern.test(trimmed));
    };

    const filterOutput = (rawOutput) => {
      // Split by lines, filter, and rejoin
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
      socket.emit('terminal-input', { sessionId, input: chunk });
    });

    // Handle socket connect/disconnect for user visibility
    const handleConnect = () => {
      term.writeln('\r\n[server] Connected to terminal.');
      emitResize();
    };

    const handleDisconnect = () => {
      term.writeln('\r\n[server] Disconnected from terminal.');
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    // Cleanup on unmount or socket/session change
    return () => {
      socket.off('terminal-output', outputHandler);
      socket.off('terminal-closed', closedHandler);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      dataDisposable.dispose();
      window.removeEventListener('resize', handleWindowResize);
      if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
      if (termRef.current) {
        termRef.current.dispose();
      }
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [socket, sessionId]);



  return <div ref={terminalRef} style={{ width: '100%' }} className='terminal-ui' />;
}

TerminalUI.propTypes = {
  socket: PropTypes.object, // Can be null during reconnection
  sessionId: PropTypes.string.isRequired
};