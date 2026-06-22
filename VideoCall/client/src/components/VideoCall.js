import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import './VideoCall.css';

const VideoCall = ({ userId }) => {
  const [socket, setSocket] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [callInProgress, setCallInProgress] = useState(false);
  const [remoteSocketId, setRemoteSocketId] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnection = useRef(null);
  const remoteSocketIdRef = useRef(null);

  // Sync ref with state
  useEffect(() => {
    remoteSocketIdRef.current = remoteSocketId;
  }, [remoteSocketId]);

  // Initialize Socket.io
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
        endCall();
      }
    });

    return () => newSocket.disconnect();
  }, [userId]);

  // Setup local video stream
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

  // Handle WebRTC signaling
  useEffect(() => {
    if (!socket) return;

    socket.on('offer', (data) => {
      setIncomingCall(data);
    });

    socket.on('answer', async (data) => {
      if (peerConnection.current) {
        await peerConnection.current.setRemoteDescription(
          new RTCSessionDescription(data.answer)
        );
      }
    });

    socket.on('ice-candidate', async (data) => {
      if (data.candidate && peerConnection.current) {
        try {
          await peerConnection.current.addIceCandidate(
            new RTCIceCandidate(data.candidate)
          );
        } catch (error) {
          console.error('Error adding ICE candidate:', error);
        }
      }
    });

    socket.on('call-ended', () => {
      handleRemoteHangup();
    });
  }, [socket]);

  // Initialize Peer Connection
  const initializePeerConnection = (targetSocketId) => {
    const peerConn = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // Add local stream
    const stream = localVideoRef.current.srcObject;
    if (stream) {
      stream.getTracks().forEach((track) => {
        peerConn.addTrack(track, stream);
      });
    }

    // Handle remote stream
    peerConn.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    // Handle ICE candidates
    peerConn.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          to: targetSocketId,
          candidate: event.candidate
        });
      }
    };

    // Handle connection state changes
    peerConn.onconnectionstatechange = () => {
      if (peerConn.connectionState === 'disconnected' ||
          peerConn.connectionState === 'failed' ||
          peerConn.connectionState === 'closed') {
        handleRemoteHangup();
      }
    };

    peerConnection.current = peerConn;
  };

  // Initiate call
  const initiateCall = async (targetSocketId) => {
    setRemoteSocketId(targetSocketId);
    setCallInProgress(true);

    initializePeerConnection(targetSocketId);

    const offer = await peerConnection.current.createOffer();
    await peerConnection.current.setLocalDescription(offer);

    socket.emit('offer', { to: targetSocketId, offer });
  };

  // Accept call
  const acceptCall = async () => {
    const { from, offer } = incomingCall;
    setRemoteSocketId(from);
    setCallInProgress(true);
    setIncomingCall(null);

    initializePeerConnection(from);

    await peerConnection.current.setRemoteDescription(
      new RTCSessionDescription(offer)
    );

    const answer = await peerConnection.current.createAnswer();
    await peerConnection.current.setLocalDescription(answer);

    socket.emit('answer', { to: from, answer });
  };

  // Reject call
  const rejectCall = () => {
    setIncomingCall(null);
    // Optionally notify the caller that the call was rejected
  };

  // End call (Local)
  const endCall = () => {
    if (socket && remoteSocketIdRef.current) {
      socket.emit('end-call', { to: remoteSocketIdRef.current });
    }
    cleanupCall();
  };

  // Handle remote side hanging up
  const handleRemoteHangup = () => {
    cleanupCall();
  };

  // Shared cleanup logic
  const cleanupCall = () => {
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    setCallInProgress(false);
    setRemoteSocketId(null);
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  return (
    <div className="video-call-container">
      <h1>Video Call App</h1>

      <div className="videos-grid">
        {/* Local Video */}
        <div className="video-wrapper">
          <h3>You ({userId})</h3>
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
          />
        </div>

        {/* Remote Video */}
        {callInProgress && (
          <div className="video-wrapper">
            <h3>Remote User</h3>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
            />
            <button onClick={endCall} className="end-call-btn" style={{ marginTop: '10px' }}>
              End Call
            </button>
          </div>
        )}
      </div>

      {/* Incoming Call Notification */}
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

      {/* Online Users List */}
      {!callInProgress && (
        <div className="online-users-list">
          <h3>Online Users</h3>
          {onlineUsers.length === 0 ? (
            <p>No other users online</p>
          ) : (
            <ul>
              {onlineUsers.map((user) => (
                <li key={user.socketId}>
                  <span>{user.userId}</span>
                  <button
                    onClick={() => initiateCall(user.socketId)}
                    disabled={callInProgress || incomingCall}
                  >
                    Call
                  </button>
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
