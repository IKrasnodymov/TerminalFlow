let socket = null;
let term = null;
let fitAddon = null;
let connectionStatus = null;
let connectionText = null;

// DOM elements
let authContainer, terminalContainer, errorMsg, successMsg;
let codeRequestForm, requestCodeBtn, emailInfo;
let codeInputForm, accessCodeInput, verifyCodeBtn, requestNewCodeBtn;

// Accessibility helpers
function announceToScreenReader(message, priority = 'polite') {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', priority === 'assertive' ? 'alert' : 'status');
    announcement.setAttribute('aria-live', priority);
    announcement.className = 'sr-only';
    announcement.textContent = message;
    document.body.appendChild(announcement);
    setTimeout(() => announcement.remove(), 1000);
}

function updateConnectionStatus(status, text) {
    if (!connectionStatus || !connectionText) return;
    
    connectionStatus.className = 'connection-status ' + status;
    connectionText.textContent = text;
    
    // Announce to screen readers
    announceToScreenReader('Статус подключения: ' + text, status === 'disconnected' ? 'assertive' : 'polite');
}

// Theme management
function initTheme() {
    const savedTheme = localStorage.getItem('terminal-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', function() {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('terminal-theme', newTheme);
            
            // Update terminal theme if it exists
            if (term) {
                const isDark = newTheme === 'dark';
                term.options.theme = {
                    background: isDark ? '#000000' : '#ffffff',
                    foreground: isDark ? '#ffffff' : '#000000',
                    cursor: isDark ? '#ffffff' : '#000000',
                    selection: isDark ? '#ffffff44' : '#00000044',
                };
            }
            
            announceToScreenReader('Тема изменена на ' + (newTheme === 'dark' ? 'тёмную' : 'светлую'));
        });
    }
}

// Initialize DOM elements when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Initialize theme
    initTheme();
    
    // Check if there's a stored token and if it's still valid
    const storedToken = localStorage.getItem('token');
    if (storedToken) {
        // Validate token first (async)
        isTokenValid(storedToken).then(valid => {
            if (valid) {
                // Token is valid, connect to terminal automatically
                const successMsg = document.getElementById('success-msg');
                if (successMsg) {
                    successMsg.textContent = 'Восстановление сессии...';
                    successMsg.style.display = 'block';
                }
                setTimeout(() => {
                    connectToTerminal(storedToken);
                }, 100);
            } else {
                // Token is invalid/expired, remove it
                localStorage.removeItem('token');
                const errorMsg = document.getElementById('error-msg');
                if (errorMsg) {
                    errorMsg.textContent = 'Сессия истекла. Требуется новая аутентификация.';
                    errorMsg.style.display = 'block';
                }
            }
        }).catch(error => {
            console.error('Token validation error:', error);
            localStorage.removeItem('token');
            const errorMsg = document.getElementById('error-msg');
            if (errorMsg) {
                errorMsg.textContent = 'Ошибка проверки сессии. Требуется новая аутентификация.';
                errorMsg.style.display = 'block';
            }
        });
        
        // Skip DOM setup for auth form initially
        return;
    }
    // DOM elements
    authContainer = document.getElementById('auth-container');
    terminalContainer = document.getElementById('terminal-container');
    errorMsg = document.getElementById('error-msg');
    successMsg = document.getElementById('success-msg');
    connectionStatus = document.getElementById('connection-status');
    connectionText = document.getElementById('connection-text');

    // Code request form elements
    codeRequestForm = document.getElementById('code-request-form');
    requestCodeBtn = document.getElementById('request-code-btn');
    emailInfo = document.getElementById('email-info');

    // Code input form elements
    codeInputForm = document.getElementById('code-input-form');
    accessCodeInput = document.getElementById('access-code');
    verifyCodeBtn = document.getElementById('verify-code-btn');
    requestNewCodeBtn = document.getElementById('request-new-code-btn');

    // Event listeners
    if (requestCodeBtn) requestCodeBtn.addEventListener('click', requestAccessCode);
    if (verifyCodeBtn) verifyCodeBtn.addEventListener('click', verifyAccessCode);
    if (requestNewCodeBtn) requestNewCodeBtn.addEventListener('click', requestNewAccessCode);

    if (accessCodeInput) {
        accessCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') verifyAccessCode();
        });

        accessCodeInput.addEventListener('input', (e) => {
            // Only allow numbers
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        });
    }
});

