# MERN Video Call App

A simple video calling application using React, Node.js, Socket.io, and WebRTC.

## Local Setup

### Backend
1. `cd server`
2. `npm install`
3. `node server.js`

### Frontend
1. `cd client`
2. `npm install`
3. `npm start`

## Deployment (Render)

### Backend (Web Service)
- **Root Directory**: `server`
- **Build Command**: `npm install`
- **Start Command**: `node server.js`

### Frontend (Static Site)
- **Root Directory**: `client`
- **Build Command**: `npm run build`
- **Publish Directory**: `build`
- **Environment Variables**:
  - `REACT_APP_SERVER_URL`: Your deployed backend URL (e.g., `https://your-app.onrender.com`)
