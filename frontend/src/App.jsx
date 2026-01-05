import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css'
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import EditorPage from './pages/EditorPage';
import ProtectedRoute from './components/ProtectedRoute';
import Header from './components/Header';


function App() {
  return (
    <Router>
      <Header />
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
          } />
        <Route path="/editor/:sessionId" element={
          <ProtectedRoute>
            <EditorPage />
          </ProtectedRoute>
          } />
      </Routes>
    </Router>
  )
}

export default App
