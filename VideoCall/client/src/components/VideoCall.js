import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import './VideoCall.css';

const VideoCall = ({ userId }) => {
  const [socket, setSocket] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [callInProgress, setCallInProgress] = useState(false);
  const [remoteSocketId, setRemoteSocketId] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('');

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnection = useRef(null);
  const remoteSocketIdRef = useRef(null);

  useEffect(() => {
    remoteSocketIdRef.current = remoteSocketId;
  }, [remoteSocketId]);

  // This ensures the remote video starts playing as soon as the stream arrives
  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(e => console.log("Playback error:", e));
    }
  }, [remoteStream, callInProgress]);

  useEffect(() => {
    const serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';
    const newSocket = io(serverUrl);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('join', userId);
    });

    newSocket.on('online-users', (users) => {
      setOnlineUsers(users);
    });

    newSocket.on('user-joined', (data) => {
      setOnlineUsers((prev) => [...prev, data]);
    });

    newSocket.on('user-left', (socketId) => {
      setOnlineUsers((prev) => prev.filter((u) => u.socketId !== socketId));
      if (remoteSocketIdRef.current === socketId) {
        cleanupCall();
      }
    });

    return () => newSocket.disconnect();
  }, [userId]);

  useEffect(() => {
    const getLocalStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (error) {
        console.error('Error accessing media devices:', error);
      }
    };
    getLocalStream();
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on('offer', (data) => {
      setIncomingCall(data);
    });

    socket.on('answer', async (data) => {
      if (peerConnection.current) {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });

    socket.on('ice-candidate', async (data) => {
      if (data.candidate && peerConnection.current) {
        try {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error("ICE error", e);
        }
      }
    });

    socket.on('call-ended', () => {
      cleanupCall();
    });
  }, [socket]);

  const initializePeerConnection = (targetSocketId) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ]
    });

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    const localStream = localVideoRef.current?.srcObject;
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          to: targetSocketId,
          candidate: event.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      setConnectionStatus(pc.connectionState);
    };

    peerConnection.current = pc;
    return pc;
  };

  const initiateCall = async (targetSocketId) => {
    setRemoteSocketId(targetSocketId);
    setCallInProgress(true);
    const pc = initializePeerConnection(targetSocketId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { to: targetSocketId, offer });
  };

  const acceptCall = async () => {
    const { from, offer } = incomingCall;
    setRemoteSocketId(from);
    setCallInProgress(true);
    setIncomingCall(null);
    const pc = initializePeerConnection(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { to: from, answer });
  };

  const rejectCall = () => setIncomingCall(null);

  const endCall = () => {
    if (socket && remoteSocketIdRef.current) {
      socket.emit('end-call', { to: remoteSocketIdRef.current });
    }
    cleanupCall();
  };

  const cleanupCall = () => {
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    setCallInProgress(false);
    setRemoteSocketId(null);
    setRemoteStream(null);
    setConnectionStatus('');
  };

  return (
    <div className="video-call-container">
      <h1>Video Call App</h1>
      {connectionStatus && <p style={{color: 'green'}}>Connection: {connectionStatus}</p>}

      <div className="videos-grid">
        <div className="video-wrapper">
          <h3>You ({userId})</h3>
          <video ref={localVideoRef} autoPlay muted playsInline />
        </div>

        {callInProgress && (
          <div className="video-wrapper">
            <h3>Remote User</h3>
            {/* Added muted temporarily to help auto-play work */}
            <video ref={remoteVideoRef} autoPlay playsInline muted />
            <p style={{fontSize: '10px'}}>Remote video muted for auto-play</p>
            <button onClick={endCall} className="end-call-btn" style={{ marginTop: '10px' }}>
              End Call
            </button>
          </div>
        )}
      </div>

      {incomingCall && (
        <div className="incoming-call-overlay">
          <div className="incoming-call-modal">
            <h3>Incoming Call from {incomingCall.fromName || 'Someone'}</h3>
            <div style={{ marginTop: '20px' }}>
              <button onClick={acceptCall} className="accept-btn">Accept</button>
              <button onClick={rejectCall} className="reject-btn">Reject</button>
            </div>
          </div>
        </div>
      )}

      {!callInProgress && (
        <div className="online-users-list">
          <h3>Online Users</h3>
          {onlineUsers.length === 0 ? <p>No other users online</p> : (
            <ul>
              {onlineUsers.map((user) => (
                <li key={user.socketId}>
                  <span>{user.userId}</span>
                  <button onClick={() => initiateCall(user.socketId)}>Call</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default VideoCall;
