import { signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "../firebase";
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/Button';
import codeImage from '../assets/codeImage.png';
import { Users, MessageSquareDot, SquareTerminal, FileJson2, Monitor } from 'lucide-react';

export default function Login() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => {
      const mobileBreakpoint = 768;
      const userAgent = navigator.userAgent.toLowerCase();
      const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(userAgent);
      const isSmallScreen = window.innerWidth < mobileBreakpoint;
      
      setIsMobile(isMobileDevice || isSmallScreen);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (currentUser) {
      navigate('/dashboard');
    }
  }, [currentUser, navigate]);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      // The useEffect will handle the redirect
    } catch (err) {
      console.error("Google login error:", err);
      setLoading(false);
    }
    // No need to set loading to false here, as the component will unmount on successful login and redirect.
  };

  // Spinner component for loading state
  const LoadingSpinner = () => (
    <div className="loading-spinner">
      <div className="spinner"></div>
    </div>
  );

  return (
    <div className="login-container">
      <div className="login-left">
        <div className="image-container">
          <img src={codeImage} alt="Code Collaboration" className="hero-image" />
          <div className="image-overlay">
            <div className="floating-elements">
              <div className="code-snippet snippet-1">
                <span className="code-line">function collaborate() {'{'}</span>
                <span className="code-line">  return &apos;♨️ + 🚀&apos;;</span>
                <span className="code-line">{'}'}</span>
              </div>
              <div className="code-snippet snippet-2">
                <span className="code-line">const magic = await &apos;✨&apos;;</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="login-right">
        <div className="login-content">
          <div className="login-header">
            <h1 className="app-title">
              <span className="title-gradient">Code</span>
              <span className="title-accent">Hive</span>
            </h1>
            <p className="app-subtitle">
              Real-time collaborative coding made simple
            </p>
          </div>

          <div className="features-list">
            <div className="feature-item">
              <div className="feature-icon"><Users /></div>
              <div className="feature-text">
                <h3>Real-time Collaboration</h3>
              </div>
            </div>
            <div className="feature-item">
              <div className="feature-icon"><MessageSquareDot /></div>
              <div className="feature-text">
                <h3>Integrated Chat</h3>
              </div>
            </div>
            <div className="feature-item">
              <div className="feature-icon"><SquareTerminal /></div>
              <div className="feature-text">
                <h3>Shared Terminal</h3>
              </div>
            </div>
            <div className="feature-item">
              <div className="feature-icon"><FileJson2 /></div>
              <div className="feature-text">
                <h3>Multi-language Support</h3>
              </div>
            </div>
          </div>

          <div className="login-action">
            {isMobile && (
              <div className="mobile-warning">
                <div className="mobile-warning-icon">
                  <Monitor size={24} />
                </div>
                <div className="mobile-warning-content">
                  <h3>Desktop Experience Recommended</h3>
                  <p>For the best coding collaboration experience, please use a desktop or laptop computer.</p>
                </div>
              </div>
            )}
            <Button
              variant="primary"
              size="large"
              onClick={handleGoogleLogin}
              disabled={loading || isMobile}
              startIcon={loading ? <LoadingSpinner /> : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              className="google-login-btn"
            >
              {isMobile ? 'Use Desktop for Best Experience' : (loading ? 'Signing in...' : 'Continue with Google')}
            </Button>
            <p className="login-note">
              {isMobile ? 'Please switch to a desktop or laptop computer' : 'Secure authentication powered by Google'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}