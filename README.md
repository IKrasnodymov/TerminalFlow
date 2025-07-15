# TerminalFlow 🖥️

A modern web-based terminal emulator that enables remote control of your macOS terminal from any device through a web browser. Features secure email-based two-factor authentication and mobile optimization.

![Terminal Demo](https://img.shields.io/badge/Platform-macOS-blue) ![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)

## ✨ Возможности

- 🖥️ **Полноценный терминал в браузере** - доступ к zsh/bash с любого устройства
- 📱 **Мобильная оптимизация** - виртуальная клавиатура и сенсорные элементы управления
- 🔐 **Безопасная аутентификация** - одноразовые коды доступа на email
- ⚡ **Реальное время** - WebSocket для мгновенной реакции терминала
- 🌍 **Удаленный доступ** - Cloudflare Tunnel для доступа из любой точки мира
- 📋 **Быстрые команды** - сохраняемые шаблоны команд для ускорения работы
- 🔄 **Автомасштабирование** - адаптация под размер экрана и ориентацию
- 🛡️ **Защита от атак** - rate limiting и JWT токены

## 🚀 Быстрый старт

### 1. Установка

```bash
# Клонируйте репозиторий
git clone <repository-url>
cd terminal-to-web

# Установите зависимости
npm install
```

### 2. Настройка email сервиса (Resend)

1. **Зарегистрируйтесь в Resend**:
   - Перейдите на https://resend.com/
   - Создайте бесплатный аккаунт (3000 emails/месяц)
   - Получите API ключ в разделе API Keys

2. **Настройте .env файл**:
   ```bash
   # Скопируйте пример конфигурации
   cp .env.example .env
   
   # Отредактируйте .env файл
   nano .env
   ```

### 3. Конфигурация (.env)

```bash
# Основные настройки
PORT=3000
NODE_ENV=development

# Безопасность (ОБЯЗАТЕЛЬНО ИЗМЕНИТЕ!)
JWT_SECRET=ваш-секретный-ключ-минимум-32-символа
ACCESS_PASSWORD=legacy-password-for-compatibility

# Email сервис (Resend)
RESEND_API_KEY=re_ваш_api_ключ_от_resend
NOTIFICATION_EMAIL=ваш-email@domain.com

# Настройки аутентификации
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_TIME_MINUTES=15
ACCESS_CODE_EXPIRY_MINUTES=10
```

### 4. Запуск

```bash
# Разработка (только локально)
npm run dev

# Разработка + удаленный доступ
npm run start:dev

# Продакшн
npm run build
npm start
```

## 🌍 Удаленный доступ

### Cloudflare Tunnel (рекомендуется)

1. **Установите cloudflared**:
   ```bash
   # macOS
   brew install cloudflared
   
   # или скачайте с https://github.com/cloudflare/cloudflared/releases
   ```

2. **Запустите с туннелем**:
   ```bash
   npm run start:dev
   ```

3. **Получите публичный URL** - будет показан в логах:
   ```
   https://random-name.trycloudflare.com
   ```

### Постоянный домен (для продакшна)

1. **Настройте именованный туннель**:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create terminal-web
   cloudflared tunnel route dns terminal-web terminal.ваш-домен.com
   ```

2. **Создайте config.yml**:
   ```yaml
   tunnel: <tunnel-id>
   credentials-file: ~/.cloudflared/<tunnel-id>.json
   
   ingress:
     - hostname: terminal.ваш-домен.com
       service: http://localhost:3000
     - service: http_status:404
   ```

## 📱 Использование

### 1. Аутентификация

1. Откройте веб-адрес (локальный или публичный)
2. Нажмите "📧 Запросить код доступа"
3. Проверьте email - придет письмо с 6-значным кодом
4. Введите код в форму и нажмите "🔐 Войти"

### 2. Работа с терминалом

- **Обычная клавиатура** - работает как в настоящем терминале
- **Мобильные устройства**:
  - `Ctrl/Alt/Tab/Esc` - виртуальные кнопки
  - `↑↓←→` - кнопка стрелок
  - `CMD` - быстрые команды
  - `[ ]` - полноэкранный режим

### 3. Быстрые команды

1. Нажмите кнопку `CMD`
2. Добавьте команду кнопкой `+`
3. Введите команду и название
4. Используйте для быстрого выполнения

## 🏗️ Архитектура

### Backend (Node.js + TypeScript)

```
src/
├── server.ts              # Основной сервер Express + Socket.IO
├── config.ts              # Конфигурация с валидацией
├── terminalHandler.ts     # Обработка terminal events
├── services/              # Сервисный слой
│   ├── TerminalManager.ts # Управление PTY процессами
│   ├── AccessCodeService.ts # Генерация/валидация кодов
│   ├── ResendEmailService.ts # Email через Resend API
│   └── EmailService.ts    # Fallback для Gmail
├── middleware/            # Middleware для Express/Socket.IO
│   ├── auth.ts           # JWT аутентификация
│   └── errorHandler.ts   # Обработка ошибок
└── utils/                # Утилиты
    ├── security.ts       # Rate limiting
    ├── validation.ts     # Валидация данных
    ├── logger.ts         # Структурированное логирование
    └── environment.ts    # Безопасная среда для PTY
```

### Frontend (Vanilla JS)

```
public/
├── index.html     # Интерфейс с формами аутентификации
├── app.js         # Основная логика + мобильные элементы управления
└── style.css      # Адаптивные стили для всех устройств
```

### Поток аутентификации

1. `POST /auth/request-code` → генерация кода → отправка email
2. `POST /auth/token` → валидация кода → выдача JWT
3. WebSocket подключение с JWT → создание PTY → работа с терминалом

## 🔧 Команды разработки

```bash
# Разработка
npm run dev              # Сервер с hot reload
npm run start:dev        # Сервер + Cloudflare tunnel
npm run start:all        # Build + сервер + tunnel

# Продакшн
npm run build            # Компиляция TypeScript
npm start               # Запуск готового build

# Качество кода
npm run lint            # Проверка ESLint
npm run lint:fix        # Автоисправление
npm run format          # Форматирование Prettier
npm run typecheck       # Проверка типов TypeScript
```

## 🛡️ Безопасность

### Встроенная защита

- **Rate Limiting**: 5 попыток на IP за 15 минут
- **JWT токены**: срок действия 24 часа
- **Коды доступа**: 6 цифр, 10 минут действия
- **Валидация входных данных**: защита от XSS
- **Фильтрация переменных среды**: безопасность PTY процессов

### Рекомендации для продакшна

1. **Измените секретные ключи**:
   ```bash
   # Генерация случайного JWT secret
   openssl rand -base64 32
   ```

2. **Настройте CORS для продакшна**:
   ```bash
   CORS_ORIGIN=https://ваш-домен.com,https://другой-домен.com
   ```

3. **Используйте HTTPS**: Cloudflare Tunnel автоматически обеспечивает HTTPS

4. **Мониторинг логов**: все события записываются структурированно

## 📧 Настройка Email

### Resend (рекомендуется)

1. **Регистрация**: https://resend.com/
2. **Лимиты**: 3000 emails/месяц бесплатно
3. **Настройка**:
   ```bash
   RESEND_API_KEY=re_xxxxxxxxxx
   NOTIFICATION_EMAIL=ваш-email@domain.com
   ```

### Тестирование без email

В режиме разработки коды отображаются в консоли сервера:

```bash
============================================================
🖥️  TERMINAL ACCESS CODE
============================================================
📧 Email: your-email@domain.com
🔐 CODE: 123456
⏰ Valid for: 10 minutes
============================================================
```

## 🔧 Устранение неполадок

### Ошибки компиляции node-pty

```bash
# macOS
xcode-select --install

# Переустановка зависимостей
rm -rf node_modules package-lock.json
npm install
```

### Проблемы с аутентификацией

1. **Код не приходит**: проверьте RESEND_API_KEY в .env
2. **Неверный код**: коды действуют 10 минут
3. **Rate limiting**: подождите 15 минут или перезапустите сервер

### Cloudflare Tunnel

```bash
# Проверка статуса
cloudflared tunnel list

# Перезапуск туннеля
pkill cloudflared
npm run start:dev
```

### Веб-интерфейс

1. **Терминал не появляется**: проверьте консоль браузера на ошибки
2. **WebSocket ошибки**: убедитесь что сервер запущен
3. **Мобильные проблемы**: очистите localStorage браузера

## 📱 Мобильная оптимизация

### Поддерживаемые устройства

- ✅ iPhone/iPad (Safari, Chrome)
- ✅ Android (Chrome, Firefox)
- ✅ Настольные браузеры (все современные)

### Особенности мобильного интерфейса

- **Адаптивный шрифт**: автоматическое изменение размера
- **Виртуальная клавиатура**: интеграция с системной клавиатурой
- **Touch-события**: оптимизированы для сенсорных экранов
- **Ориентация**: поддержка поворота экрана

## 🚀 Развертывание

### VPS развертывание

1. **Подготовка сервера**:
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

2. **Клонирование и настройка**:
   ```bash
   git clone <repository>
   cd terminal-to-web
   npm install
   npm run build
   ```

3. **Systemd сервис**:
   ```ini
   [Unit]
   Description=Terminal to Web
   After=network.target
   
   [Service]
   Type=simple
   User=www-data
   WorkingDirectory=/path/to/terminal-to-web
   ExecStart=/usr/bin/node dist/server.js
   Restart=always
   Environment=NODE_ENV=production
   
   [Install]
   WantedBy=multi-user.target
   ```

### Docker развертывание

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## 📊 Мониторинг

### Логи

Все события записываются в структурированном формате:

```json
{
  "level": "info",
  "message": "Access code created",
  "email": "user@domain.com",
  "ip": "192.168.1.1",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### Health Check

```bash
curl http://localhost:3000/health
```

## 🤝 Поддержка

### Документация

- [CLAUDE.md](./CLAUDE.md) - техническая документация для разработчиков
- [SECURITY_IMPROVEMENTS.md](./SECURITY_IMPROVEMENTS.md) - улучшения безопасности
- [REMOTE_ACCESS.md](./REMOTE_ACCESS.md) - варианты удаленного доступа

### Сообщения об ошибках

1. Опишите проблему подробно
2. Приложите логи сервера
3. Укажите версию Node.js и операционную систему
4. Опишите шаги для воспроизведения

## 📄 Лицензия

ISC License - см. файл LICENSE

---

**⚡ Быстрый старт**: `npm install && npm run start:dev` - и ваш терминал доступен из любой точки мира!