async function requestAccessCode() {
    requestCodeBtn.disabled = true;
    requestCodeBtn.textContent = 'Отправляем...';
    clearMessages();

    try {
        const response = await fetch('/auth/request-code', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Не удалось запросить код');
        }

        showSuccess('Код отправлен на ваш email!');
        emailInfo.innerHTML = '<strong>📧 Код отправлен на:</strong> ' + data.email;
        emailInfo.style.display = 'block';
        
        // Переключаемся на форму ввода кода
        codeRequestForm.classList.add('fade-out');
        setTimeout(function() {
            codeRequestForm.style.display = 'none';
            codeRequestForm.classList.remove('fade-out');
            codeInputForm.style.display = 'block';
            codeInputForm.classList.add('fade-in');
            accessCodeInput.value = '';
            accessCodeInput.focus();
            announceToScreenReader('Форма ввода кода активна. Введите 6-значный код.');
        }, 200);

    } catch (error) {
        showError(error.message);
    } finally {
        requestCodeBtn.disabled = false;
        requestCodeBtn.textContent = '📧 Запросить код доступа';
    }
}

async function verifyAccessCode() {
    const accessCode = accessCodeInput.value.trim();
    
    if (!accessCode || accessCode.length !== 6) {
        showError('Введите 6-значный код из email');
        return;
    }

    verifyCodeBtn.disabled = true;
    verifyCodeBtn.textContent = 'Проверяем...';
    clearMessages();

    try {
        const response = await fetch('/auth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ accessCode }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Неверный код доступа');
        }

        localStorage.setItem('token', data.token);
        showSuccess('Код принят! Подключаемся к терминалу...');
        
        setTimeout(() => {
            connectToTerminal(data.token);
        }, 1000);

    } catch (error) {
        showError(error.message);
        verifyCodeBtn.disabled = false;
        verifyCodeBtn.textContent = '🔐 Войти';
    }
}

async function requestNewAccessCode() {
    // Возвращаемся к первой форме
    codeInputForm.style.display = 'none';
    codeRequestForm.style.display = 'block';
    emailInfo.style.display = 'none';
    accessCodeInput.value = '';
    clearMessages();
}

function showError(message) {
    errorMsg.textContent = message;
    errorMsg.style.display = 'block';
    successMsg.style.display = 'none';
    // Error messages are already announced via aria-live="assertive"
}

function showSuccess(message) {
    successMsg.textContent = message;
    successMsg.style.display = 'block';
    errorMsg.style.display = 'none';
    // Success messages are already announced via aria-live="polite"
}

function clearMessages() {
    errorMsg.textContent = '';
    successMsg.textContent = '';
    errorMsg.style.display = 'none';
    successMsg.style.display = 'none';
}

function connectToTerminal(token) {
    // Get DOM elements directly to avoid scope issues
    const authContainer = document.getElementById('auth-container');
    const terminalContainer = document.getElementById('terminal-container');
    
    if (!authContainer || !terminalContainer) {
        console.error('Required DOM elements not found');
        return;
    }
    
    // Smooth transition from auth to terminal
    authContainer.classList.add('fade-out');
    
    setTimeout(function() {
        authContainer.style.display = 'none';
        terminalContainer.style.display = 'block';
        terminalContainer.classList.add('fade-in');
        document.body.classList.add('terminal-active');
        
        // Announce terminal activation
        announceToScreenReader('Терминал активирован. Подключение к серверу...');
        
        // Continue with terminal initialization
        initializeTerminalWithToken(token);
    }, 300);
}

