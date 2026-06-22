import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import './VideoCall.css';

const VideoCall = ({ userName, roomId, onLeave }) => {
  const [socket, setSocket] = useState(null);
  const [remoteUsers, setRemoteUsers] = useState([]); // Array of { socketId, userName, stream }
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');

  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peersRef = useRef({}); // { socketId: RTCPeerConnection }
  const candidateQueues = useRef({}); // { socketId: [candidates] }

  // 1. Initialize Socket
  useEffect(() => {
    const serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';
    const newSocket = io(serverUrl);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setConnectionStatus('In Room: ' + roomId);
      newSocket.emit('join-room', { roomId, userName });
    });

    return () => newSocket.disconnect();
  }, [roomId, userName]);

  // 2. Setup Local Stream
  useEffect(() => {
    const getLocalStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (e) { console.error("Media error", e); }
    };
    getLocalStream();
  }, []);

  // 3. Signaling Logic
  useEffect(() => {
    if (!socket) return;

    // When we join, we get all current users
    socket.on('all-users', (users) => {
      users.forEach(user => {
        const pc = createPeer(user.socketId, socket.id, user.userName);
        peersRef.current[user.socketId] = pc;
      });
    });

    // When someone else joins
    socket.on('user-joined', ({ socketId, userName }) => {
      // We don't create the peer here, we wait for an offer from them
      // OR we create it and wait. Let's make the NEW person the "caller"
      // for simplicity in this logic, or the EXISTING people callers.
      // Standard: The person who was already there initiates to the new person.
      const pc = createPeer(socketId, socket.id, userName);
      peersRef.current[socketId] = pc;
    });

    socket.on('offer', async ({ from, fromName, offer }) => {
      let pc = peersRef.current[from];
      if (!pc) {
        pc = addPeer(from, fromName);
        peersRef.current[from] = pc;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Process any queued candidates
      if (candidateQueues.current[from]) {
        while (candidateQueues.current[from].length > 0) {
          const cand = candidateQueues.current[from].shift();
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        }
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { to: from, answer });
    });

    socket.on('answer', async ({ from, answer }) => {
      const pc = peersRef.current[from];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('ice-candidate', async ({ from, candidate }) => {
      const pc = peersRef.current[from];
      if (pc?.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        if (!candidateQueues.current[from]) candidateQueues.current[from] = [];
        candidateQueues.current[from].push(candidate);
      }
    });

    socket.on('user-left', (socketId) => {
      if (peersRef.current[socketId]) {
        peersRef.current[socketId].close();
        delete peersRef.current[socketId];
      }
      setRemoteUsers(prev => prev.filter(u => u.socketId !== socketId));
    });

    return () => {
      socket.off('all-users');
      socket.off('user-joined');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('user-left');
    };
  }, [socket]);

  // Helper to create a peer connection as a "caller"
  const createPeer = (targetSocketId, myId, remoteName) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
      ]
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { to: targetSocketId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      setRemoteUsers(prev => {
        const existing = prev.find(u => u.socketId === targetSocketId);
        if (existing) return prev;
        return [...prev, { socketId: targetSocketId, userName: remoteName, stream: e.streams[0] }];
      });
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    }

    // Since we are creating this peer to an existing user, we initiate the offer
    pc.onnegotiationneeded = async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { to: targetSocketId, roomId, offer });
    };

    return pc;
  };

  // Helper to add a peer connection as a "receiver"
  const addPeer = (targetSocketId, remoteName) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
      ]
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { to: targetSocketId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      setRemoteUsers(prev => {
        const existing = prev.find(u => u.socketId === targetSocketId);
        if (existing) return prev;
        return [...prev, { socketId: targetSocketId, userName: remoteName, stream: e.streams[0] }];
      });
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    }

    return pc;
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(videoTrack.enabled);
      }
    }
  };

  const handleLeave = () => {
    socket.emit('leave-room');
    Object.values(peersRef.current).forEach(pc => pc.close());
    onLeave();
  };

  return (
    <div className="video-call-container">
      <div className="header-info">
        <h1>Video Call Pro</h1>
        <div className="status-bar">{connectionStatus}</div>
      </div>

      <div className="videos-grid">
        {/* Local Video */}
        <div className="video-wrapper">
          <div className="video-header">
            <h3>You ({userName})</h3>
          </div>
          <video ref={localVideoRef} autoPlay muted playsInline />
          <div className="controls-bar">
            <button className={`control-btn ${!isMicOn ? 'off' : ''}`} onClick={toggleMic}>
              {isMicOn ? '🎤' : '🔇'}
            </button>
            <button className={`control-btn ${!isVideoOn ? 'off' : ''}`} onClick={toggleVideo}>
              {isVideoOn ? '📹' : '❌'}
            </button>
            <button className="control-btn end" onClick={handleLeave}>📞</button>
          </div>
        </div>

        {/* Remote Videos */}
        {remoteUsers.map(user => (
          <RemoteVideo key={user.socketId} user={user} />
        ))}
      </div>
    </div>
  );
};

const RemoteVideo = ({ user }) => {
  const videoRef = useRef();
  useEffect(() => {
    if (videoRef.current && user.stream) {
      videoRef.current.srcObject = user.stream;
    }
  }, [user.stream]);

  return (
    <div className="video-wrapper">
      <div className="video-header">
        <h3>{user.userName}</h3>
      </div>
      <video ref={videoRef} autoPlay playsInline />
    </div>
  );
};

export default VideoCall;
