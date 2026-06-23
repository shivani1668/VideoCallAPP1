# FaceLink 🤖📹

FaceLink is a modern, high-performance **Group Video Calling Application** built using the MERN stack, Socket.io, and WebRTC. It offers a sleek, dark-themed user interface with real-time communication features similar to Google Meet or Zoom.

## 🚀 Key Features

### 🎥 Video & Audio
*   **Group Video Calls**: Create or join custom rooms for multi-user conferencing.
*   **Mesh Networking**: P2P connections for low-latency video and audio.
*   **Media Controls**: Dedicated toggles for Mic (Mute/Unmute) and Video (On/Off).
*   **Camera Switching**: Seamlessly switch between front and back cameras on mobile devices.
*   **Video Mirroring**: Toggle mirrored view for your own local video.
*   **Mute Indicators**: Real-time visual icons showing which participants are currently muted.

### 💬 Real-Time Chat
*   **In-Call Messaging**: Sidebar chat interface for instant messaging during meetings.
*   **Notification Badges**: Visual alerts for unread messages when the chat sidebar is closed.
*   **IST Timestamps**: Indian Standard Time formatted messages.
*   **Auto-Scroll**: Intelligent scrolling that prioritizes new messages.

### 🛠 Technical Highlights
*   **Global Connectivity**: Integrated **TURN/STUN servers** (OpenRelay & Google) to bypass strict firewalls and support international calls.
*   **Stability**: Handshake queueing logic to prevent "black screen" bugs and connection collisions.
*   **Live Duration**: Real-time tracking of call duration for every participant.
*   **User Presence**: Live participant count display.
*   **Background Resilience**: Automatic media track resumption when returning to the app from the background.

## 💻 Tech Stack
*   **Frontend**: React.js, CSS3 (Mobile-first responsive design)
*   **Backend**: Node.js, Express.js
*   **Real-time**: Socket.io (Signaling & Chat)
*   **WebRTC**: Peer-to-peer media streaming

## 🛠 Local Setup

### 1. Clone the repository
```bash
git clone https://github.com/shivani1668/VideoCallAPP1.git
cd VideoCallAPP1
```

### 2. Backend Setup
```bash
cd server
npm install
node server.js
```

### 3. Frontend Setup
```bash
cd client
npm install
npm start
```

## 🌐 Deployment (Render)

### Backend (Web Service)
- **Root Directory**: `VideoCall/server`
- **Build Command**: `npm install`
- **Start Command**: `node server.js`

### Frontend (Static Site)
- **Root Directory**: `VideoCall/client`
- **Build Command**: `npm run build`
- **Publish Directory**: `build`
- **Env Variable**: `REACT_APP_SERVER_URL` = `YOUR_BACKEND_URL`

---
Developed with ❤️ in 2026.