function initializeTerminalWithToken(token) {

    const isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isLandscape = window.innerWidth > window.innerHeight;
    const isSmallScreen = window.innerWidth <= 480;
    
    console.log('Device info:', { 
        isMobile, 
        isLandscape, 
        isSmallScreen, 
        width: window.innerWidth, 
        height: window.innerHeight,
        userAgent: navigator.userAgent 
    });
    
    let fontSize = terminalSettings.fontSize || 14;
    if (isMobile) {
        if (isLandscape) {
            fontSize = 10;
        } else {
            fontSize = isSmallScreen ? 11 : 14;
        }
    }
    
    const isDarkTheme = document.documentElement.getAttribute('data-theme') !== 'light';
    const colorScheme = colorSchemes[terminalSettings.colorScheme] || colorSchemes.default;
    
    term = new Terminal({
        cursorBlink: terminalSettings.cursorBlink,
        fontSize: fontSize,
        fontFamily: isMobile ? 
            'SF Mono, Monaco, Inconsolata, Roboto Mono, monospace' : 
            'Menlo, Monaco, "Courier New", monospace',
        theme: (isDarkTheme || terminalSettings.colorScheme !== 'default') ? colorScheme : {
            background: '#ffffff',
            foreground: '#000000',
            cursor: '#000000',
            selection: '#00000044',
        },
        allowProposedApi: true,
        scrollback: 1000,
        convertEol: true,
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    
    term.open(document.getElementById('terminal'));
    
    // Initial fit
    fitAddon.fit();
    
    // Force resize for mobile portrait mode
    if (isMobile && !isLandscape) {
        // Wait for CSS to apply
        setTimeout(() => {
            // Force terminal container to use full height
            const container = document.querySelector('.terminal-container');
            if (container) {
                container.style.height = '100vh';
                container.style.position = 'fixed';
                container.style.top = '0';
                container.style.left = '0';
                container.style.right = '0';
                container.style.bottom = '0';
            }
            
            // Now fit the terminal
            fitAddon.fit();
            
            // Ensure terminal fills available space
            const terminalElement = document.getElementById('terminal');
            if (terminalElement) {
                const viewportHeight = window.innerHeight;
                const mobileControlsHeight = 50; // Height of mobile controls
                const availableHeight = viewportHeight - mobileControlsHeight - 16; // 16px for padding
                
                terminalElement.style.height = `${availableHeight}px`;
                
                console.log('Terminal dimensions:', { 
                    viewportHeight,
                    availableHeight,
                    actualHeight: terminalElement.clientHeight 
                });
                
                // Force another fit after dimensions are set
                setTimeout(() => {
                    fitAddon.fit();
                    term.focus();
                }, 100);
            }
        }, 200);
    }

    socket = io('/', {
        auth: {
            token: token
        },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5
    });

    socket.on('connect', () => {
        console.log('Connected to server');
        socket.emit('terminal:create', term.cols, term.rows);
    });

    socket.on('terminal:ready', () => {
        console.log('Terminal ready');
        term.focus();
        
        // Start token expiration checking
        if (tokenCheckInterval) {
            clearInterval(tokenCheckInterval);
        }
        tokenCheckInterval = setInterval(checkTokenExpiration, 60000); // Check every minute
        
        // Check immediately
        checkTokenExpiration();
    });

    socket.on('terminal:data', (data) => {
        term.write(data);
    });

    socket.on('terminal:exit', () => {
        term.write('\r\n[Process completed]\r\n');
        setTimeout(() => {
            window.location.reload();
        }, 2000);
    });

    socket.on('terminal:error', (error) => {
        term.write(`\r\n[Error: ${error}]\r\n`);
    });

    socket.on('disconnect', () => {
        term.write('\r\n[Disconnected from server]\r\n');
        
        // Clear token check interval
        if (tokenCheckInterval) {
            clearInterval(tokenCheckInterval);
            tokenCheckInterval = null;
        }
    });

    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        term.write('\r\n[Connection error: ' + error.message + ']\r\n');
    });

    term.onData((data) => {
        socket.emit('terminal:data', data);
    });

    term.onResize(({ cols, rows }) => {
        socket.emit('terminal:resize', cols, rows);
    });

    // Mobile keyboard support
    if ('virtualKeyboard' in navigator) {
        try {
            navigator.virtualKeyboard.overlaysContent = true;
            
            term.textarea.addEventListener('focus', () => {
                try {
                    navigator.virtualKeyboard.show();
                } catch (e) {
                    console.warn('Virtual keyboard show failed:', e);
                }
            });
        } catch (e) {
            console.warn('Virtual keyboard setup failed:', e);
        }
    }
    
    // Simple focus for all devices
    term.focus();
    
    // Add click handler to focus terminal
    const terminalElement = document.getElementById('terminal');
    if (terminalElement) {
        terminalElement.addEventListener('click', () => {
            term.focus();
        });
    }

    // Setup mobile controls
    setupMobileControls();
}

// Quick commands management (compatible with older browsers)
function QuickCommands() {
    this.commands = this.loadCommands();
    this.initializeDefaultCommands();
}

