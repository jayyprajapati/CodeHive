import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/Button';

export default function Login() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/';
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (currentUser) {
      navigate(from, { replace: true });
    }
  }, [currentUser, from, navigate]);

  const handleGoogleLogin = async () => {
    setSigningIn(true);
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Sign-in failed');
      setSigningIn(false);
    }
  };

  if (currentUser) return null;

  return (
    <div className="login-container">
      <div className="login-content">
        <h1 className="login-title">Sign in to CodeHive</h1>
        <p className="login-subtitle">
          Sign in to create and join collaborative sessions.
        </p>

        {error && (
          <div className="custom-alert custom-alert--error" style={{ marginBottom: '1rem' }}>
            <span className="alert-content">
              <span className="alert-message">{error}</span>
            </span>
            <button className="alert-close" onClick={() => setError('')}>×</button>
          </div>
        )}

        <Button
          variant="primary"
          size="medium"
          onClick={handleGoogleLogin}
          disabled={signingIn}
          className="home-cta-btn"
        >
          {signingIn ? 'Signing in...' : 'Sign in with Google'}
        </Button>

        <p className="login-note">
          You will be redirected back after signing in.
        </p>
      </div>
    </div>
  );
}