import React, { useState } from 'react';
import VideoCall from './components/VideoCall';

function App() {
  const [userId, setUserId] = useState('');
  const [joined, setJoined] = useState(false);

  const handleJoin = () => {
    if (userId.trim()) {
      setJoined(true);
    }
  };

  if (!joined) {
    return (
      <div style={{ textAlign: 'center', marginTop: '50px' }}>
        <h1>Video Call App</h1>
        <input
          type="text"
          placeholder="Enter your name"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <button onClick={handleJoin}>Join</button>
      </div>
    );
  }

  return <VideoCall userId={userId} />;
}

export default App;
