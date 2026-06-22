import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import './VideoCall.css';

const VideoCall = ({ userId }) => {
  const [socket, setSocket] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [callInProgress, setCallInProgress] = useState(false);
  const [remoteSocketId, setRemoteSocketId] = useState(null);
  const [remoteUserName, setRemoteUserName] = useState('');
  const [incomingCall, setIncomingCall] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('');

  // Media states
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnection = useRef(null);
  const remoteSocketIdRef = useRef(null);
  const candidateQueue = useRef([]);

  useEffect(() => {
    remoteSocketIdRef.current = remoteSocketId;
  }, [remoteSocketId]);

  // Initialize Socket.io
  useEffect(() => {
    const serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';
    const newSocket = io(serverUrl);
    setSocket(newSocket);

    newSocket.on('connect', () => newSocket.emit('join', userId));
    newSocket.on('online-users', setOnlineUsers);
    newSocket.on('user-joined', (data) => setOnlineUsers((prev) => [...prev, data]));
    newSocket.on('user-left', (socketId) => {
      setOnlineUsers((prev) => prev.filter((u) => u.socketId !== socketId));
      if (remoteSocketIdRef.current === socketId) cleanupCall();
    });

    return () => newSocket.disconnect();
  }, [userId]);

  // Setup local video stream
  useEffect(() => {
    const getLocalStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (e) { console.error("Media error", e); }
    };
    getLocalStream();
  }, []);

  // Signaling
  useEffect(() => {
    if (!socket) return;

    socket.on('offer', (data) => setIncomingCall(data));

    socket.on('answer', async (data) => {
      if (peerConnection.current) {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        processCandidates();
      }
    });

    socket.on('ice-candidate', async (data) => {
      if (peerConnection.current?.remoteDescription) {
        try { await peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate)); }
        catch (e) { console.error("ICE Error", e); }
      } else {
        candidateQueue.current.push(data.candidate);
      }
    });

    socket.on('call-ended', cleanupCall);
  }, [socket]);

  const processCandidates = async () => {
    while (candidateQueue.current.length > 0) {
      const candidate = candidateQueue.current.shift();
      try { await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (e) { console.error("Queued ICE Error", e); }
    }
  };

  const initializePeerConnection = (targetSocketId) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
      ]
    });

    pc.ontrack = (e) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
    };

    const localStream = localVideoRef.current?.srcObject;
    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { to: targetSocketId, candidate: e.candidate });
    };

    pc.onconnectionstatechange = () => setConnectionStatus(pc.connectionState);

    peerConnection.current = pc;
    return pc;
  };

  const initiateCall = async (user) => {
    setRemoteSocketId(user.socketId);
    setRemoteUserName(user.userId);
    setCallInProgress(true);

    const pc = initializePeerConnection(user.socketId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { to: user.socketId, offer });
  };

  const acceptCall = async () => {
    const { from, fromName, offer } = incomingCall;
    setRemoteSocketId(from);
    setRemoteUserName(fromName);
    setCallInProgress(true);
    setIncomingCall(null);

    const pc = initializePeerConnection(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await processCandidates();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { to: from, answer });
  };

  const toggleMic = () => {
    const stream = localVideoRef.current?.srcObject;
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    const stream = localVideoRef.current?.srcObject;
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(videoTrack.enabled);
      }
    }
  };

  const cleanupCall = () => {
    if (peerConnection.current) peerConnection.current.close();
    peerConnection.current = null;
    setCallInProgress(false);
    setRemoteSocketId(null);
    setRemoteUserName('');
    setConnectionStatus('');
    candidateQueue.current = [];
  };

  const handleEndCall = () => {
    if (socket && remoteSocketIdRef.current) {
      socket.emit('end-call', { to: remoteSocketIdRef.current });
    }
    cleanupCall();
  };

  return (
    <div className="video-call-container">
      <h1>Video Call Pro</h1>

      {connectionStatus && (
        <div className="status-bar">
          Status: <span style={{color: connectionStatus === 'connected' ? 'var(--success-color)' : 'orange'}}>
            {connectionStatus}
          </span>
        </div>
      )}

      <div className="videos-grid">
        {/* Local Video */}
        <div className="video-wrapper">
          <div className="video-header">
            <h3>You ({userId})</h3>
          </div>
          <video ref={localVideoRef} autoPlay muted playsInline />

          <div className="controls-bar">
            <button
              className={`control-btn ${!isMicOn ? 'off' : ''}`}
              onClick={toggleMic}
              title={isMicOn ? "Mute Mic" : "Unmute Mic"}
            >
              {isMicOn ? '🎤' : '🔇'}
            </button>
            <button
              className={`control-btn ${!isVideoOn ? 'off' : ''}`}
              onClick={toggleVideo}
              title={isVideoOn ? "Stop Video" : "Start Video"}
            >
              {isVideoOn ? '📹' : '❌'}
            </button>
            {callInProgress && (
              <button className="control-btn end" onClick={handleEndCall} title="End Call">
                📞
              </button>
            )}
          </div>
        </div>

        {/* Remote Video */}
        {callInProgress && (
          <div className="video-wrapper">
            <div className="video-header">
              <h3>{remoteUserName}</h3>
            </div>
            <video ref={remoteVideoRef} autoPlay playsInline />
          </div>
        )}
      </div>

      {/* Incoming Call Overlay */}
      {incomingCall && (
        <div className="incoming-call-overlay">
          <div className="incoming-call-modal">
            <div style={{fontSize: '3rem', marginBottom: '10px'}}>📞</div>
            <h2>{incomingCall.fromName} is calling...</h2>
            <div className="modal-actions">
              <button className="modal-btn accept-btn" onClick={acceptCall}>Accept</button>
              <button className="modal-btn reject-btn" onClick={() => setIncomingCall(null)}>Reject</button>
            </div>
          </div>
        </div>
      )}

      {/* Online Users List */}
      {!callInProgress && (
        <div className="online-users-section">
          <h3>Online Friends</h3>
          {onlineUsers.length === 0 ? (
            <p style={{color: 'var(--text-muted)'}}>No one else is online right now.</p>
          ) : (
            onlineUsers.map((user) => (
              <div className="user-item" key={user.socketId}>
                <div className="user-info">
                  <div className="online-indicator"></div>
                  <span>{user.userId}</span>
                </div>
                <button className="call-btn" onClick={() => initiateCall(user)}>Call</button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default VideoCall;
