# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Terminal-to-Web is a web-based terminal emulator that enables remote control of a macOS terminal from any device through a web browser. The application provides secure terminal access with mobile-optimized interface and real-time communication.

## Architecture

The application follows a client-server architecture with WebSocket communication:

### Backend Architecture (Node.js + TypeScript)
- **Server Entry Point**: `src/server.ts` - Express server with Socket.IO integration
- **Terminal Management**: `src/terminalHandler.ts` - Manages PTY processes using node-pty
- **Authentication**: `src/middleware/auth.ts` - JWT-based WebSocket authentication
- **Security**: `src/utils/security.ts` - Rate limiting and IP-based attack prevention
- **Static Files**: Serves frontend from `public/` directory

### Frontend Architecture (Vanilla JS)
- **Terminal Emulation**: Uses xterm.js for browser-based terminal rendering
- **Communication**: Socket.IO client for real-time terminal I/O
- **Mobile Support**: Responsive design with virtual keyboard and touch controls
- **Quick Commands**: Local storage-based command shortcuts system

### Key Data Flow
1. Client authenticates with password → JWT token issued
2. WebSocket connection established with JWT validation
3. PTY process spawned for authenticated client
4. Bidirectional terminal data flows through Socket.IO events
5. Terminal resize/input events synchronized between client and PTY

## Development Commands

### Local Development
```bash
npm run dev          # Start development server with hot reload
npm run build        # Compile TypeScript to dist/
npm start           # Run production build
```

### Remote Access Setup
```bash
./setup-cloudflare.sh                    # Configure Cloudflare Tunnel
cloudflared tunnel --url http://localhost:3000  # Quick tunnel
```

## Configuration

### Required Environment Variables (.env)
- `PORT` - Server port (default: 3000)
- `JWT_SECRET` - Secret for JWT token signing (CHANGE IN PRODUCTION)
- `ACCESS_PASSWORD` - Authentication password (CHANGE IN PRODUCTION)
- `NODE_ENV` - Environment (development/production)

### Security Considerations
- Default credentials in `.env` must be changed for production use
- Rate limiting: 5 authentication attempts per 15 minutes per IP
- JWT tokens expire after 24 hours
- WebSocket authentication required for all terminal operations

## Mobile-Specific Features

The frontend includes extensive mobile optimization:

### Mobile Controls (`public/app.js` - QuickCommands class)
- Virtual control panel with Ctrl/Alt/Tab/Esc buttons
- Arrow key navigation panel
- Quick command shortcuts stored in localStorage
- Responsive font sizing based on device orientation

### Browser Compatibility
- ES5-compatible JavaScript for older mobile browsers
- Fallback CSS with vendor prefixes
- Text-based button labels instead of emoji for universal support

## Key Components

### Terminal Session Management (`src/terminalHandler.ts`)
- One PTY process per WebSocket connection
- Automatic cleanup on client disconnect
- Dynamic terminal resizing support
- Cross-platform shell detection (bash/powershell)

### Authentication Flow (`src/middleware/auth.ts`)
- Password-based initial authentication via REST endpoint
- JWT token stored in client localStorage
- WebSocket connections validated with JWT in handshake
- Per-user session tracking

### Security Implementation (`src/utils/security.ts`)
- In-memory rate limiting (no external dependencies)
- IP-based attempt tracking with automatic cleanup
- Failed attempt logging and progressive lockout

## Remote Access Options

The application supports multiple remote access methods documented in `REMOTE_ACCESS.md`:
1. Cloudflare Tunnel (recommended) - Zero-config public access
2. Ngrok - Simple development tunneling
3. VPS + Nginx - Production deployment with custom domain

Each method requires the server to be running locally and provides HTTPS access from anywhere.