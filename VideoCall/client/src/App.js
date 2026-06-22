import React, { useState } from 'react';
import VideoCall from './components/VideoCall';
import './App.css';

function App() {
  const [userName, setUserName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [joined, setJoined] = useState(false);

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
        <div className="login-card">
          <h1>Video Call Pro</h1>
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
