import { useState, useCallback, useRef } from 'react';

let chipIdCounter = 0;

/**
 * Hook for managing status chips (success/warning/error notifications).
 * Chips auto-dismiss after timeout and can be manually closed.
 */
export default function useStatusChips(timeout = 5000) {
    const [chips, setChips] = useState([]);
    const timersRef = useRef({});

    const removeChip = useCallback((id) => {
        setChips((prev) => prev.filter((c) => c.id !== id));
        if (timersRef.current[id]) {
            clearTimeout(timersRef.current[id]);
            delete timersRef.current[id];
        }
    }, []);

    const addChip = useCallback((type, message) => {
        const id = ++chipIdCounter;
        setChips((prev) => [...prev, { id, type, message }]);
        timersRef.current[id] = setTimeout(() => {
            removeChip(id);
        }, timeout);
        return id;
    }, [timeout, removeChip]);

    return { chips, addChip, removeChip };
}
