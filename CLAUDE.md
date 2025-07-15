# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TerminalFlow is a modern web-based terminal emulator that enables remote control of a macOS terminal from any device through a web browser. The application uses email-based two-factor authentication with one-time access codes for security.

## Architecture

### Backend Architecture (Node.js + TypeScript)
- **Server Entry Point**: `src/server.ts` - Express server with Socket.IO integration and email authentication endpoints
- **Configuration**: `src/config.ts` - Centralized configuration with environment variable validation
- **Service Layer**: 
  - `src/services/TerminalManager.ts` - PTY process management with node-pty and directory tracking
  - `src/services/AccessCodeService.ts` - Generates/validates 6-digit access codes
  - `src/services/CommandService.ts` - Persistent command storage per user
  - `src/services/ResendEmailService.ts` - Email service using Resend API (primary)
  - `src/services/EmailService.ts` - Gmail SMTP fallback service
- **Security Layer**:
  - `src/middleware/auth.ts` - JWT-based WebSocket authentication
  - `src/utils/security.ts` - Rate limiting with IP tracking and progressive lockout
  - `src/utils/validation.ts` - Input validation and XSS protection

### Frontend Architecture (Multiple UIs)
- **Authentication Page** (`public/index.html`): Modern dark theme with mobile optimization
- **IDE Interface** (`public/terminal.html`): Full IDE with file explorer, tabs, and terminal
- **Terminal Emulation**: xterm.js with fit addon for browser-based terminal
- **Communication**: Socket.IO client for real-time bidirectional terminal I/O
- **Mobile Controls**: Touch-friendly virtual controls with arrow keys and modifiers

### Email Authentication Flow
1. User requests access code via `/auth/request-code` endpoint
2. 6-digit code generated (10-minute expiry) and sent via email
3. User enters code via `/auth/token` endpoint  
4. JWT token issued upon successful validation
5. WebSocket authentication uses JWT for terminal access
6. All terminal operations require valid JWT token

## Development Commands

### Local Development
```bash
npm run dev              # Start with nodemon hot reload
npm run start:dev        # Start server + Cloudflare tunnel concurrently
npm run build            # Compile TypeScript to dist/
npm start               # Run production build
npm run start:all       # Build + start server + tunnel concurrently
```

### Code Quality
```bash
npm run lint            # ESLint check
npm run lint:fix        # Auto-fix linting issues
npm run format          # Prettier formatting
npm run typecheck       # TypeScript type checking without emit
```

### Production Deployment
```bash
# Run type checks before building
npm run typecheck && npm run build && npm start
```

## Environment Configuration (.env)

### Required Variables
```bash
# Security (MUST CHANGE FOR PRODUCTION)
JWT_SECRET=at-least-32-character-secret-key
ACCESS_PASSWORD=change-this-secure-password  # Legacy, kept for compatibility

# Email Service (Resend - 3000 emails/month free)
RESEND_API_KEY=re_xxxxxxxxxx
NOTIFICATION_EMAIL=your-email@domain.com

# Gmail Fallback (if Resend not configured)
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASSWORD=gmail-app-password
```

### Optional Variables
```bash
PORT=3000
NODE_ENV=development
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_TIME_MINUTES=15
JWT_EXPIRES_IN=24h
ACCESS_CODE_EXPIRY_MINUTES=10
```

## Security Architecture

### Rate Limiting
- 5 authentication attempts per IP per 15 minutes
- Automatic cleanup of expired attempts
- Progressive lockout with exponential backoff
- IP-based tracking in memory (no external dependencies)

### Access Code System
- 6-digit numeric codes with 10-minute expiry
- One active code per email at a time  
- IP validation (optional strict mode)
- Automatic cleanup of expired codes

### JWT Implementation
- 24-hour token expiry (configurable)
- Secure signing with minimum 32-character secret
- WebSocket authentication middleware validates all connections
- Graceful token refresh handling

## Mobile Optimization

### Virtual Controls (`public/app.js`)
- **Control Panel**: Ctrl/Alt/Tab/Esc virtual buttons
- **Arrow Keys**: Dedicated navigation panel  
- **Quick Commands**: Persistent localStorage-based command shortcuts
- **Responsive Design**: Font sizing adapts to device orientation
- **Touch Support**: Virtual keyboard integration for mobile browsers