QuickCommands.prototype.initializeDefaultCommands = function() {
    if (this.commands.length === 0) {
        this.commands = [
            { id: 1, name: 'Home', command: 'cd ~' },
            { id: 2, name: 'Project', command: 'cd /Users/ikrasnodymov/Documents/terminal-to-web' },
            { id: 3, name: 'List', command: 'ls -la' },
            { id: 4, name: 'Clear', command: 'clear' },
            { id: 5, name: 'Git Status', command: 'git status' },
            { id: 6, name: 'Claude Web', command: './claude-web' }
        ];
        this.saveCommands();
    }
};

QuickCommands.prototype.loadCommands = function() {
    try {
        var saved = localStorage.getItem('terminalQuickCommands');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        return [];
    }
};

QuickCommands.prototype.saveCommands = function() {
    try {
        localStorage.setItem('terminalQuickCommands', JSON.stringify(this.commands));
    } catch (e) {
        console.error('Failed to save commands');
    }
};

QuickCommands.prototype.addCommand = function(command, name) {
    var id = Date.now();
    this.commands.push({ 
        id: id, 
        name: name || this.generateName(command), 
        command: command 
    });
    this.saveCommands();
    return id;
};

QuickCommands.prototype.deleteCommand = function(id) {
    var newCommands = [];
    for (var i = 0; i < this.commands.length; i++) {
        if (this.commands[i].id !== id) {
            newCommands.push(this.commands[i]);
        }
    }
    this.commands = newCommands;
    this.saveCommands();
};

QuickCommands.prototype.generateName = function(command) {
    if (command.indexOf('cd ') === 0) return 'Navigate';
    if (command.indexOf('git ') === 0) return 'Git';
    if (command.indexOf('ls') !== -1) return 'List';
    if (command.indexOf('npm') !== -1) return 'NPM';
    return command.split(' ')[0];
};

QuickCommands.prototype.getCommands = function() {
    return this.commands;
};

// Initialize quick commands globally
let quickCommands = null;

// Terminal settings
let terminalSettings = {
    fontSize: 14,
    colorScheme: 'default',
    cursorBlink: true,
    soundEnabled: false
};

// Color schemes
const colorSchemes = {
    default: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#ffffff',
        selection: '#ffffff44'
    },
    monokai: {
        background: '#272822',
        foreground: '#f8f8f2',
        cursor: '#f8f8f2',
        selection: '#49483e'
    },
    solarized: {
        background: '#002b36',
        foreground: '#839496',
        cursor: '#839496',
        selection: '#073642'
    }
};

// Load settings from localStorage
function loadSettings() {
    const saved = localStorage.getItem('terminal-settings');
    if (saved) {
        try {
            Object.assign(terminalSettings, JSON.parse(saved));
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }
}

// Save settings to localStorage
function saveSettings() {
    localStorage.setItem('terminal-settings', JSON.stringify(terminalSettings));
}

// Apply settings to terminal
function applyTerminalSettings() {
    if (!term) return;
    
    term.options.fontSize = terminalSettings.fontSize;
    term.options.cursorBlink = terminalSettings.cursorBlink;
    
    const isDarkTheme = document.documentElement.getAttribute('data-theme') !== 'light';
    const scheme = colorSchemes[terminalSettings.colorScheme];
    
    if (isDarkTheme || terminalSettings.colorScheme !== 'default') {
        term.options.theme = scheme;
    } else {
        // Light theme with default scheme
        term.options.theme = {
            background: '#ffffff',
            foreground: '#000000',
            cursor: '#000000',
            selection: '#00000044'
        };
    }
    
    if (fitAddon) {
        fitAddon.fit();
    }
}

// Initialize settings on load
loadSettings();

// Disconnect session function
function disconnectSession() {
    try {
        // Close WebSocket connection
        if (socket && socket.connected) {
            socket.disconnect();
        }
        
        // Close terminal
        if (term) {
            term.dispose();
            term = null;
        }
        
        // Clear stored token
        localStorage.removeItem('token');
        
        // Show disconnect message
        showToast('Сессия завершена', 'info');
        
        // Redirect to auth page after a short delay
        setTimeout(() => {
            window.location.reload();
        }, 1000);
        
        announceToScreenReader('Сессия завершена. Возврат к аутентификации.');
        
    } catch (error) {
        console.error('Error disconnecting session:', error);
        showToast('Ошибка при отключении сессии', 'error');
    }
}

// Check token expiration periodically
function checkTokenExpiration() {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    // Use client-side validation for periodic checks (faster)
    if (!isTokenValidClientSide(token)) {
        showToast('Сессия истекла', 'error');
        disconnectSession();
        return;
    }
    
    try {
        // Parse JWT token (simple base64 decode)
        const tokenParts = token.split('.');
        if (tokenParts.length === 3) {
            const payload = JSON.parse(atob(tokenParts[1]));
            const expiryTime = payload.exp * 1000; // Convert to milliseconds
            const currentTime = Date.now();
            
            // If token expires in less than 5 minutes, show warning
            if (expiryTime - currentTime < 5 * 60 * 1000 && expiryTime > currentTime) {
                showToast('Сессия истекает через 5 минут', 'warning', {
                    duration: 10000,
                    action: () => window.location.reload(),
                    actionText: 'Обновить'
                });
            }
        }
    } catch (error) {
        console.error('Error checking token expiration:', error);
    }
}

// Check token every minute when terminal is active
let tokenCheckInterval = null;

// Check if token is valid (not expired) - client-side check
function isTokenValidClientSide(token) {
    if (!token) return false;
    
    try {
        const tokenParts = token.split('.');
        if (tokenParts.length !== 3) return false;
        
        const payload = JSON.parse(atob(tokenParts[1]));
        const expiryTime = payload.exp * 1000; // Convert to milliseconds
        const currentTime = Date.now();
        
        // Token is valid if it hasn't expired yet
        return currentTime < expiryTime;
    } catch (error) {
        console.error('Error validating token:', error);
        return false;
    }
}

// Validate token with server
async function isTokenValid(token) {
    if (!token) return false;
    
    // First do client-side check for quick validation
    if (!isTokenValidClientSide(token)) {
        return false;
    }
    
    try {
        const response = await fetch('/auth/validate-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token }),
        });
        
        const data = await response.json();
        return data.valid === true;
    } catch (error) {
        console.error('Error validating token with server:', error);
        // Fallback to client-side validation
        return isTokenValidClientSide(token);
    }
}

