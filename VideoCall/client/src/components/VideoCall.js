import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import './VideoCall.css';

const VideoCall = ({ userId }) => {
  const [socket, setSocket] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [callInProgress, setCallInProgress] = useState(false);
  const [remoteSocketId, setRemoteSocketId] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('');

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnection = useRef(null);
  const remoteSocketIdRef = useRef(null);
  const candidateQueue = useRef([]);

  useEffect(() => {
    remoteSocketIdRef.current = remoteSocketId;
  }, [remoteSocketId]);

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

  useEffect(() => {
    const getLocalStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (e) { console.error("Media error", e); }
    };
    getLocalStream();
  }, []);

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
    pc.ontrack = (e) => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0]; };
    const localStream = localVideoRef.current?.srcObject;
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { to: targetSocketId, candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => setConnectionStatus(pc.connectionState);
    peerConnection.current = pc;
    return pc;
  };

  const initiateCall = async (id) => {
    setRemoteSocketId(id);
    setCallInProgress(true);
    const pc = initializePeerConnection(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { to: id, offer });
  };

  const acceptCall = async () => {
    const { from, offer } = incomingCall;
    setRemoteSocketId(from);
    setCallInProgress(true);
    setIncomingCall(null);
    const pc = initializePeerConnection(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await processCandidates();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { to: from, answer });
  };

  const cleanupCall = () => {
    if (peerConnection.current) peerConnection.current.close();
    peerConnection.current = null;
    setCallInProgress(false);
    setRemoteSocketId(null);
    setConnectionStatus('');
    candidateQueue.current = [];
  };

  return (
    <div className="video-call-container">
      <h1>Video Call App</h1>
      <p>Status: <strong>{connectionStatus || 'Ready'}</strong></p>
      <div className="videos-grid">
        <div className="video-wrapper">
          <h3>You ({userId})</h3>
          <video ref={localVideoRef} autoPlay muted playsInline />
        </div>
        {callInProgress && (
          <div className="video-wrapper">
            <h3>Remote User</h3>
            <video ref={remoteVideoRef} autoPlay playsInline />
            <button onClick={cleanupCall} className="end-call-btn">End Call</button>
          </div>
        )}
      </div>
      {incomingCall && (
        <div className="incoming-call-overlay">
          <div className="incoming-call-modal">
            <h3>Incoming Call</h3>
            <button onClick={acceptCall} className="accept-btn">Accept</button>
            <button onClick={() => setIncomingCall(null)} className="reject-btn">Reject</button>
          </div>
        </div>
      )}
      {!callInProgress && (
        <div className="online-users-list">
          {onlineUsers.map(u => (
            <li key={u.socketId}>{u.userId} <button onClick={() => initiateCall(u.socketId)}>Call</button></li>
          ))}
        </div>
      )}
    </div>
  );
};

export default VideoCall;
