/**
 * useSocket Hook - React hook for WebSocket connection management
 * 
 * Provides a clean interface to ConnectionManager for React components.
 * Automatically handles connection lifecycle tied to component mount/unmount.
 * 
 * @module useSocket
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import ConnectionManager, { ConnectionState } from '../utils/ConnectionManager';

/**
 * Hook for managing WebSocket connections in React components.
 * 
 * @param {Object} options - Hook options
 * @param {string} [options.roomId='default'] - Room identifier for connection isolation
 * @param {boolean} [options.autoConnect=true] - Whether to connect automatically on mount
 * 
 * @returns {Object} Socket connection state and methods
 * @returns {import('socket.io-client').Socket|null} return.socket - Socket.IO instance
 * @returns {boolean} return.isConnected - Whether currently connected (convenience property)
 * @returns {ConnectionState} return.connectionState - Explicit connection state enum
 * @returns {Error|null} return.error - Last error that occurred
 * @returns {Object|null} return.reconnectInfo - Info about ongoing reconnection
 * @returns {Function} return.reconnect - Manual reconnect trigger
 * @returns {Function} return.disconnect - Manual disconnect trigger
 * 
 * @example
 * function MyComponent() {
 *   const { 
 *     socket, 
 *     isConnected, 
 *     connectionState, 
 *     error,
 *     reconnect 
 *   } = useSocket({ roomId: 'session-123' });
 * 
 *   if (connectionState === ConnectionState.RECONNECTING) {
 *     return <div>Reconnecting...</div>;
 *   }
 * 
 *   if (error) {
 *     return <button onClick={reconnect}>Retry</button>;
 *   }
 * 
 *   return <div>Connected!</div>;
 * }
 */
export default function useSocket(options = {}) {
  const { roomId = 'default', autoConnect = true } = options;

  // ----------------------------------------------------------------------------
  // State
  // ----------------------------------------------------------------------------

  /** @type {[import('socket.io-client').Socket|null, Function]} */
  const [socket, setSocket] = useState(null);

  /** @type {[ConnectionState, Function]} */
  const [connectionState, setConnectionState] = useState(ConnectionState.DISCONNECTED);

  /** @type {[Error|null, Function]} */
  const [error, setError] = useState(null);

  /** @type {[Object|null, Function]} */
  const [reconnectInfo, setReconnectInfo] = useState(null);

  // Reference to prevent stale closure issues
  const managerRef = useRef(null);

  // ----------------------------------------------------------------------------
  // Connection Lifecycle
  // ----------------------------------------------------------------------------

  useEffect(() => {
    // Get or create connection manager for this room
    const manager = ConnectionManager.getInstance(roomId);
    managerRef.current = manager;

    // Subscribe to state changes
    const unsubscribeState = manager.on('stateChange', (newState, oldState) => {
      setConnectionState(newState);

      // Update socket reference when connected
      if (newState === ConnectionState.CONNECTED) {
        setSocket(manager.socket);
        setError(null);
        setReconnectInfo(null);
      } else if (newState === ConnectionState.DISCONNECTED) {
        setSocket(null);
        setReconnectInfo(null);
      } else if (newState === ConnectionState.ERROR) {
        setSocket(null);
      }
    });

    // Subscribe to errors
    const unsubscribeError = manager.on('error', (err) => {
      setError(err);
    });

    // Subscribe to reconnection attempts
    const unsubscribeReconnecting = manager.on('reconnecting', (info) => {
      setReconnectInfo(info);
    });

    // Connect automatically if configured
    if (autoConnect) {
      manager.connect().catch((err) => {
        // Error is already handled by the manager and will be
        // propagated through the 'error' event
        console.debug('[useSocket] Initial connection failed:', err.message);
      });
    }

    // Sync initial state
    setConnectionState(manager.state);
    setSocket(manager.socket);
    setError(manager.lastError);

    // Cleanup on unmount
    return () => {
      unsubscribeState();
      unsubscribeError();
      unsubscribeReconnecting();

      // Note: We don't destroy the manager on unmount because other
      // components might still be using it. The manager is only destroyed
      // when explicitly requested via ConnectionManager.destroyInstance()
    };
  }, [roomId, autoConnect]);

  // ----------------------------------------------------------------------------
  // Public Methods (memoized to prevent unnecessary re-renders)
  // ----------------------------------------------------------------------------

  /**
   * Manually trigger reconnection.
   * Resets attempt counter and tries to connect immediately.
   */
  const reconnect = useCallback(() => {
    managerRef.current?.reconnect();
  }, []);

  /**
   * Manually disconnect from the server.
   * Cancels any pending reconnection attempts.
   */
  const disconnect = useCallback(() => {
    managerRef.current?.disconnect();
  }, []);

  // ----------------------------------------------------------------------------
  // Return Value
  // ----------------------------------------------------------------------------

  return {
    // Socket instance (null when not connected)
    socket,

    // Convenience boolean for simple connected/not-connected checks
    // Maintains backward compatibility with original useSocket API
    isConnected: connectionState === ConnectionState.CONNECTED,

    // Explicit connection state for more granular UI handling
    connectionState,

    // Last error that occurred (null when no error)
    error,

    // Information about ongoing reconnection (null when not reconnecting)
    // Shape: { attempt: number, maxAttempts: number, delay: number }
    reconnectInfo,

    // Manual control methods
    reconnect,
    disconnect
  };
}

// Re-export ConnectionState for convenience
export { ConnectionState };