// Toast notification system
let toastId = 0;

function showToast(message, type = 'info', options = {}) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const id = 'toast-' + (++toastId);
    const toast = document.createElement('div');
    toast.id = id;
    toast.className = 'toast ' + type;
    toast.setAttribute('role', 'alert');
    
    // Icons for different types
    const icons = {
        info: '🔵',
        success: '✅',
        warning: '⚠️',
        error: '❌'
    };
    
    // Build toast content
    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    iconSpan.textContent = icons[type] || icons.info;
    
    const content = document.createElement('div');
    content.className = 'toast-content';
    
    const messageP = document.createElement('p');
    messageP.className = 'toast-message';
    messageP.textContent = message;
    content.appendChild(messageP);
    
    toast.appendChild(iconSpan);
    toast.appendChild(content);
    
    // Add action button if provided
    if (options.action && options.actionText) {
        const actionBtn = document.createElement('button');
        actionBtn.className = 'toast-action';
        actionBtn.textContent = options.actionText;
        actionBtn.addEventListener('click', function() {
            options.action();
            removeToast(id);
        });
        toast.appendChild(actionBtn);
    }
    
    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '×';
    closeBtn.setAttribute('aria-label', 'Закрыть уведомление');
    closeBtn.addEventListener('click', function() {
        removeToast(id);
    });
    toast.appendChild(closeBtn);
    
    // Add to container
    container.appendChild(toast);
    
    // Auto-remove after duration (default 5 seconds)
    const duration = options.duration || 5000;
    setTimeout(function() {
        removeToast(id);
    }, duration);
    
    // Play sound if enabled
    if (terminalSettings.soundEnabled && type === 'error') {
        // Simple beep using Web Audio API
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            oscillator.frequency.value = 440;
            oscillator.connect(audioContext.destination);
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.1);
        } catch (e) {
            console.error('Failed to play sound:', e);
        }
    }
    
    return id;
}

function removeToast(id) {
    const toast = document.getElementById(id);
    if (toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(function() {
            toast.remove();
        }, 300);
    }
}

