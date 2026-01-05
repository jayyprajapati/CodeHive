import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_WEBSOCKET_URL;
let socket;

export const connectSocket = () => {
  socket = io(URL, {
    withCredentials: true,
    transports: ["websocket"],
    autoConnect: false
  });
  return socket;
};

export const getSocket = () => socket;