/**
 * ConnectionManager - WebSocket Connection State Machine
 * 
 * Manages a single WebSocket connection per room with explicit states and
 * exponential backoff reconnection logic.
 * 
 * State Machine:
 * ┌─────────────────────────────────────────────────────────────┐
 * │  DISCONNECTED ──► CONNECTING ──► CONNECTED                  │
 * │       ▲               │              │                      │
 * │       │               ▼              ▼                      │
 * │       └────────── ERROR ◄──── RECONNECTING                 │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * @module ConnectionManager
 */

import { io } from 'socket.io-client';

// ============================================================================
// Connection States
// ============================================================================

/**
 * Enum of possible connection states.
 * @readonly
 * @enum {string}
 */
export const ConnectionState = Object.freeze({
  /** Initial state, not connected */
  DISCONNECTED: 'DISCONNECTED',
  /** Attempting initial connection */
  CONNECTING: 'CONNECTING',
  /** Successfully connected */
  CONNECTED: 'CONNECTED',
  /** Lost connection, attempting to reconnect */
  RECONNECTING: 'RECONNECTING',
  /** Connection failed after all retry attempts */
  ERROR: 'ERROR'
});

// ============================================================================
// Configuration
// ============================================================================

/**
 * Default reconnection configuration.
 * Uses exponential backoff: delay = min(baseDelay * 2^attempt, maxDelay)
 */
const DEFAULT_CONFIG = {
  /** Base delay in milliseconds for first retry */
  baseDelay: 1000,
  /** Maximum delay between retries in milliseconds */
  maxDelay: 30000,
  /** Maximum number of reconnection attempts before giving up */
  maxAttempts: 10,
  /** Jitter factor (0-1) to add randomness to delays */
  jitterFactor: 0.1
};

// ============================================================================
// ConnectionManager Class
// ============================================================================

/**
 * Manages WebSocket connections with explicit state tracking and reconnection.
 * 
 * @example
 * const manager = ConnectionManager.getInstance('room-123');
 * manager.on('stateChange', (newState, oldState) => {
 *   console.log(`State changed: ${oldState} → ${newState}`);
 * });
 * manager.connect();
 */
class ConnectionManager {
  /**
   * Singleton instances per room.
   * @type {Map<string, ConnectionManager>}
   * @private
   */
  static _instances = new Map();

  /**
   * Get or create a ConnectionManager instance for a specific room.
   * Ensures only one connection exists per room.
   * 
   * @param {string} roomId - Unique room identifier
   * @param {Object} [config] - Optional configuration overrides
   * @returns {ConnectionManager} The connection manager instance
   */
  static getInstance(roomId = 'default', config = {}) {
    if (!this._instances.has(roomId)) {
      this._instances.set(roomId, new ConnectionManager(roomId, config));
    }
    return this._instances.get(roomId);
  }

  /**
   * Destroy a connection manager instance and cleanup resources.
   * 
   * @param {string} roomId - Room identifier to destroy
   */
  static destroyInstance(roomId = 'default') {
    const instance = this._instances.get(roomId);
    if (instance) {
      instance.disconnect();
      instance._cleanup();
      this._instances.delete(roomId);
      this._log('info', 'room', `Instance destroyed for room: ${roomId}`);
    }
  }

  /**
   * Destroy all connection manager instances.
   */
  static destroyAll() {
    for (const [roomId] of this._instances) {
      this.destroyInstance(roomId);
    }
  }

  /**
   * Structured logging utility.
   * @private
   */
  static _log(level, category, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      category: `[ConnectionManager:${category}]`,
      message,
      ...data
    };
    
    const formatted = `${timestamp} ${logEntry.category} ${message}`;
    
