import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import './App.css'
import Login from './pages/Login';
import HomePage from './pages/HomePage';
import PlaygroundPage from './pages/PlaygroundPage';
import EditorPage from './pages/EditorPage';
import ProtectedRoute from './components/ProtectedRoute';
import Header from './components/Header';
import Footer from './components/Footer';

// Backward compat: redirect /editor/:sessionId → /session/:sessionId
function EditorRedirect() {
  const { sessionId } = useParams();
  return <Navigate to={`/session/${sessionId}`} replace />;
}

function App() {
  return (
    <Router>
      <Header />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/playground" element={<PlaygroundPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/session/:sessionId" element={
          <ProtectedRoute>
            <EditorPage />
          </ProtectedRoute>
        } />
        {/* Backward compat redirects */}
        <Route path="/dashboard" element={<Navigate to="/" replace />} />
        <Route path="/editor/:sessionId" element={<EditorRedirect />} />
      </Routes>
      <Footer />
    </Router>
  )
}

export default App
