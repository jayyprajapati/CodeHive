import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { generateSessionId, generateStrongPassword } from "../utils/session";
import { verifySession, createNewSession } from "../api";
import Button from '../components/Button';
import Input from '../components/Input';
import Checkbox from '../components/Checkbox';
import codeImage from '../assets/codeImage.png';
import { CirclePlus, MoveRight } from 'lucide-react'

export default function Dashboard() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [createSessionConfig, setCreateSessionConfig] = useState({
    useCustomPass: false,
    password: "",
  });
  const [joinData, setJoinData] = useState({ id: "", pass: "" });
  const [alert, setAlert] = useState(null);

  const handleCreateSession = async () => {
    setCreatingRoom(true);
    const newSessionId = generateSessionId();
    const finalPassword = createSessionConfig.useCustomPass
      ? createSessionConfig.password
      : generateStrongPassword();

    try {
      const { valid, error } = await createNewSession(
        newSessionId,
        finalPassword,
        currentUser.uid
      );

      if (valid) {
        navigate(`/editor/${newSessionId}`, {
          state: {
            sessionPassword: finalPassword,
            isOwner: true,
          },
        });
      } else {
        setAlert({
          severity: "warning",
          title: "Warning",
          message: error || "Could not start a new session. Please try again later!",
        });
      }
    } catch (err) {
      console.error(err);
      setAlert({
        severity: "error",
        title: "Error",
        message: "Failed to create session. Please try again.",
      });
    } finally {
      setCreatingRoom(false);
    }
  };

  const handleJoinSession = async () => {
    if (!joinData.id || !joinData.pass) {
      setAlert({
        severity: "warning",
        title: "Warning",
        message: "Please enter both session ID and password",
      });
      return;
    }

    setJoiningRoom(true);

    try {
      const { valid, error } = await verifySession(joinData.id, joinData.pass);

      if (valid) {
        navigate(`/editor/${joinData.id}`, {
          state: {
            sessionPassword: joinData.pass,
            isOwner: false,
          },
        });
      } else {
        setAlert({
          severity: "warning",
          title: "Warning",
          message: error || "Invalid session credentials",
        });
      }
    } catch (err) {
      console.error(err);
      setAlert({
        severity: "error",
        title: "Error",
        message: "Failed to verify session. Please try again.",
      });
    } finally {
      setJoiningRoom(false);
    }
  };

  // Loading Spinner component
  const LoadingSpinner = () => (
    <div className="loading-spinner">
      <div className="spinner"></div>
    </div>
  );

  // Alert component
  const AlertMessage = ({ alert, onClose }) => {
    if (!alert) return null;
    
    const alertClass = `custom-alert custom-alert--${alert.severity}`;
    
    return (
      <div className={alertClass}>
        <div className="alert-content">
          <h4 className="alert-title">{alert.title}</h4>
          <p className="alert-message">{alert.message}</p>
        </div>
        <button className="alert-close" onClick={onClose}>×</button>
      </div>
    );
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-left">
        <div className="image-container">
          <img src={codeImage} alt="Code Collaboration" className="hero-image" />
          <div className="image-overlay">
            <div className="dashboard-stats">
              <div className="stat-card">
                <div className="stat-icon">🚀</div>
                <div className="stat-info">
                  <h3>Quick Start</h3>
                  <p>Create or join rooms instantly</p>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">🔒</div>
                <div className="stat-info">
                  <h3>Secure</h3>
                  <p>Password-protected sessions</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="dashboard-right">
        <div className="dashboard-content">
          <AlertMessage alert={alert} onClose={() => setAlert(null)} />
          
          <div className="dashboard-header">
            <h4 className="welcome-title">
              Welcome back, &nbsp;
              <span className="user-name name-dashboard">{currentUser?.displayName?.split(' ')[0] || 'Developer'}!</span>
            </h4>
            <p className="dashboard-subtitle">
              Ready to collaborate? Choose an option below to get started.
            </p>
          </div>

          <div className="room-actions">
            <div className="action-card create-card">
              <div className="card-header">
                <div className="card-icon create-icon"><CirclePlus /></div>
                <div className="card-title">
                  <h3>Create New Room</h3>
                  <p>Start a new collaborative session</p>
                </div>
              </div>
              
              <div className="card-content">
                <Checkbox
                  checked={createSessionConfig.useCustomPass}
                  onChange={(e) =>
                    setCreateSessionConfig((prev) => ({
                      ...prev,
                      useCustomPass: e.target.checked,
                    }))
                  }
                  disabled={creatingRoom}
                  label="Use custom password"
                />

                {createSessionConfig.useCustomPass && (
                  <Input
                    // label="Custom Password"
                    type="password"
                    value={createSessionConfig.password}
                    onChange={(e) =>
                      setCreateSessionConfig((prev) => ({
                        ...prev,
                        password: e.target.value,
                      }))
                    }
                    disabled={creatingRoom}
                    placeholder="Enter your custom password"
                  />
                )}

                <Button
                  variant="primary"
                  onClick={handleCreateSession}
                  disabled={creatingRoom}
                  startIcon={creatingRoom ? <LoadingSpinner /> : ''}
                  className="create-room-btn"
                >
                  {creatingRoom ? 'Creating Room...' : 'Create Room'}
                </Button>
              </div>
            </div>

            <div className="divider">
              <span className="divider-text">OR</span>
            </div>

            <div className="action-card join-card">
              <div className="card-header">
                <div className="card-icon join-icon"><MoveRight /></div>
                <div className="card-title">
                  <h3>Join Existing Room</h3>
                  <p>Connect to an ongoing session</p>
                </div>
              </div>
              
              <div className="card-content">
                <Input
                  // label="Session ID"
                  value={joinData.id}
                  onChange={(e) =>
                    setJoinData((p) => ({ ...p, id: e.target.value }))
                  }
                  disabled={joiningRoom}
                  placeholder="Enter session ID"
                />
                
                <Input
                  // label="Password"
                  type="password"
                  value={joinData.pass}
                  onChange={(e) =>
                    setJoinData((p) => ({ ...p, pass: e.target.value }))
                  }
                  disabled={joiningRoom}
                  placeholder="Enter session password"
                />
                
                <Button
                  variant="secondary"
                  onClick={handleJoinSession}
                  disabled={joiningRoom || !joinData.id || !joinData.pass}
                  startIcon={joiningRoom ? <LoadingSpinner /> : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8.59 16.59L13.17 12L8.59 7.41L10 6l6 6-6 6-1.41-1.41z"/>
                    </svg>
                  )}
                  className="join-room-btn"
                >
                  {joiningRoom ? 'Joining Room...' : 'Join Room'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

