# Удаленный доступ к терминалу

## Способ 1: Cloudflare Tunnel (Рекомендуется)

### Установка и настройка:

1. **Запустите скрипт установки:**
   ```bash
   ./setup-cloudflare.sh
   ```

2. **Запустите сервер:**
   ```bash
   npm run dev
   ```

3. **В новом терминале запустите туннель:**
   ```bash
   cloudflared tunnel run terminal-web-[timestamp]
   ```

4. **Доступ из любой точки мира:**
   - URL будет показан в консоли
   - Например: `https://terminal-you.trycloudflare.com`

## Способ 2: Ngrok (Простой вариант)

```bash
# Установка
brew install ngrok

# Запуск
ngrok http 3000

# Используйте предоставленный URL
```

## Способ 3: VPS + Nginx

Если у вас есть VPS сервер:

1. **На VPS создайте файл** `/etc/nginx/sites-available/terminal`:
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

2. **Настройте проброс портов** на домашнем роутере:
   - Внешний порт: 3000
   - Внутренний порт: 3000
   - IP: 192.168.0.105

## Безопасность при удаленном доступе

### Обязательно сделайте:

1. **Смените пароли в .env:**
   ```
   JWT_SECRET=очень-длинный-случайный-ключ
   ACCESS_PASSWORD=сложный-пароль
   ```

2. **Используйте fail2ban** (для VPS):
   ```bash
   sudo apt install fail2ban
   ```

3. **Ограничьте доступ по IP** (если возможно):
   ```typescript
   const ALLOWED_IPS = ['your.work.ip', 'your.home.ip'];
   ```

4. **Включите двухфакторную аутентификацию** (опционально)

### Дополнительные меры защиты:

- Rate limiting уже включен (5 попыток за 15 минут)
- Используйте сложные пароли (минимум 16 символов)
- Регулярно проверяйте логи доступа
- Используйте VPN для дополнительной защиты

## Мониторинг

Для отслеживания подключений добавьте в .env:
```
LOG_CONNECTIONS=true
```

Логи будут сохраняться в `logs/access.log`