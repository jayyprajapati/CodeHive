import { useNavigate, useLocation } from 'react-router-dom';

export default function Footer() {
  const navigate = useNavigate();
  const location = useLocation();

  // Hide header on login page
  if (location.pathname === '/login') return null;



  return (
    <footer className="app-footer">
      <div className="footer-container">
        <div className="footer-left">
          {/* add copyright text */}
          <span className="copyright-text">© {new Date().getFullYear()} CodeHive. All rights reserved.</span>
        </div>

        <div className="footer-right">
          {/* Add personal site and contact button */}
          <div className="footer-links">
            <a href="https://jayprajapati.dev" target="_blank" rel="noopener noreferrer" className="footer-link">
              Personal Site
            </a>
            <a href="mailto:jay.prajapati5717@gmail.com" className="footer-link">
              Contact
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
