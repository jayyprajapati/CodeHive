import { useEffect, useState } from 'react';
import { connectSocket } from '../utils/socket';

export default function useSocket() {
    const [isConnected, setIsConnected] = useState(false);
    const [socket, setSocket] = useState(null);

  useEffect(() => {
    const s = connectSocket();
    s.connect();

    s.on('connect', () => {
      setIsConnected(true);
      setSocket(s);
    });

    s.on('disconnect', () => {
      setIsConnected(false);
    });

    return () => {
        s.off('connect');
        s.off('disconnect');
        s.disconnect();
    };
  }, []);

  return { socket, isConnected };
}