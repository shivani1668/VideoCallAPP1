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

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnection = useRef(null);
  const remoteSocketIdRef = useRef(null);

  // Sync ref with state
  useEffect(() => {
    remoteSocketIdRef.current = remoteSocketId;
  }, [remoteSocketId]);

  // Sync remote stream to video element
  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, callInProgress]);

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
        cleanupCall();
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
      cleanupCall();
    });
  }, [socket]);

  // Initialize Peer Connection
  const initializePeerConnection = (targetSocketId) => {
    const peerConn = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // FREE TURN SERVER (Relays data when direct connection fails)
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ]
    });

    // Add local tracks
    const localStream = localVideoRef.current?.srcObject;
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        peerConn.addTrack(track, localStream);
      });
    }

    // Handle remote tracks
    peerConn.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
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

    peerConn.onconnectionstatechange = () => {
      if (peerConn.connectionState === 'disconnected' ||
          peerConn.connectionState === 'failed' ||
          peerConn.connectionState === 'closed') {
        cleanupCall();
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
  };

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
  };

  return (
    <div className="video-call-container">
      <h1>Video Call App</h1>

      <div className="videos-grid">
        <div className="video-wrapper">
          <h3>You ({userId})</h3>
          <video ref={localVideoRef} autoPlay muted playsInline />
        </div>

        {callInProgress && (
          <div className="video-wrapper">
            <h3>Remote User</h3>
            <video ref={remoteVideoRef} autoPlay playsInline />
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
