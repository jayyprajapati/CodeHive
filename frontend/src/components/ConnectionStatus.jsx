/**
 * ConnectionStatus - Non-intrusive connection status indicator
 * 
 * Displays connection state only when there are issues (reconnecting, error, disconnected).
 * Hidden when connected to avoid cluttering the UI.
 * 
 * @module ConnectionStatus
 */

import { useState, useEffect } from 'react';
import { ConnectionState } from '../hooks/useSocket';

/**
 * Connection status indicator component.
 * 
 * @param {Object} props
 * @param {ConnectionState} props.connectionState - Current connection state
 * @param {Object|null} props.reconnectInfo - Reconnection attempt info
 * @param {Error|null} props.error - Last connection error
 * @param {Function} props.onRetry - Callback when retry button is clicked
 * 
 * @example
 * <ConnectionStatus
 *   connectionState={connectionState}
 *   reconnectInfo={reconnectInfo}
 *   error={error}
 *   onRetry={reconnect}
 * />
 */
export default function ConnectionStatus({
    connectionState,
    reconnectInfo,
    error,
    onRetry
}) {
    const [visible, setVisible] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    // Handle visibility transitions
    useEffect(() => {
        if (connectionState === ConnectionState.CONNECTED) {
            // Show success briefly then hide
            setShowSuccess(true);
            const timer = setTimeout(() => {
                setShowSuccess(false);
                setVisible(false);
            }, 2000);
            return () => clearTimeout(timer);
        } else if (connectionState !== ConnectionState.DISCONNECTED) {
            // Show for all non-idle states
            setVisible(true);
        }
    }, [connectionState]);

    // Don't render if not visible or disconnected (initial state)
    if (!visible && connectionState === ConnectionState.DISCONNECTED) {
        return null;
    }

    // Render based on state
    const renderContent = () => {
        switch (connectionState) {
            case ConnectionState.CONNECTING:
                return (
                    <div className="connection-status connection-status--connecting">
                        <div className="connection-status__spinner"></div>
                        <span>Connecting...</span>
                    </div>
                );

            case ConnectionState.RECONNECTING:
                return (
                    <div className="connection-status connection-status--reconnecting">
                        <div className="connection-status__spinner"></div>
                        <span>
                            Reconnecting...
                            {reconnectInfo && (
                                <small> (attempt {reconnectInfo.attempt}/{reconnectInfo.maxAttempts})</small>
                            )}
                        </span>
                    </div>
                );

            case ConnectionState.ERROR:
                return (
                    <div className="connection-status connection-status--error">
                        <span className="connection-status__icon">⚠️</span>
                        <span>Connection failed</span>
                        {error && <small className="connection-status__message">{error.message}</small>}
                        {onRetry && (
                            <button
                                className="connection-status__retry"
                                onClick={onRetry}
                                aria-label="Retry connection"
                            >
                                Retry
                            </button>
                        )}
                    </div>
                );

            case ConnectionState.CONNECTED:
                if (showSuccess) {
                    return (
                        <div className="connection-status connection-status--connected">
                            <span className="connection-status__icon">✓</span>
                            <span>Connected</span>
                        </div>
                    );
                }
                return null;

            default:
                return null;
        }
    };

    const content = renderContent();
    if (!content) return null;

    return (
        <div
            className="connection-status-wrapper"
            role="status"
            aria-live="polite"
        >
            {content}
        </div>
    );
}
