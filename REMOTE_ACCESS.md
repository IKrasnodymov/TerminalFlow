# Remote Terminal Access

## Method 1: Cloudflare Tunnel (Recommended)

### Installation and Setup:

1. **Run the setup script:**
   ```bash
   ./setup-cloudflare.sh
   ```

2. **Start the server:**
   ```bash
   npm run dev
   ```

3. **In a new terminal, run the tunnel:**
   ```bash
   cloudflared tunnel run terminal-web-[timestamp]
   ```

4. **Access from anywhere in the world:**
   - URL will be shown in console
   - Example: `https://terminal-you.trycloudflare.com`

## Method 2: Ngrok (Simple Option)

```bash
# Installation
brew install ngrok

# Run
ngrok http 3000

# Use the provided URL
```

## Method 3: VPS + Nginx

If you have a VPS server:

1. **On VPS create file** `/etc/nginx/sites-available/terminal`:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://your-home-ip:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

2. **Configure port forwarding** on home router:
   - External port: 3000
   - Internal port: 3000
   - IP: 192.168.0.105

## Security for Remote Access

### Must do:

1. **Change passwords in .env:**
   ```
   JWT_SECRET=very-long-random-key
   ACCESS_PASSWORD=strong-password
   ```

2. **Use fail2ban** (for VPS):
   ```bash
   sudo apt install fail2ban
   ```

3. **Limit access by IP** (if possible):
   ```typescript
   const ALLOWED_IPS = ['your.work.ip', 'your.home.ip'];
   ```

4. **Enable two-factor authentication** (optional)

### Additional Security Measures:

- Rate limiting is already enabled (5 attempts per 15 minutes)
- Use strong passwords (minimum 16 characters)
- Regularly check access logs
- Use VPN for additional protection

## Monitoring

To track connections add to .env:
```
LOG_CONNECTIONS=true
```

Logs will be saved in `logs/access.log`