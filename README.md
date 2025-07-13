# Terminal to Web

A web-based terminal emulator that allows you to control your macOS terminal remotely from any device through a web browser.

## Features

- Real-time terminal access through web browser
- Mobile-friendly interface with virtual keyboard support
- Secure authentication with JWT tokens
- WebSocket-based communication for low latency
- Terminal resize support
- Session management

## Prerequisites

- Node.js 16+ 
- macOS (for the host machine)
- Xcode Command Line Tools (for node-pty compilation)

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```

## Configuration

1. Edit the `.env` file to set your security credentials:
   ```
   PORT=3000
   JWT_SECRET=your-secure-secret-key-here
   ACCESS_PASSWORD=your-access-password
   NODE_ENV=production
   ```

2. **Important**: Change the default values for security!

## Running the Server

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

## Accessing the Terminal

1. Open your browser and navigate to `http://your-server-ip:3000`
2. Enter the access password you set in `.env`
3. Click "Connect" to access your terminal

### From Mobile Devices

- The interface is optimized for mobile devices
- Virtual keyboard will appear automatically on touch devices
- Pinch to zoom is disabled for better terminal experience

## Security Considerations

1. **Always use HTTPS in production** - Set up a reverse proxy with nginx or similar
2. **Change default passwords** - Never use the default JWT secret or access password
3. **Firewall** - Only expose the port to trusted networks
4. **Network** - Consider using a VPN for remote access

## Nginx Configuration Example

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Troubleshooting

### node-pty compilation errors on macOS
Make sure you have Xcode Command Line Tools installed:
```bash
xcode-select --install
```

### Terminal doesn't appear
- Check browser console for errors
- Ensure WebSocket connections are allowed
- Verify the server is running and accessible

### Authentication issues
- Check that the password matches the one in `.env`
- Clear browser localStorage if you have old tokens

## Development

The project structure:
```
terminal-to-web/
├── src/
│   ├── server.ts         # Main server file
│   ├── terminalHandler.ts # Terminal PTY management
│   └── middleware/
│       └── auth.ts       # JWT authentication
├── public/               # Frontend files
│   ├── index.html
│   ├── app.js
│   └── style.css
└── package.json
```

## License

ISC