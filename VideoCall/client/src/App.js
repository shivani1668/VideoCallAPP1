import React, { useState } from 'react';
import VideoCall from './components/VideoCall';
import './App.css';

function App() {
  const [userName, setUserName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [joined, setJoined] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const handleJoin = (e) => {
    e.preventDefault();
    if (userName.trim() && roomId.trim()) {
      setJoined(true);
    }
  };

  const handleCreateRoom = () => {
    const randomRoomId = Math.random().toString(36).substring(2, 9);
    setRoomId(randomRoomId);
  };

  if (!joined) {
    return (
      <div className="login-container">
        <button
          className="instructions-toggle"
          onClick={() => setShowInstructions(!showInstructions)}
          aria-label="Toggle Instructions"
        >
          {showInstructions ? '✕' : 'ℹ Instructions'}
        </button>

        {showInstructions && (
          <div className="instructions-overlay" onClick={() => setShowInstructions(false)}>
            <div className="instructions-content" onClick={(e) => e.stopPropagation()}>
              <h2>How to use FaceLink</h2>
              <div className="instruction-item">
                <span className="icon">💡</span>
                <div>
                  <strong>New here?</strong>
                  <p>Click "New" to generate a unique Room ID for your meeting.</p>
                </div>
              </div>
              <div className="instruction-item">
                <span className="icon">🔗</span>
                <div>
                  <strong>Joining?</strong>
                  <p>Paste the ID provided by your friend to enter their room.</p>
                </div>
              </div>
              <div className="instruction-item">
                <span className="icon">📱</span>
                <div>
                  <strong>Mobile Users</strong>
                  <p>Scroll down after joining to access call controls and chat.</p>
                </div>
              </div>
              <button className="close-instructions-btn" onClick={() => setShowInstructions(false)}>
                Got it!
              </button>
            </div>
          </div>
        )}

        <div className="login-card">
          <div className="logo-wrapper">
             <img src="/logo.png" alt="FaceLink Logo" className="app-logo-large" />
          </div>
          <h1>FaceLink</h1>
          <form onSubmit={handleJoin}>
            <div className="input-group">
              <label>Your Name</label>
              <input
                type="text"
                placeholder="e.g. Krishna"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                required
              />
            </div>
            <div className="input-group">
              <label>Room ID</label>
              <div className="room-input-wrapper">
                <input
                  type="text"
                  placeholder="Enter Room ID"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  required
                />
                <button type="button" className="secondary-btn" onClick={handleCreateRoom}>
                  New
                </button>
              </div>
            </div>
            <button type="submit" className="primary-btn">Join Room</button>
          </form>
        </div>
      </div>
    );
  }

  return <VideoCall userName={userName} roomId={roomId} onLeave={() => setJoined(false)} />;
}

export default App;
