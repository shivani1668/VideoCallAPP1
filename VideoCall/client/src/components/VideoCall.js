import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import './VideoCall.css';

const VideoCall = ({ userName, roomId, onLeave }) => {
  const [socket, setSocket] = useState(null);
  const [remoteUsers, setRemoteUsers] = useState([]); 
  const [connectionStatus, setConnectionStatus] = useState('Initializing Camera...');
  
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peersRef = useRef({}); 
  const candidateQueues = useRef({}); 

  // 1. Setup Local Stream FIRST
  useEffect(() => {
    const getLocalStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        
        // ONLY connect to socket after the stream is ready
        setConnectionStatus('Connecting to Room...');
        const serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';
        const newSocket = io(serverUrl);
        setSocket(newSocket);

        newSocket.on('connect', () => {
          setConnectionStatus('Room: ' + roomId);
          newSocket.emit('join-room', { roomId, userName });
        });

      } catch (e) { 
        console.error("Media error", e);
        setConnectionStatus('Camera Error - Please Refresh and Allow Camera');
      }
    };
    getLocalStream();

    return () => {
      if (socket) socket.disconnect();
    };
  }, [roomId, userName]);

  // 2. Signaling Logic (Only runs after socket is set)
  useEffect(() => {
    if (!socket) return;

    socket.on('all-users', (users) => {
      users.forEach(user => {
        const pc = createPeer(user.socketId, user.userName, true);
        peersRef.current[user.socketId] = pc;
      });
    });

    socket.on('user-joined', ({ socketId, userName }) => {
      const pc = createPeer(socketId, userName, false);
      peersRef.current[socketId] = pc;
    });

    socket.on('offer', async ({ from, fromName, offer }) => {
      let pc = peersRef.current[from];
      if (!pc) {
        pc = createPeer(from, fromName, false);
        peersRef.current[from] = pc;
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        if (candidateQueues.current[from]) {
          while (candidateQueues.current[from].length > 0) {
            const cand = candidateQueues.current[from].shift();
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          }
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { to: from, answer });
      } catch (err) { console.error("Offer handling error", err); }
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
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
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
      if (e.candidate) socket.emit('ice-candidate', { to: targetSocketId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      setRemoteUsers(prev => {
        const existing = prev.find(u => u.socketId === targetSocketId);
        if (existing) return prev.map(u => u.socketId === targetSocketId ? { ...u, stream: e.streams[0] } : u);
        return [...prev, { socketId: targetSocketId, userName: remoteName, stream: e.streams[0] }];
      });
    };

    // Add local tracks (guaranteed to be ready now)
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    }

    if (isCaller) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', { to: targetSocketId, roomId, offer });
        } catch (err) { console.error("Negotiation error", err); }
      };
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
    if (socket) socket.emit('leave-room');
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
        <div className="video-wrapper">
          <div className="video-header"><h3>You ({userName})</h3></div>
          <video ref={localVideoRef} autoPlay muted playsInline />
          <div className="controls-bar">
            <button className={`control-btn ${!isMicOn ? 'off' : ''}`} onClick={toggleMic}>{isMicOn ? '🎤' : '🔇'}</button>
            <button className={`control-btn ${!isVideoOn ? 'off' : ''}`} onClick={toggleVideo}>{isVideoOn ? '📹' : '❌'}</button>
            <button className="control-btn end" onClick={handleLeave}>📞</button>
          </div>
        </div>

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
      <div className="video-header"><h3>{user.userName}</h3></div>
      <video ref={videoRef} autoPlay playsInline />
    </div>
  );
};

export default VideoCall;
