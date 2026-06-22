import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import './VideoCall.css';

const VideoCall = ({ userName, roomId, onLeave }) => {
  const [socket, setSocket] = useState(null);
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');

  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const candidateQueues = useRef({});

  // Initialize Socket
  useEffect(() => {
    const serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';
    const newSocket = io(serverUrl);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setConnectionStatus('Room: ' + roomId);
      newSocket.emit('join-room', { roomId, userName });
    });

    return () => newSocket.disconnect();
  }, [roomId, userName]);

  // Setup Local Stream
  useEffect(() => {
    const getLocalStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (e) {
        console.error("Media error", e);
        setConnectionStatus('Camera Error');
      }
    };
    getLocalStream();
  }, []);

  // Signaling Logic
  useEffect(() => {
    if (!socket) return;

    // 1. New user joins and gets all current users. New user is the CALLER.
    socket.on('all-users', (users) => {
      users.forEach(user => {
        console.log("Initiating call to existing user:", user.userName);
        const pc = createPeer(user.socketId, user.userName, true);
        peersRef.current[user.socketId] = pc;
      });
    });

    // 2. Existing users get notification of new user. They are the RECEIVERS.
    socket.on('user-joined', ({ socketId, userName }) => {
      console.log("New user joined room:", userName);
      const pc = createPeer(socketId, userName, false);
      peersRef.current[socketId] = pc;
    });

    socket.on('offer', async ({ from, fromName, offer }) => {
      console.log("Received offer from:", fromName);
      let pc = peersRef.current[from];
      if (!pc) {
        pc = createPeer(from, fromName, false);
        peersRef.current[from] = pc;
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        // Process queued candidates
        if (candidateQueues.current[from]) {
          while (candidateQueues.current[from].length > 0) {
            const cand = candidateQueues.current[from].shift();
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          }
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { to: from, answer });
      } catch (err) {
        console.error("Error handling offer:", err);
      }
    });

    socket.on('answer', async ({ from, answer }) => {
      console.log("Received answer from:", from);
      const pc = peersRef.current[from];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
          console.error("Error handling answer:", err);
        }
      }
    });

    socket.on('ice-candidate', async ({ from, candidate }) => {
      const pc = peersRef.current[from];
      if (pc?.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("Error adding candidate:", e);
        }
      } else {
        if (!candidateQueues.current[from]) candidateQueues.current[from] = [];
        candidateQueues.current[from].push(candidate);
      }
    });

    socket.on('user-left', (socketId) => {
      console.log("User left:", socketId);
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

  const createPeer = (targetSocketId, remoteName, isCaller) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
      ]
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('ice-candidate', { to: targetSocketId, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      console.log(`Received track from ${remoteName}`);
      setRemoteUsers(prev => {
        const existing = prev.find(u => u.socketId === targetSocketId);
        if (existing) {
          // If track changes or extra track added, update stream
          return prev.map(u => u.socketId === targetSocketId ? { ...u, stream: e.streams[0] } : u);
        }
        return [...prev, { socketId: targetSocketId, userName: remoteName, stream: e.streams[0] }];
      });
    };

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    }

    // Only the CALLER initiates the offer
    if (isCaller) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', { to: targetSocketId, roomId, offer });
        } catch (err) {
          console.error("Negotiation error:", err);
        }
      };
    }

    pc.onconnectionstatechange = () => {
      console.log(`Connection to ${remoteName}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') {
        // Simple retry logic could go here
      }
    };

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
    if (socket) socket.emit('leave-room');
    Object.values(peersRef.current).forEach(pc => pc.close());
    peersRef.current = {};
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
    }
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
