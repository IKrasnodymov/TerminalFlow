let socket = null;
let term = null;
let fitAddon = null;

// DOM elements
let authContainer, terminalContainer, errorMsg, successMsg;
let codeRequestForm, requestCodeBtn, emailInfo;
let codeInputForm, accessCodeInput, verifyCodeBtn, requestNewCodeBtn;

// Initialize DOM elements when page loads
document.addEventListener('DOMContentLoaded', function() {
    // DOM elements
    authContainer = document.getElementById('auth-container');
    terminalContainer = document.getElementById('terminal-container');
    errorMsg = document.getElementById('error-msg');
    successMsg = document.getElementById('success-msg');

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
        codeRequestForm.style.display = 'none';
        codeInputForm.style.display = 'block';
        accessCodeInput.focus();

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
}

function showSuccess(message) {
    successMsg.textContent = message;
    successMsg.style.display = 'block';
    errorMsg.style.display = 'none';
}

function clearMessages() {
    errorMsg.textContent = '';
    successMsg.textContent = '';
    errorMsg.style.display = 'none';
    successMsg.style.display = 'none';
}

function connectToTerminal(token) {
    authContainer.style.display = 'none';
    terminalContainer.style.display = 'block';
    document.body.classList.add('terminal-active');

    const isMobile = window.innerWidth <= 768;
    const isLandscape = window.innerWidth > window.innerHeight;
    const isSmallScreen = window.innerWidth <= 480;
    
    let fontSize = 14;
    if (isMobile) {
        if (isLandscape) {
            fontSize = 10;
        } else {
            fontSize = isSmallScreen ? 11 : 14;
        }
    }
    
    term = new Terminal({
        cursorBlink: true,
        fontSize: fontSize,
        fontFamily: isMobile ? 
            'SF Mono, Monaco, Inconsolata, Roboto Mono, monospace' : 
            'Menlo, Monaco, "Courier New", monospace',
        theme: {
            background: '#000000',
            foreground: '#ffffff',
            cursor: '#ffffff',
            selection: '#ffffff44',
        },
        allowProposedApi: true,
        scrollback: 1000,
        convertEol: true,
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    
    term.open(document.getElementById('terminal'));
    fitAddon.fit();

    socket = io({
        auth: {
            token: token
        }
    });

    socket.on('connect', () => {
        console.log('Connected to server');
        socket.emit('terminal:create', term.cols, term.rows);
    });

    socket.on('terminal:ready', () => {
        console.log('Terminal ready');
        term.focus();
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

    if ('virtualKeyboard' in navigator) {
        navigator.virtualKeyboard.overlaysContent = true;
        
        term.textarea.addEventListener('focus', () => {
            navigator.virtualKeyboard.show();
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
            { id: 5, name: 'Git Status', command: 'git status' }
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

// Mobile controls
function setupMobileControls() {
    var isMobile = window.innerWidth <= 768;
    if (!isMobile) return;

    let ctrlPressed = false;
    let altPressed = false;

    // Initialize quick commands
    quickCommands = new QuickCommands();

    // Control buttons
    const ctrlBtn = document.getElementById('ctrl-btn');
    const altBtn = document.getElementById('alt-btn');
    const tabBtn = document.getElementById('tab-btn');
    const escBtn = document.getElementById('esc-btn');
    const arrowsBtn = document.getElementById('arrows-btn');
    const commandsBtn = document.getElementById('commands-btn');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const arrowKeys = document.getElementById('arrow-keys');
    const quickCommandsPanel = document.getElementById('quick-commands');

    ctrlBtn.addEventListener('click', () => {
        ctrlPressed = !ctrlPressed;
        ctrlBtn.classList.toggle('active', ctrlPressed);
    });

    altBtn.addEventListener('click', () => {
        altPressed = !altPressed;
        altBtn.classList.toggle('active', altPressed);
    });

    tabBtn.addEventListener('click', () => {
        const event = new KeyboardEvent('keydown', {
            key: 'Tab',
            code: 'Tab',
            keyCode: 9,
            ctrlKey: ctrlPressed,
            altKey: altPressed
        });
        term.textarea.dispatchEvent(event);
        resetModifiers();
    });

    escBtn.addEventListener('click', () => {
        const event = new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            keyCode: 27,
            ctrlKey: ctrlPressed,
            altKey: altPressed
        });
        term.textarea.dispatchEvent(event);
        resetModifiers();
    });

    arrowsBtn.addEventListener('click', () => {
        arrowKeys.style.display = arrowKeys.style.display === 'none' ? 'block' : 'none';
        quickCommandsPanel.style.display = 'none'; // Hide commands panel
    });

    commandsBtn.addEventListener('click', function() {
        if (quickCommandsPanel) {
            var isVisible = quickCommandsPanel.style.display === 'block';
            quickCommandsPanel.style.display = isVisible ? 'none' : 'block';
            arrowKeys.style.display = 'none';
            
            if (!isVisible) {
                renderCommands();
            }
        }
    });

    fullscreenBtn.addEventListener('click', () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen();
        }
    });

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

    function resetModifiers() {
        ctrlPressed = false;
        altPressed = false;
        ctrlBtn.classList.remove('active');
        altBtn.classList.remove('active');
    }

    // HTML escaping function to prevent XSS
    function escapeHtml(text) {
        var map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, function(m) { return map[m]; });
    }

    // Commands management
    function renderCommands() {
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
            
            var commandBtn = document.createElement('button');
            commandBtn.className = 'command-btn';
            commandBtn.setAttribute('data-command', cmd.command);
            
            if (cmd.name) {
                var nameSpan = document.createElement('span');
                nameSpan.className = 'command-name';
                nameSpan.textContent = cmd.name; // Use textContent to prevent XSS
                commandBtn.appendChild(nameSpan);
            }
            
            var commandText = document.createTextNode(cmd.command);
            commandBtn.appendChild(commandText);
            
            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-command-btn';
            deleteBtn.setAttribute('data-id', cmd.id.toString());
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
                renderCommands();
            });
        }
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
            commandInput.focus();
        });
    }

    if (cancelCommandBtn) {
        cancelCommandBtn.addEventListener('click', function() {
            addCommandForm.style.display = 'none';
            commandInput.value = '';
            commandName.value = '';
        });
    }

    if (saveCommandBtn) {
        saveCommandBtn.addEventListener('click', function() {
            var command = commandInput.value.replace(/^\s+|\s+$/g, ''); // trim for older browsers
            var name = commandName.value.replace(/^\s+|\s+$/g, '');
            
            if (command) {
                quickCommands.addCommand(command, name);
                addCommandForm.style.display = 'none';
                commandInput.value = '';
                commandName.value = '';
                renderCommands();
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

    // Hide panels when clicking outside
    document.addEventListener('click', (e) => {
        if (!arrowKeys.contains(e.target) && e.target !== arrowsBtn) {
            arrowKeys.style.display = 'none';
        }
        if (!quickCommandsPanel.contains(e.target) && e.target !== commandsBtn) {
            quickCommandsPanel.style.display = 'none';
        }
    });

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
                    term.options.fontSize = isSmallScreen ? 11 : 14;
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