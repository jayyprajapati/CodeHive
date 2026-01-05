import { useState } from 'react';
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useAuth } from '../contexts/AuthContext';
import Button from './Button';
import { useLocation } from 'react-router-dom';

export default function Header() {
  const { currentUser } = useAuth();
  const location = useLocation();
  const [loading, setLoading] = useState(false);

  // Don't show header on login page
  if (location.pathname === '/') {
    return null;
  }

  const handleLogout = async () => {
    setLoading(true);
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Logout error:", err);
      setLoading(false);
    }
  };

  // Loading spinner
  const LoadingSpinner = () => (
    <div className="header-spinner">
      <div className="spinner"></div>
    </div>
  );

  // Logout icon
  const LogoutIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
    </svg>
  );

  return (
    <header className="app-header">
      <div className="header-container">
        <div className="header-left">
          <div className="logo">
            <span className="logo-text">
              <span className="logo-gradient">Code</span>
              <span className="logo-accent">Hive</span>
            </span>
            {/* <div className="logo-badge">BETA</div> */}
          </div>
        </div>
        
        <div className="header-right">
          {currentUser && (
            <>
              <div className="user-info">
                <img 
                  src={currentUser.photoURL} 
                  alt={currentUser.displayName} 
                  className="user-avatar"
                />
                <div className="user-details">
                  <span className="user-name">{currentUser.displayName}</span>
                  <span className="user-email">{currentUser.email}</span>
                </div>
              </div>
              
              <Button
                variant="error"
                size="small"
                onClick={handleLogout}
                disabled={loading}
                startIcon={loading ? <LoadingSpinner /> : <LogoutIcon />}
                
              >
                {loading ? 'Signing out...' : 'Sign Out'}
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
