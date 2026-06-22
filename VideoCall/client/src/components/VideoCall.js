import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import './VideoCall.css';

const VideoCall = ({ userName, roomId, onLeave }) => {
  const [socket, setSocket] = useState(null);
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('Initializing Media...');

  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);

  // Chat States
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const candidateQueues = useRef({});
  const chatEndRef = useRef(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Reset unread count when chat is opened
  useEffect(() => {
    if (isChatOpen) {
      setUnreadCount(0);
    }
  }, [isChatOpen]);

  // 1. Setup Local Stream FIRST
  useEffect(() => {
    const getLocalStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        setConnectionStatus('Connecting...');
        const serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';
        const newSocket = io(serverUrl);
        setSocket(newSocket);

        newSocket.on('connect', () => {
          setConnectionStatus('Room: ' + roomId);
          newSocket.emit('join-room', { roomId, userName });
        });

      } catch (e) {
        console.error("Media error", e);
        setConnectionStatus('Camera Error');
      }
    };
    getLocalStream();

    return () => {
      if (socket) socket.disconnect();
    };
  }, [roomId, userName]);

  // 2. Signaling & Chat Logic
  useEffect(() => {
    if (!socket) return;

    socket.on('all-users', (users) => {
      users.forEach(user => {
        setRemoteUsers(prev => [...prev, { socketId: user.socketId, userName: user.userName, stream: null }]);
        const pc = createPeer(user.socketId, user.userName, true);
        peersRef.current[user.socketId] = pc;
      });
    });

    socket.on('user-joined', ({ socketId, userName }) => {
      setRemoteUsers(prev => [...prev, { socketId, userName, stream: null }]);
      const pc = createPeer(socketId, userName, false);
      peersRef.current[socketId] = pc;
    });

    socket.on('receive-message', (msg) => {
      setMessages(prev => [...prev, msg]);
      // Increment unread count if chat is closed and message is not from self
      if (!isChatOpen && msg.senderName !== userName) {
        setUnreadCount(prev => prev + 1);
      }
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
      } catch (err) { console.error("Offer error", err); }
    });

    socket.on('answer', async ({ from, answer }) => {
      const pc = peersRef.current[from];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
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
      socket.off('receive-message');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('user-left');
    };
  }, [socket, isChatOpen, userName]);

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
      setRemoteUsers(prev => prev.map(u => u.socketId === targetSocketId ? { ...u, stream: e.streams[0] } : u));
    };

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

  const sendMessage = (e) => {
    e.preventDefault();
    if (newMessage.trim() && socket) {
      socket.emit('send-message', { text: newMessage, senderName: userName });
      setNewMessage('');
    }
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
      <div className="main-content">
        <div className="video-section">
          <div className="videos-grid">
            {/* Local Video */}
            <div className="video-wrapper">
              <div className="video-header"><h3>You ({userName})</h3></div>
              <video ref={localVideoRef} autoPlay muted playsInline />
            </div>

            {/* Remote Videos */}
            {remoteUsers.map(user => (
              <RemoteVideo key={user.socketId} user={user} />
            ))}
          </div>
        </div>

        {/* Chat Sidebar */}
        {isChatOpen && (
          <div className="chat-sidebar">
            <div className="chat-header">
              <h3>In-call messages</h3>
              <button className="close-chat" onClick={() => setIsChatOpen(false)}>✕</button>
            </div>
            <div className="chat-messages">
              {messages.map((msg, i) => (
                <div key={i} className={`message ${msg.senderName === userName ? 'own' : ''}`}>
                  <div className="message-info">{msg.senderName} • {msg.timestamp}</div>
                  <div className="message-text">{msg.text}</div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form className="chat-input-area" onSubmit={sendMessage}>
              <input
                type="text"
                placeholder="Send a message"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
              />
              <button type="submit" className="send-btn">➤</button>
            </form>
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <div className="footer-bar">
        <div className="left-info">
          <div className="room-info-footer">{connectionStatus}</div>
          <div className="user-count-badge">👥 {remoteUsers.length + 1}</div>
        </div>
        <div className="center-controls">
          <button className={`footer-btn ${!isMicOn ? 'off' : ''}`} onClick={toggleMic}>
            {isMicOn ? '🎤' : '🔇'}
          </button>
          <button className={`footer-btn ${!isVideoOn ? 'off' : ''}`} onClick={toggleVideo}>
            {isVideoOn ? '📹' : '❌'}
          </button>
          <button className="footer-btn end" onClick={handleLeave}>📞</button>
        </div>
        <div className="right-controls">
          <button
            className={`footer-btn chat-toggle-btn ${isChatOpen ? 'active' : ''}`}
            onClick={() => setIsChatOpen(!isChatOpen)}
          >
            💬
            {unreadCount > 0 && <span className="unread-badge">{unreadCount}</span>}
          </button>
        </div>
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
      {!user.stream && <div className="loading-spinner">Connecting Video...</div>}
      <video ref={videoRef} autoPlay playsInline />
    </div>
  );
};

export default VideoCall;
