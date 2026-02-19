import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { createNewSession, verifySession } from '../api';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import {
    Terminal, Code2, Play, Users, Zap, Cloud, Lock, Globe,
    Braces, Hash, Coffee, ArrowRight, Box, Layers
} from 'lucide-react';

function generateId(length = 8) {
    return Math.random().toString(36).substring(2, 2 + length);
}

const LANGUAGES = [
    { name: 'JavaScript', icon: Braces, color: '#F7DF1E' },
    { name: 'Python', icon: Hash, color: '#3776AB' },
    { name: 'Java', icon: Coffee, color: '#ED8B00' },
];

const PLAYGROUND_FEATURES = [
    { icon: Zap, label: 'Instant start' },
    { icon: Terminal, label: 'Live terminal' },
    { icon: Cloud, label: 'No setup needed' },
    { icon: Play, label: 'Run in browser' },
];

const ROOM_FEATURES = [
    { icon: Users, label: 'Live cursors' },
    { icon: Lock, label: 'Password protected' },
    { icon: Globe, label: 'Share via link' },
    { icon: Layers, label: 'Role management' },
];

export default function HomePage() {
    const navigate = useNavigate();
    const { currentUser } = useAuth();

    const [joinSessionId, setJoinSessionId] = useState('');
    const [joinPassword, setJoinPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // Ensure user is signed in, trigger OAuth if not
    const ensureSignedIn = async () => {
        if (currentUser) return true;
        try {
            await signInWithPopup(auth, googleProvider);
            return true;
        } catch (err) {
            console.error('Sign-in cancelled:', err.message);
            return false;
        }
    };

    const handleStartPlayground = () => {
        navigate('/playground');
    };

    const handleCreateSession = async (e) => {
        e.preventDefault();
        const signedIn = await ensureSignedIn();
        if (!signedIn) return;

        setLoading(true);
        setError('');
        try {
            const sessionId = generateId();
            const sessionPassword = generateId(6);
            const user = auth.currentUser;
            await createNewSession(sessionId, sessionPassword, user.uid);
            navigate(`/session/${sessionId}`, { state: { sessionPassword } });
        } catch (err) {
            setError(err.message || 'Failed to create room');
        } finally {
            setLoading(false);
        }
    };

    const handleJoinSession = async (e) => {
        e.preventDefault();
        if (!joinSessionId.trim() || !joinPassword.trim()) {
            setError('Room ID and password are required.');
            return;
        }
        const signedIn = await ensureSignedIn();
        if (!signedIn) return;

        setLoading(true);
        setError('');
        try {
            await verifySession(joinSessionId.trim(), joinPassword.trim());
            navigate(`/session/${joinSessionId.trim()}`, {
                state: { sessionPassword: joinPassword.trim() },
            });
        } catch (err) {
            setError(err.message || 'Failed to join room');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="home-page">
            {/* Background decorative icons */}
            <div className="home-bg-icons" aria-hidden="true">
                <Terminal className="home-bg-icon home-bg-icon--1" size={120} />
                <Code2 className="home-bg-icon home-bg-icon--2" size={90} />
                <Braces className="home-bg-icon home-bg-icon--3" size={100} />
                <Box className="home-bg-icon home-bg-icon--4" size={80} />
                <Layers className="home-bg-icon home-bg-icon--5" size={85} />
                <Code2 className="home-bg-icon home-bg-icon--6" size={95} />
            </div>

            {/* Error toast */}
            {error && (
                <div className="home-error-toast">
                    <span>{error}</span>
                    <button onClick={() => setError('')}>×</button>
                </div>
            )}

            {/* Hero — compact */}
            <div className="home-hero">
                <h1 className="home-hero-title">
                    Write. Run. <span className="home-hero-accent">Collaborate.</span>
                </h1>
                <p className="home-hero-subtitle">
                    Skip the local setup. Code in any language, execute instantly, and
                    pair-program in real-time — all from your browser.
                </p>
            </div>

            {/* Two sections */}
            <div className="home-sections">
                {/* Playground */}
                <div className="home-section">
                    <div className="home-section-header">
                        <Terminal size={24} className="home-section-icon" />
                        <div>
                            <h2 className="home-section-title">Playground</h2>
                            <p className="home-section-subtitle">
                                Instant code scratchpad — no account required.
                            </p>
                        </div>
                    </div>

                    <div className="home-feature-chips">
                        {PLAYGROUND_FEATURES.map((f) => (
                            <div className="home-chip" key={f.label}>
                                <f.icon size={14} />
                                <span>{f.label}</span>
                            </div>
                        ))}
                    </div>

                    <button className="home-cta home-cta--primary" onClick={handleStartPlayground}>
                        <Play size={18} />
                        Start Playground
                        <ArrowRight size={16} />
                    </button>
                </div>

                {/* Rooms */}
                <div className="home-section">
                    <div className="home-section-header">
                        <Users size={24} className="home-section-icon" />
                        <div>
                            <h2 className="home-section-title">Rooms</h2>
                            <p className="home-section-subtitle">
                                Real-time collaborative coding with your team.
                            </p>
                        </div>
                    </div>

                    <div className="home-feature-chips">
                        {ROOM_FEATURES.map((f) => (
                            <div className="home-chip" key={f.label}>
                                <f.icon size={14} />
                                <span>{f.label}</span>
                            </div>
                        ))}
                    </div>

                    {/* Create / Join forms */}
                    <div className="home-room-actions">
                        <form className="home-room-form" onSubmit={handleCreateSession}>
                            <div className="home-form-label">Create a new room</div>
                            <button
                                className="home-cta home-cta--primary home-cta--full"
                                type="submit"
                                disabled={loading}
                            >
                                {loading ? 'Creating...' : 'Create Room'}
                                <ArrowRight size={16} />
                            </button>
                        </form>

                        <div className="home-form-divider">
                            <span>or</span>
                        </div>

                        <form className="home-room-form" onSubmit={handleJoinSession}>
                            <div className="home-form-label">Join an existing room</div>
                            <div className="home-input-row">
                                <input
                                    className="home-input"
                                    type="text"
                                    placeholder="Room ID"
                                    value={joinSessionId}
                                    onChange={(e) => setJoinSessionId(e.target.value)}
                                />
                                <input
                                    className="home-input"
                                    type="password"
                                    placeholder="Password"
                                    value={joinPassword}
                                    onChange={(e) => setJoinPassword(e.target.value)}
                                />
                            </div>
                            <button
                                className="home-cta home-cta--secondary home-cta--full"
                                type="submit"
                                disabled={loading}
                            >
                                {loading ? 'Joining...' : 'Join Room'}
                                <ArrowRight size={16} />
                            </button>
                        </form>
                    </div>
                </div>
            </div>

            {/* Language strip — bottom */}
            <div className="home-lang-strip">
                {LANGUAGES.map((lang) => (
                    <div className="home-lang-pill" key={lang.name}>
                        <lang.icon size={16} style={{ color: lang.color }} />
                        <span>{lang.name}</span>
                    </div>
                ))}
                <span className="home-lang-more">+ more coming</span>
            </div>
        </div>
    );
}