// Mobile controls
function setupMobileControls() {
    var isMobile = window.innerWidth <= 768;
    if (!isMobile) return;

    let ctrlPressed = false;
    let altPressed = false;

    // Initialize quick commands
    quickCommands = new QuickCommands();
    
    // Get DOM elements
    const ctrlBtn = document.getElementById('ctrl-btn');
    const altBtn = document.getElementById('alt-btn');
    const tabBtn = document.getElementById('tab-btn');
    const escBtn = document.getElementById('esc-btn');
    const arrowsBtn = document.getElementById('arrows-btn');
    const commandsBtn = document.getElementById('commands-btn');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const arrowKeys = document.getElementById('arrow-keys');
    const quickCommandsPanel = document.getElementById('quick-commands');
    const settingsPanel = document.getElementById('settings-panel');
    
    // Commands management function
    function renderCommandsList() {
        var commandsList = document.getElementById('commands-list');
        
        if (!quickCommands || !commandsList) {
            return;
        }
        
        var commands = quickCommands.getCommands();
        
        // Clear existing content
        commandsList.innerHTML = '';
        
        // Create elements safely using DOM methods instead of innerHTML
        for (var i = 0; i < commands.length; i++) {
            var cmd = commands[i];
            
            var commandItem = document.createElement('div');
            commandItem.className = 'command-item';
            commandItem.setAttribute('role', 'listitem');
            
            var commandBtn = document.createElement('button');
            commandBtn.className = 'command-btn';
            commandBtn.setAttribute('data-command', cmd.command);
            commandBtn.setAttribute('aria-label', 'Выполнить команду: ' + (cmd.name || cmd.command));
            
            if (cmd.name) {
                var nameSpan = document.createElement('span');
                nameSpan.className = 'command-name';
                nameSpan.textContent = cmd.name;
                commandBtn.appendChild(nameSpan);
            }
            
            var commandText = document.createTextNode(cmd.command);
            commandBtn.appendChild(commandText);
            
            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-command-btn';
            deleteBtn.setAttribute('data-id', cmd.id.toString());
            deleteBtn.setAttribute('aria-label', 'Удалить команду: ' + (cmd.name || cmd.command));
            deleteBtn.textContent = '×';
            
            commandItem.appendChild(commandBtn);
            commandItem.appendChild(deleteBtn);
            commandsList.appendChild(commandItem);
        }

        // Add event listeners to command buttons
        var commandBtns = commandsList.querySelectorAll('.command-btn');
        for (var i = 0; i < commandBtns.length; i++) {
            commandBtns[i].addEventListener('click', function() {
                var command = this.getAttribute('data-command');
                term.write(command);
                socket.emit('terminal:data', command + '\r');
                quickCommandsPanel.style.display = 'none';
                resetModifiers();
            });
        }

        // Add event listeners to delete buttons
        var deleteBtns = commandsList.querySelectorAll('.delete-command-btn');
        for (var i = 0; i < deleteBtns.length; i++) {
            deleteBtns[i].addEventListener('click', function() {
                var id = parseInt(this.getAttribute('data-id'));
                quickCommands.deleteCommand(id);
                renderCommandsList();
                announceToScreenReader('Команда удалена');
            });
        }
    }
    
    // Setup event listeners for controls

    ctrlBtn.addEventListener('click', () => {
        ctrlPressed = !ctrlPressed;
        ctrlBtn.classList.toggle('active', ctrlPressed);
    });

    altBtn.addEventListener('click', () => {
        altPressed = !altPressed;
        altBtn.classList.toggle('active', altPressed);
    });

    tabBtn.addEventListener('click', () => {
        socket.emit('terminal:data', '\t');
        resetModifiers();
    });

    escBtn.addEventListener('click', () => {
        socket.emit('terminal:data', '\x1b');
        resetModifiers();
    });

    if (arrowsBtn) {
        arrowsBtn.addEventListener('click', () => {
            if (arrowKeys) {
                arrowKeys.style.display = arrowKeys.style.display === 'none' ? 'block' : 'none';
                if (quickCommandsPanel) quickCommandsPanel.style.display = 'none'; // Hide commands panel
            }
        });
    }
    
    // Setup arrow key buttons
    const arrowButtons = document.querySelectorAll('.arrow-btn');
    arrowButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-key');
            let sequence = '';
            
            switch(key) {
                case 'ArrowUp':
                    sequence = '\x1b[A';
                    break;
                case 'ArrowDown':
                    sequence = '\x1b[B';
                    break;
                case 'ArrowRight':
                    sequence = '\x1b[C';
                    break;
                case 'ArrowLeft':
                    sequence = '\x1b[D';
                    break;
            }
            
            if (sequence && socket) {
                socket.emit('terminal:data', sequence);
            }
        });
    });

    if (commandsBtn && quickCommandsPanel) {
        commandsBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            
            // Check if panel is currently hidden
            var isHidden = quickCommandsPanel.style.display === 'none' || getComputedStyle(quickCommandsPanel).display === 'none';
            
            // Toggle visibility
            if (isHidden) {
                quickCommandsPanel.style.display = 'block';
                renderCommandsList();
            } else {
                quickCommandsPanel.style.display = 'none';
            }
            
            // Hide arrow keys if visible
            if (arrowKeys) arrowKeys.style.display = 'none';
        });
    } else {
        console.error('Commands button or panel not found', {
            commandsBtn: commandsBtn,
            quickCommandsPanel: quickCommandsPanel
        });
    }

    fullscreenBtn.addEventListener('click', () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen();
        }
    });
    
    // Settings button
    if (settingsBtn) {
        settingsBtn.addEventListener('click', function() {
            const isVisible = settingsPanel.style.display !== 'none';
            settingsPanel.style.display = isVisible ? 'none' : 'block';
            settingsBtn.setAttribute('aria-expanded', isVisible ? 'false' : 'true');
            announceToScreenReader('Настройки ' + (isVisible ? 'скрыты' : 'открыты'));
            
            if (!isVisible) {
                setupSettingsPanel();
            }
        });
    }
    
    function resetModifiers() {
        ctrlPressed = false;
        altPressed = false;
        ctrlBtn.classList.remove('active');
        altBtn.classList.remove('active');
    }

    // Arrow keys
    document.querySelectorAll('.arrow-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.key;
            const event = new KeyboardEvent('keydown', {
                key: key,
                code: key,
                ctrlKey: ctrlPressed,
                altKey: altPressed
            });
            term.textarea.dispatchEvent(event);
            resetModifiers();
        });
    });
    
    // Commands management function will be defined later in setupMobileControls
    
    // Hide panels when clicking outside
    document.addEventListener('click', (e) => {
        if (arrowKeys && !arrowKeys.contains(e.target) && e.target !== arrowsBtn) {
            arrowKeys.style.display = 'none';
        }
        if (quickCommandsPanel && !quickCommandsPanel.contains(e.target) && e.target !== commandsBtn) {
            quickCommandsPanel.style.display = 'none';
        }
    });
}

