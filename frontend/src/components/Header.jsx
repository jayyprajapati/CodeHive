import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import Button from '../components/Button';

export default function Header() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Hide header on login page
  if (location.pathname === '/login') return null;

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Login failed:', err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
      navigate('/');
    } catch (err) {
      console.error('Logout failed:', err.message);
    }
  };

  return (
    <header className="app-header">
      <div className="header-container">
        <div className="header-left">
          <div className="logo" onClick={() => navigate('/')}>
            <span className="logo-text">
              <span className="logo-gradient">Code</span>
              <span className="logo-accent">Hive</span>
            </span>
          </div>
        </div>

        <div className="header-right">
          {currentUser ? (
            <>
              <div className="user-info">
                <div className="user-avatar">
                  {currentUser.displayName?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="user-details">
                  <span className="user-name">{currentUser.displayName}</span>
                </div>
              </div>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={handleLogout}
                  className="header-btn-logout"
                >
                Logout
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="small" onClick={handleLogin} className="header-btn-login">
              Login
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