### Browser Compatibility
- ES5-compatible JavaScript for older mobile browsers
- Vendor-prefixed CSS for maximum compatibility
- Graceful degradation for unsupported features
- Touch event handling with fallbacks

## Service Layer Architecture

### TerminalManager (`src/services/TerminalManager.ts`)
- Singleton pattern for shared terminal management
- PTY process lifecycle management with directory tracking
- Environment variable filtering for security
- Cross-platform shell detection
- Real-time current directory detection using PWD markers

### Email Services
- **Primary**: ResendEmailService with HTML email templates
- **Fallback**: EmailService using Gmail SMTP with App Passwords
- Development mode shows codes in console when email not configured
- Automatic service selection based on environment variables

### Access Code Service
- In-memory code storage with automatic expiry
- Thread-safe code generation and validation
- IP-based security checks
- Comprehensive logging and monitoring

## Remote Access Setup

### Cloudflare Tunnel (Recommended)
```bash
# Named tunnel (production)
npm run start:all        # Uses configured tunnel from ~/.cloudflared/config.yml

# Quick tunnel (development)
cloudflared tunnel --url localhost:3000
```

### Email Service Setup
1. **Resend** (recommended): Register at resend.com, get API key
2. **Gmail**: Enable 2FA, create App Password for SMTP access
3. Development mode works without email configuration (codes in console)

## User Session and Command Management

### Persistent User Sessions
- User identity based on email hash (SHA256, first 16 chars) for cross-session persistence
- JWT tokens contain persistent `userId` allowing command access from any device
- Commands are stored per-user in `data/commands.json` with automatic file management

### Command Storage Architecture (`src/services/CommandService.ts`)
- File-based storage with in-memory Map for performance
- Default commands automatically created for new users
- Thread-safe operations with atomic file writes
- Commands include: id, cmd, desc, userId, createdAt, updatedAt

### File System Integration (`src/terminalHandler.ts`)
- Real-time file explorer with directory following
- Terminal current directory detection using PWD markers
- File read/write operations scoped to terminal session
- Automatic directory synchronization between terminal and file explorer

## Key Implementation Details

### Error Handling
- Centralized error middleware in `src/middleware/errorHandler.ts`
- Structured logging with request context
- Graceful degradation for email service failures
- Client-side error boundaries for WebSocket failures

### TypeScript Configuration
- Strict mode enabled with comprehensive type checking
- ES2020 target for modern Node.js features  
- Absolute imports from src/ directory
- Development build uses ts-node for hot reload

### Frontend State Management
- JWT tokens stored in localStorage with automatic cleanup
- Terminal state synchronized via Socket.IO events
- Mobile controls use event delegation for performance
- Quick commands persist across browser sessions

## Speech-to-Text Integration

### Groq API Integration (`src/services/SpeechService.ts`)
- Real-time speech transcription using Groq's Whisper models
- Automatic language detection with ISO-639-1 code conversion
- Model selection: `whisper-large-v3` for non-English, `whisper-large-v3-turbo` for English
- Singleton pattern with graceful error handling and logging

### Speech UI Components (`public/terminal.html`, `public/ide-app.js`)
- **Floating Microphone Button**: Click-to-record interface positioned center-bottom
- **Processing Overlay**: Compact, animated status display during transcription
- **Mobile Optimization**: Touch-friendly controls with proper positioning
- **Auto-hide Logic**: Button hidden when `GROQ_API_KEY` not configured

### Speech API Endpoints (`src/server.ts`)
- `/api/speech/status` - Check service availability and API key presence
- `/api/speech/detect-language` - Language detection from audio buffer
- `/api/speech/transcribe` - Audio transcription with language specification
- `/api/speech/speech-to-text` - Combined detect + transcribe workflow
- File upload via multer with 25MB limit, supports multiple audio formats

### Speech Configuration
```bash
# Optional - Speech-to-Text via Groq API
GROQ_API_KEY=gsk_your_groq_api_key_here
```

### Speech Workflow
1. User clicks microphone button to start/stop recording
2. Audio captured via MediaRecorder API (WebM/WAV format)
3. Language auto-detected using Whisper model
4. Text transcribed in original language (no translation)
5. Transcribed text inserted directly into active terminal
6. Visual feedback throughout process with cancel option