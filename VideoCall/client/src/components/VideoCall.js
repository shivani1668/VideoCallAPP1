import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import './VideoCall.css';

// Helper to format duration in seconds to MM:SS
const formatDuration = (seconds) => {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// Timer Component to show duration
const DurationTimer = ({ startTime }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  return <span className="duration-text">{formatDuration(elapsed)}</span>;
};

const VideoCall = ({ userName, roomId, onLeave }) => {
  const [socket, setSocket] = useState(null);
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('Initializing...');
  const [roomStartTime] = useState(Date.now());

  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isMirrored, setIsMirrored] = useState(true);
  const [facingMode, setFacingMode] = useState('user');

  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const candidateQueues = useRef({});
  const chatEndRef = useRef(null);

  // Instant scroll on open, smooth scroll on new message
  useEffect(() => {
    if (isChatOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'auto' });
      setUnreadCount(0);
    }
  }, [isChatOpen]);

  useEffect(() => {
    if (isChatOpen && messages.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isChatOpen]);

  // Handle Visibility Change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => {
            track.enabled = true;
          });
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const getLocalStream = async (mode = 'user') => {
    try {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode },
        audio: true
      });

      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      Object.values(peersRef.current).forEach(pc => {
        const senders = pc.getSenders();
        const vSender = senders.find(s => s.track && s.track.kind === 'video');
        const aSender = senders.find(s => s.track && s.track.kind === 'audio');
        if (vSender) vSender.replaceTrack(stream.getVideoTracks()[0]);
        if (aSender) aSender.replaceTrack(stream.getAudioTracks()[0]);
      });

      return stream;
    } catch (e) {
      setConnectionStatus('Camera Error');
    }
  };

  useEffect(() => {
    const init = async () => {
      await getLocalStream(facingMode);
      const serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';
      const newSocket = io(serverUrl);
      setSocket(newSocket);

      newSocket.on('connect', () => {
        setConnectionStatus('Room: ' + roomId);
        newSocket.emit('join-room', { roomId, userName });
      });
    };
    init();
    return () => { if (socket) socket.disconnect(); };
  }, [roomId, userName]);

  useEffect(() => {
    if (!socket) return;

    socket.on('all-users', (users) => {
      users.forEach(user => {
        if (peersRef.current[user.socketId]) return;
        setRemoteUsers(prev => {
          if (prev.find(u => u.socketId === user.socketId)) return prev;
          return [...prev, { socketId: user.socketId, userName: user.userName, stream: null, joinedAt: Date.now(), isMuted: false }];
        });
        const pc = createPeer(user.socketId, user.userName, true);
        peersRef.current[user.socketId] = pc;
      });
    });

    socket.on('user-joined', ({ socketId, userName }) => {
      if (peersRef.current[socketId]) return;
      setRemoteUsers(prev => {
        if (prev.find(u => u.socketId === socketId)) return prev;
        return [...prev, { socketId: socketId, userName, stream: null, joinedAt: Date.now(), isMuted: false }];
      });
      const pc = createPeer(socketId, userName, false);
      peersRef.current[socketId] = pc;
    });

    socket.on('user-mute-status', ({ socketId, isMuted }) => {
      setRemoteUsers(prev => prev.map(u =>
        u.socketId === socketId ? { ...u, isMuted } : u
      ));
    });

    socket.on('receive-message', (msg) => {
      setMessages(prev => [...prev, msg]);
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
      socket.off('user-mute-status');
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

  const switchCamera = async () => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    await getLocalStream(newMode);
  };

  const handleLeave = () => {
    if (socket) socket.emit('leave-room');
    Object.values(peersRef.current).forEach(pc => pc.close());
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
    }
    onLeave();
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const newMuteStatus = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);

        // Notify others about mute status
        if (socket) {
          socket.emit('toggle-mute', { roomId, isMuted: newMuteStatus });
        }
      }
    }
  };

  return (
    <div className="video-call-container">
      <div className="main-content">
        <div className="video-section">
          <div className="videos-grid">
            <div className={`video-wrapper ${isMirrored ? 'mirrored' : ''}`}>
              <div className="video-header">
                <h3>You ({userName}) {!isMicOn && <span className="mute-indicator">🔇</span>}</h3>
                <DurationTimer startTime={roomStartTime} />
              </div>
              <video ref={localVideoRef} autoPlay muted playsInline />
            </div>
            {remoteUsers.map(user => (
              <RemoteVideo key={user.socketId} user={user} />
            ))}
          </div>
        </div>

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

      <div className="footer-bar">
        <div className="left-info">
          <div className="room-info-footer">{connectionStatus}</div>
          <div className="user-count-badge">👥 {remoteUsers.length + 1}</div>
        </div>
        <div className="center-controls">
          <button className={`footer-btn ${!isMicOn ? 'off' : ''}`} onClick={toggleMic}>
            {isMicOn ? '🎤' : '🔇'}
          </button>
          <button className={`footer-btn ${!isVideoOn ? 'off' : ''}`} onClick={() => {
            localStreamRef.current.getVideoTracks()[0].enabled = !isVideoOn;
            setIsVideoOn(!isVideoOn);
          }}>
            {isVideoOn ? '📹' : '❌'}
          </button>
          <button className="footer-btn" onClick={switchCamera} title="Switch Camera">🔄</button>
          <button className={`footer-btn ${isMirrored ? 'active' : ''}`} onClick={() => setIsMirrored(!isMirrored)} title="Mirror View">🪞</button>
          <button className="footer-btn end" onClick={handleLeave}>📞</button>
        </div>
        <div className="right-controls">
          <button className={`footer-btn chat-toggle-btn ${isChatOpen ? 'active' : ''}`} onClick={() => setIsChatOpen(!isChatOpen)}>
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
      <div className="video-header">
        <h3>{user.userName} {user.isMuted && <span className="mute-indicator">🔇</span>}</h3>
        <DurationTimer startTime={user.joinedAt} />
      </div>
      {!user.stream && <div className="loading-spinner">Connecting...</div>}
      <video ref={videoRef} autoPlay playsInline />
    </div>
  );
};

export default VideoCall;
