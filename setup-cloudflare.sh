#!/bin/bash

echo "=== Cloudflare Tunnel Setup for Terminal Web ==="
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "Installing cloudflared..."
    brew install cloudflare/cloudflare/cloudflared
fi

# Login to Cloudflare
echo "Please login to your Cloudflare account:"
cloudflared tunnel login

# Create tunnel
echo ""
echo "Creating tunnel..."
TUNNEL_NAME="terminal-web-$(date +%s)"
cloudflared tunnel create $TUNNEL_NAME

# Create config directory
mkdir -p ~/.cloudflared

# Get tunnel ID
TUNNEL_ID=$(cloudflared tunnel list | grep $TUNNEL_NAME | awk '{print $1}')

# Create config file
cat > ~/.cloudflared/config.yml << EOF
tunnel: $TUNNEL_ID
credentials-file: /Users/$USER/.cloudflared/$TUNNEL_ID.json

ingress:
  - hostname: terminal-$USER.trycloudflare.com
    service: http://localhost:3000
  - service: http_status:404
EOF

echo ""
echo "Tunnel created! To run your terminal remotely:"
echo ""
echo "1. Start your terminal server:"
echo "   npm run dev"
echo ""
echo "2. In another terminal, start the tunnel:"
echo "   cloudflared tunnel run $TUNNEL_NAME"
echo ""
echo "3. Your terminal will be available at:"
echo "   https://terminal-$USER.trycloudflare.com"
echo ""
echo "Note: For production, you should use your own domain!"