    switch (level) {
      case 'error':
        console.error(formatted, data);
        break;
      case 'warn':
        console.warn(formatted, data);
        break;
      case 'debug':
        if (import.meta.env?.DEV) {
          console.debug(formatted, data);
        }
        break;
      default:
        console.log(formatted, Object.keys(data).length > 0 ? data : '');
    }
  }

  // --------------------------------------------------------------------------
  // Instance Properties
  // --------------------------------------------------------------------------

  /**
   * @param {string} roomId - Room identifier
   * @param {Object} config - Configuration options
   * @private
   */
  constructor(roomId, config = {}) {
    /** @type {string} */
    this._roomId = roomId;
    
    /** @type {Object} */
    this._config = { ...DEFAULT_CONFIG, ...config };
    
    /** @type {ConnectionState} */
    this._state = ConnectionState.DISCONNECTED;
    
    /** @type {import('socket.io-client').Socket|null} */
    this._socket = null;
    
    /** @type {number} */
    this._reconnectAttempts = 0;
    
    /** @type {number|null} */
    this._reconnectTimer = null;
    
    /** @type {Error|null} */
    this._lastError = null;
    
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    
    /** @type {string} */
    this._url = import.meta.env?.VITE_WEBSOCKET_URL || 'http://localhost:8000';

    ConnectionManager._log('debug', 'init', `Created manager for room: ${roomId}`);
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Get current connection state.
   * @returns {ConnectionState}
   */
  get state() {
    return this._state;
  }

  /**
   * Get the underlying socket instance.
   * @returns {import('socket.io-client').Socket|null}
   */
  get socket() {
    return this._socket;
  }

  /**
   * Check if currently connected.
   * @returns {boolean}
   */
  get isConnected() {
    return this._state === ConnectionState.CONNECTED;
  }

  /**
   * Get the last error that occurred.
   * @returns {Error|null}
   */
  get lastError() {
    return this._lastError;
  }

  /**
   * Get current reconnection attempt count.
   * @returns {number}
   */
  get reconnectAttempts() {
    return this._reconnectAttempts;
  }

  /**
   * Initiate connection to the WebSocket server.
   * If already connected or connecting, this is a no-op.
   * 
   * @returns {Promise<void>} Resolves when connected, rejects on error
   */
  connect() {
    // Prevent duplicate connection attempts
    if (this._state === ConnectionState.CONNECTING || 
        this._state === ConnectionState.CONNECTED) {
      ConnectionManager._log('debug', 'connect', 'Already connected or connecting');
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this._setState(ConnectionState.CONNECTING);
      this._lastError = null;

      try {
        // Create socket with explicit transport and auto-connect disabled initially
        this._socket = io(this._url, {
          withCredentials: true,
          transports: ['websocket'],
          autoConnect: false,
          // Disable built-in reconnection - we handle it ourselves
          reconnection: false
        });

        this._setupSocketListeners(resolve, reject);
        this._socket.connect();
        
        ConnectionManager._log('info', 'connect', `Connecting to ${this._url}`);
      } catch (error) {
        this._handleError(error);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server.
   * Cancels any pending reconnection attempts.
   */
  disconnect() {
    this._cancelReconnect();
    
    if (this._socket) {
      this._socket.removeAllListeners();
      this._socket.disconnect();
      this._socket = null;
    }
    
    this._setState(ConnectionState.DISCONNECTED);
    this._reconnectAttempts = 0;
    this._lastError = null;
    
    ConnectionManager._log('info', 'disconnect', 'Disconnected');
  }

  /**
   * Manually trigger a reconnection attempt.
   * Useful for "Retry" button in UI.
   */
  reconnect() {
    ConnectionManager._log('info', 'reconnect', 'Manual reconnect triggered');
    this._reconnectAttempts = 0;
    this._lastError = null;
    this._attemptReconnect();
  }

  /**
   * Subscribe to events.
   * 
   * @param {string} event - Event name ('stateChange', 'error', 'reconnecting')
   * @param {Function} callback - Event handler
   * @returns {Function} Unsubscribe function
   * 
   * @example
   * const unsubscribe = manager.on('stateChange', (newState, oldState) => {});
   * // Later: unsubscribe();
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);

    // Return unsubscribe function
    return () => {
      this._listeners.get(event)?.delete(callback);
    };
  }

  /**
   * Emit an event to the server.
   * Wraps socket.emit with connection state checking and error handling.
   * 
   * @param {string} event - Event name
   * @param {...any} args - Event arguments
   * @returns {boolean} True if event was emitted, false if not connected
   */
  emit(event, ...args) {
    if (!this._socket || !this.isConnected) {
      ConnectionManager._log('warn', 'emit', `Cannot emit '${event}': not connected`);
      return false;
    }

    try {
      this._socket.emit(event, ...args);
      return true;
    } catch (error) {
      ConnectionManager._log('error', 'emit', `Error emitting '${event}'`, { error });
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  /**
   * Set up socket event listeners.
   * @private
   */
  _setupSocketListeners(resolveConnect, rejectConnect) {
    if (!this._socket) return;

    // Connection successful
    this._socket.on('connect', () => {
      ConnectionManager._log('info', 'socket', 'Connected successfully', {
        socketId: this._socket?.id
      });
      
      this._reconnectAttempts = 0;
      this._lastError = null;
      this._setState(ConnectionState.CONNECTED);
      resolveConnect?.();
    });

    // Connection error (during initial connect)
    this._socket.on('connect_error', (error) => {
      ConnectionManager._log('error', 'socket', 'Connection error', { 
        message: error.message 
      });
      
      this._lastError = error;
      
      // If this was initial connect, reject the promise
      if (this._state === ConnectionState.CONNECTING) {
        this._handleError(error);
        rejectConnect?.(error);
      } else {
        // Otherwise attempt reconnect
        this._attemptReconnect();
      }
    });

    // Disconnected
    this._socket.on('disconnect', (reason) => {
      ConnectionManager._log('warn', 'socket', `Disconnected: ${reason}`);
      
      // If server deliberately disconnected us, don't reconnect
      if (reason === 'io server disconnect') {
        this._setState(ConnectionState.DISCONNECTED);
        return;
      }
      
      // For other disconnection reasons, attempt reconnect
      this._attemptReconnect();
    });

    // Server-sent errors
    this._socket.on('error', (error) => {
      ConnectionManager._log('error', 'socket', 'Server error', { error });
      this._lastError = typeof error === 'string' ? new Error(error) : error;
      this._emit('error', this._lastError);
    });
  }

  /**
   * Update connection state and notify listeners.
   * @private
   */
  _setState(newState) {
    if (this._state === newState) return;
    
    const oldState = this._state;
    this._state = newState;
    
    ConnectionManager._log('info', 'state', `${oldState} → ${newState}`);
    this._emit('stateChange', newState, oldState);
  }

  /**
   * Emit event to internal listeners.
   * @private
   */
  _emit(event, ...args) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(...args);
        } catch (error) {
          ConnectionManager._log('error', 'listener', 
            `Error in ${event} listener`, { error });
        }
      });
    }
  }

  /**
   * Handle connection error and transition to ERROR state.
   * @private
   */
  _handleError(error) {
    this._lastError = error;
    this._setState(ConnectionState.ERROR);
    this._emit('error', error);
  }

  /**
   * Attempt reconnection with exponential backoff.
   * @private
   */
  _attemptReconnect() {
    // Don't reconnect if already reconnecting or at max attempts
    if (this._reconnectTimer) return;
    
    if (this._reconnectAttempts >= this._config.maxAttempts) {
      ConnectionManager._log('error', 'reconnect', 
        `Max reconnection attempts (${this._config.maxAttempts}) reached`);
      this._handleError(new Error('Max reconnection attempts reached'));
      return;
    }

    this._setState(ConnectionState.RECONNECTING);
    this._reconnectAttempts++;

    // Calculate delay with exponential backoff and jitter
    const exponentialDelay = Math.min(
      this._config.baseDelay * Math.pow(2, this._reconnectAttempts - 1),
      this._config.maxDelay
    );
    const jitter = exponentialDelay * this._config.jitterFactor * Math.random();
    const delay = Math.floor(exponentialDelay + jitter);

    ConnectionManager._log('info', 'reconnect', 
      `Attempt ${this._reconnectAttempts}/${this._config.maxAttempts} in ${delay}ms`);
    
    this._emit('reconnecting', {
      attempt: this._reconnectAttempts,
      maxAttempts: this._config.maxAttempts,
      delay
    });

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      
      // Disconnect existing socket before reconnecting
      if (this._socket) {
        this._socket.removeAllListeners();
        this._socket.disconnect();
        this._socket = null;
      }
      
      // Attempt new connection
      this.connect().catch(() => {
        // Error handling is done in connect(), this just prevents
        // unhandled promise rejection
      });
    }, delay);
  }

  /**
   * Cancel pending reconnection attempt.
   * @private
   */
  _cancelReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  /**
   * Cleanup all resources.
   * @private
   */
  _cleanup() {
    this._listeners.clear();
    this._socket = null;
    this._lastError = null;
  }
}

export default ConnectionManager;