// Setup settings panel
function setupSettingsPanel() {
    const fontSizeSlider = document.getElementById('font-size-slider');
    const fontSizeValue = document.getElementById('font-size-value');
    const cursorBlinkCheckbox = document.getElementById('cursor-blink');
    const soundEnabledCheckbox = document.getElementById('sound-enabled');
    const colorSchemeBtns = document.querySelectorAll('.color-scheme-btn');
    const resetSettingsBtn = document.getElementById('reset-settings');
    const closeSettingsBtn = document.getElementById('close-settings');
    const settingsPanel = document.getElementById('settings-panel');
    
    // Initialize values from settings
    if (fontSizeSlider) {
        fontSizeSlider.value = terminalSettings.fontSize;
        fontSizeValue.textContent = terminalSettings.fontSize + 'px';
        
        fontSizeSlider.addEventListener('input', function() {
            terminalSettings.fontSize = parseInt(this.value);
            fontSizeValue.textContent = this.value + 'px';
            applyTerminalSettings();
            saveSettings();
        });
    }
    
    if (cursorBlinkCheckbox) {
        cursorBlinkCheckbox.checked = terminalSettings.cursorBlink;
        
        cursorBlinkCheckbox.addEventListener('change', function() {
            terminalSettings.cursorBlink = this.checked;
            applyTerminalSettings();
            saveSettings();
        });
    }
    
    if (soundEnabledCheckbox) {
        soundEnabledCheckbox.checked = terminalSettings.soundEnabled;
        
        soundEnabledCheckbox.addEventListener('change', function() {
            terminalSettings.soundEnabled = this.checked;
            saveSettings();
            announceToScreenReader('Звуковые уведомления ' + (this.checked ? 'включены' : 'выключены'));
        });
    }
    
    // Color scheme buttons
    colorSchemeBtns.forEach(function(btn) {
        if (btn.dataset.scheme === terminalSettings.colorScheme) {
            btn.classList.add('active');
        }
        
        btn.addEventListener('click', function() {
            colorSchemeBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            terminalSettings.colorScheme = this.dataset.scheme;
            applyTerminalSettings();
            saveSettings();
            announceToScreenReader('Цветовая схема изменена');
        });
    });
    
    // Reset settings
    if (resetSettingsBtn) {
        resetSettingsBtn.addEventListener('click', function() {
            terminalSettings.fontSize = 14;
            terminalSettings.colorScheme = 'default';
            terminalSettings.cursorBlink = true;
            terminalSettings.soundEnabled = false;
            
            saveSettings();
            applyTerminalSettings();
            setupSettingsPanel(); // Refresh UI
            announceToScreenReader('Настройки сброшены');
        });
    }
    
    // Disconnect session
    const disconnectSessionBtn = document.getElementById('disconnect-session');
    if (disconnectSessionBtn) {
        disconnectSessionBtn.addEventListener('click', function() {
            // Confirm disconnect
            if (confirm('Вы уверены, что хотите завершить сессию?')) {
                disconnectSession();
            }
        });
    }
    
    // Close settings
    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', function() {
            settingsPanel.style.display = 'none';
            const settingsBtn = document.getElementById('settings-btn');
            if (settingsBtn) {
                settingsBtn.setAttribute('aria-expanded', 'false');
            }
            announceToScreenReader('Настройки закрыты');
        });
    }


    // Add command form management
    var addCommandBtn = document.getElementById('add-command-btn');
    var addCommandForm = document.getElementById('add-command-form');
    var commandInput = document.getElementById('command-input');
    var commandName = document.getElementById('command-name');
    var saveCommandBtn = document.getElementById('save-command-btn');
    var cancelCommandBtn = document.getElementById('cancel-command-btn');

    if (addCommandBtn) {
        addCommandBtn.addEventListener('click', function() {
            addCommandForm.style.display = 'block';
            commandInput.value = '';
            commandName.value = '';
            commandInput.focus();
            announceToScreenReader('Форма добавления команды открыта');
        });
    }

    if (cancelCommandBtn) {
        cancelCommandBtn.addEventListener('click', function() {
            addCommandForm.style.display = 'none';
            commandInput.value = '';
            commandName.value = '';
        });
    }

    // Handle form submission
    if (addCommandForm) {
        addCommandForm.addEventListener('submit', function(e) {
            e.preventDefault();
            var command = commandInput.value.replace(/^\s+|\s+$/g, ''); // trim for older browsers
            var name = commandName.value.replace(/^\s+|\s+$/g, '');
            
            if (command) {
                quickCommands.addCommand(command, name);
                addCommandForm.style.display = 'none';
                commandInput.value = '';
                commandName.value = '';
                renderCommandsList();
                announceToScreenReader('Команда "' + (name || command) + '" добавлена');
            } else {
                announceToScreenReader('Введите команду', 'assertive');
                commandInput.focus();
            }
        });
    }

    if (commandInput) {
        commandInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' || e.keyCode === 13) {
                saveCommandBtn.click();
            }
        });
    }

    // Hide panels when clicking outside - moved inside setupMobileControls

    // Auto-resize on orientation change
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            if (fitAddon && term) {
                fitAddon.fit();
                // Adjust font size based on orientation and screen size
                const isLandscape = window.innerWidth > window.innerHeight;
                const isSmallScreen = window.innerWidth <= 480;
                
                if (isLandscape) {
                    term.options.fontSize = 10;
                } else {
                    term.options.fontSize = isSmallScreen ? 12 : 14;
                    // Force terminal to be visible in portrait mode
                    const terminalEl = document.getElementById('terminal');
                    if (terminalEl) {
                        terminalEl.style.visibility = 'visible';
                        terminalEl.style.opacity = '1';
                    }
                }
                
                // Force refresh of the terminal
                setTimeout(() => fitAddon.fit(), 100);
            }
        }, 300);
    });

    // Also handle regular resize
    window.addEventListener('resize', () => {
        setTimeout(() => {
            if (fitAddon && term) {
                const isLandscape = window.innerWidth > window.innerHeight;
                const isSmallScreen = window.innerWidth <= 480;
                
                if (window.innerWidth <= 768) {
                    if (isLandscape) {
                        term.options.fontSize = 10;
                    } else {
                        term.options.fontSize = isSmallScreen ? 11 : 14;
                    }
                }
                fitAddon.fit();
            }
        }, 100);
    });
}

window.addEventListener('beforeunload', () => {
    if (socket) {
        socket.disconnect();
    }
});