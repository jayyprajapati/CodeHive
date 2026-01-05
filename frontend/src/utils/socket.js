/**
 * Socket Utilities
 * 
 * @deprecated Use ConnectionManager for new code.
 * This module is kept for backward compatibility.
 * 
 * @module socket
 */

import { io } from 'socket.io-client';
import ConnectionManager from './ConnectionManager';

const URL = import.meta.env.VITE_WEBSOCKET_URL;

/**
 * Legacy socket instance.
 * @deprecated Use ConnectionManager.getInstance() instead.
 * @type {import('socket.io-client').Socket|null}
 */
let socket = null;

/**
 * Create and return a new socket connection.
 * 
 * @deprecated Use ConnectionManager.getInstance(roomId).connect() instead.
 * This function creates a new socket instance each time it's called,
 * which can lead to multiple connections. ConnectionManager ensures
 * a single connection per room.
 * 
 * @returns {import('socket.io-client').Socket} Socket.IO client instance
 * 
 * @example
 * // Old pattern (deprecated):
 * import { connectSocket } from './socket';
 * const socket = connectSocket();
 * 
 * // New pattern (recommended):
 * import ConnectionManager from './ConnectionManager';
 * const manager = ConnectionManager.getInstance('room-id');
 * await manager.connect();
 * const socket = manager.socket;
 */
export const connectSocket = () => {
  console.warn(
    '[socket.js] connectSocket() is deprecated. ' +
    'Use ConnectionManager.getInstance() instead.'
  );

  socket = io(URL, {
    withCredentials: true,
    transports: ["websocket"],
    autoConnect: false
  });
  return socket;
};

/**
 * Get the current socket instance.
 * 
 * @deprecated Use ConnectionManager.getInstance(roomId).socket instead.
 * 
 * @returns {import('socket.io-client').Socket|null} Current socket or null
 */
export const getSocket = () => {
  console.warn(
    '[socket.js] getSocket() is deprecated. ' +
    'Use ConnectionManager.getInstance().socket instead.'
  );
  return socket;
};

// Re-export ConnectionManager for easy migration
export { ConnectionManager };