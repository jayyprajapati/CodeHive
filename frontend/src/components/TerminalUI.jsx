import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import PropTypes from "prop-types";
import 'xterm/css/xterm.css';

export default function TerminalUI({ socket, sessionId, isRunning }) {
  const terminalRef = useRef(null);
  const term = useRef();
  const fitAddon = useRef();

  useEffect(() => {
    term.current = new Terminal({
      theme: { background: '#1e1e1e', foreground: '#ffffff' },
      fontSize: 14,
      scrollback: 1000
    });
    
    fitAddon.current = new FitAddon();
    term.current.loadAddon(fitAddon.current);
    term.current.open(terminalRef.current);
    fitAddon.current.fit();

    const handleResize = () => {
      fitAddon.current.fit();
    };

    window.addEventListener('resize', handleResize);

    // Handle incoming output
    const outputHandler = (data) => {
      if (data.sessionId === sessionId) {
        const output = data.output.replace('\n', '\r\n');
        term.current.write(output);
      }
    };

    socket.on('terminal-output', outputHandler);

    // Cleanup
    return () => {
      socket.off('terminal-output', outputHandler);
      window.removeEventListener('resize', handleResize);
      term.current.dispose();
    };
  }, [sessionId, socket]);

  // Clear terminal on new execution
  useEffect(() => {
    if (!term.current) return;

    if (isRunning) {
      term.current.clear();
      term.current.write('\x1b[32m$ Running code...\x1b[0m\r\n\n');
    }
  }, [isRunning]);

  // const outputHandler = useCallback((data) => {
  //   if (data.sessionId === sessionId) {
  //     // Convert to CRLF for proper terminal formatting
  //     const output = data.output.replace('\n', '\r\n');
  //     term.current.write(output);
  //   }
  // }, [sessionId]);
  
  // useEffect(() => {
  //   if (!socket) return;
    
  //   socket.on('terminal-output', outputHandler);
  //   return () => socket.off('terminal-output', outputHandler);
  // }, [socket, outputHandler]);


  return <div ref={terminalRef} style={{ width: '100%' }} className='terminal-ui'/>;
}

TerminalUI.propTypes = {
  socket: PropTypes.object.isRequired,
  sessionId: PropTypes.string.isRequired,
  isRunning: PropTypes.bool.isRequired
};