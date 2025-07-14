// Simple IDE Application
class SimpleIDE {
    constructor() {
        this.terminals = new Map(); // Map of terminalId -> { term, fitAddon, sessionId, element }
        this.activeTerminalId = null;
        this.terminalCounter = 0;
        this.socket = null;
        this.fileTree = {};
        this.currentPath = '/';
        this.directoryCheckBuffer = '';
        this.lastDirectoryCheck = 0;
        
        this.init();
    }
    
    init() {
        // Check authentication
        const token = localStorage.getItem('token');
        if (!token) {
            window.location.href = '/';
            return;
        }
        
        // Force controls panel to be visible
        this.showControlsPanel();
        
        this.setupSocket(token);
        this.setupEventListeners();
        this.loadFileTree();
        
        // Handle window resize
        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => {
                // Resize all terminals
                this.terminals.forEach((terminal) => {
                    if (terminal.fitAddon) {
                        terminal.fitAddon.fit();
                    }
                });
            }, 100);
        });
    }
    
    createNewTerminal() {
        const terminalId = `terminal-${++this.terminalCounter}`;
        
        // Create container
        const container = document.createElement('div');
        container.className = 'terminal-container';
        container.id = `container-${terminalId}`;
        
        const termDiv = document.createElement('div');
        termDiv.className = 'terminal-instance';
        termDiv.id = terminalId;
        container.appendChild(termDiv);
        
        document.getElementById('terminals-wrapper').appendChild(container);
        
        // Create terminal
        const term = new Terminal({
            theme: {
                background: '#000000',
                foreground: '#ffffff',
                cursor: '#ffffff',
                selection: '#ffffff44'
            },
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'SF Mono, Monaco, Consolas, monospace',
            lineHeight: 1.2,
            scrollback: 10000
        });
        
        const fitAddon = new FitAddon.FitAddon();
        term.loadAddon(fitAddon);
        
        term.open(termDiv);
        fitAddon.fit();
        
        // Store terminal info
        this.terminals.set(terminalId, {
            term,
            fitAddon,
            sessionId: null,
            element: container,
            tabElement: null
        });
        
        // Create tab
        this.createTab(terminalId);
        
        // Activate this terminal
        this.activateTerminal(terminalId);
        
        // Setup terminal connection
        if (this.socket && this.socket.connected) {
            const storedSessionId = localStorage.getItem(`terminal-session-${terminalId}`);
            
            this.socket.emit('terminal:create', {
                terminalId,
                cols: term.cols,
                rows: term.rows,
                sessionId: storedSessionId || undefined
            });
        }
        
        return terminalId;
    }
    
    createTab(terminalId) {
        const tabsContainer = document.getElementById('tabs-container');
        const tab = document.createElement('div');
        tab.className = 'tab';
        tab.dataset.terminalId = terminalId;
        
        const icon = document.createElement('span');
        icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M7 10l3 3-3 3M12 17h5" stroke="#1e1e1e" stroke-width="2"/>
        </svg>`;
        
        const title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = `Terminal ${this.terminalCounter}`;
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close';
        closeBtn.innerHTML = '×';
        closeBtn.onclick = async (e) => {
            e.stopPropagation();
            
            // Check if it's the last terminal
            if (this.terminals.size === 1) {
                this.showNotification('Cannot close the last terminal', 'error');
                return;
            }
            
            // Show confirmation dialog
            const confirmed = await this.showConfirmDialog(
                'Close Terminal',
                'Are you sure you want to close this terminal? Any running processes will be terminated.'
            );
            
            if (confirmed) {
                this.closeTerminal(terminalId);
            }
        };
        
        tab.appendChild(icon);
        tab.appendChild(title);
        tab.appendChild(closeBtn);
        
        tab.onclick = () => this.activateTerminal(terminalId);
        
        tabsContainer.appendChild(tab);
        
        const terminal = this.terminals.get(terminalId);
        if (terminal) {
            terminal.tabElement = tab;
        }
    }
    
    activateTerminal(terminalId) {
        // Hide all terminals and deactivate tabs
        this.terminals.forEach((terminal, id) => {
            terminal.element.classList.remove('active');
            if (terminal.tabElement) {
                terminal.tabElement.classList.remove('active');
            }
        });
        
        // Show selected terminal and activate tab
        const terminal = this.terminals.get(terminalId);
        if (terminal) {
            terminal.element.classList.add('active');
            if (terminal.tabElement) {
                terminal.tabElement.classList.add('active');
            }
            this.activeTerminalId = terminalId;
            
            // Focus terminal
            terminal.term.focus();
            
            // Resize
            setTimeout(() => {
                terminal.fitAddon.fit();
            }, 0);
            
            // Refresh file list for this terminal's directory
            setTimeout(() => {
                this.loadFileTree();
            }, 100);
            
            // Ensure arrow key listeners are working with the active terminal
            this.setupArrowKeyListeners();
        }
    }
    
    closeTerminal(terminalId) {
        const terminal = this.terminals.get(terminalId);
        if (!terminal) return;
        
        // Don't close if it's the last terminal
        if (this.terminals.size === 1) {
            this.showNotification('Cannot close the last terminal', 'error');
            return;
        }
        
        // Send exit command
        if (this.socket && this.socket.connected) {
            this.socket.emit('terminal:close', { terminalId });
        }
        
        // Remove tab
        if (terminal.tabElement) {
            terminal.tabElement.remove();
        }
        
        // Remove container
        terminal.element.remove();
        
        // Dispose terminal
        terminal.term.dispose();
        
        // Remove from map
        this.terminals.delete(terminalId);
        
        // Clear stored session
        localStorage.removeItem(`terminal-session-${terminalId}`);
        
        // Activate another terminal
        if (this.activeTerminalId === terminalId) {
            const firstTerminal = this.terminals.keys().next().value;
            if (firstTerminal) {
                this.activateTerminal(firstTerminal);
            }
        }
    }
    
    setupSocket(token) {
        this.socket = io('/', {
            auth: { token },
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5
        });
        
        this.socket.on('connect', () => {
            this.updateStatus('Connected', true);
            
            // Create first terminal if none exist
            if (this.terminals.size === 0) {
                this.createNewTerminal();
            }
            
            // Re-setup event listeners after connection
            this.setupArrowKeyListeners();
        });
        
        this.socket.on('terminal:ready', (data) => {
            const terminalId = data.terminalId;
            const terminal = this.terminals.get(terminalId);
            if (!terminal) return;
            
            if (data && data.sessionId) {
                terminal.sessionId = data.sessionId;
                localStorage.setItem(`terminal-session-${terminalId}`, data.sessionId);
                
                if (!data.isNew) {
                    // Session was reconnected, show a message
                    terminal.term.writeln('\r\n\x1b[32m✓ Reconnected to existing session\x1b[0m\r\n');
                }
            }
            
            terminal.term.focus();
            
            // Set up data handler
            terminal.term.onData((data) => {
                if (this.socket && this.socket.connected) {
                    this.socket.emit('terminal:data', { terminalId, data });
                }
            });
            
            terminal.term.onResize(({ cols, rows }) => {
                if (this.socket && this.socket.connected) {
                    this.socket.emit('terminal:resize', { terminalId, cols, rows });
                }
            });
        });
        
        this.socket.on('terminal:data', (data) => {
            const terminal = this.terminals.get(data.terminalId);
            if (terminal) {
                terminal.term.write(data.data);
                
                // Check if we need to refresh file list (on directory change)
                if (data.terminalId === this.activeTerminalId) {
                    this.checkForDirectoryChange(data.data);
                }
            }
        });
        
        this.socket.on('disconnect', () => {
            this.updateStatus('Disconnected', false);
        });
        
        this.socket.on('terminal:exit', (data) => {
            const terminal = this.terminals.get(data.terminalId);
            if (!terminal) return;
            
            // Terminal process exited, clear session ID
            terminal.sessionId = null;
            localStorage.removeItem(`terminal-session-${data.terminalId}`);
            
            // If we have more than one terminal, close this one
            if (this.terminals.size > 1) {
                this.closeTerminal(data.terminalId);
            } else {
                // If it's the last terminal, show message and disable input
                terminal.term.writeln('\r\n\x1b[31mTerminal process exited.\x1b[0m');
                terminal.term.writeln('\x1b[33mClick + to create a new terminal or press Ctrl+R to restart.\x1b[0m\r\n');
                
                // Disable terminal input
                terminal.term.options.disableStdin = true;
                
                // Update tab title
                if (terminal.tabElement) {
                    const title = terminal.tabElement.querySelector('.tab-title');
                    if (title) {
                        title.textContent += ' (exited)';
                    }
                }
                
                // Add keyboard shortcut for restart
                const restartHandler = (e) => {
                    if (e.ctrlKey && e.key === 'r') {
                        e.preventDefault();
                        document.removeEventListener('keydown', restartHandler);
                        this.restartTerminal(data.terminalId);
                    }
                };
                document.addEventListener('keydown', restartHandler);
            }
        });
        
        this.socket.on('files:list', (files) => {
            this.renderFileTree(files);
        });
        
        this.socket.on('file:content', (data) => {
            this.showFileContent(data.path, data.content);
        });
    }
    
    setupEventListeners() {
        // Toggle sidebar
        const toggleBtn = document.getElementById('toggle-sidebar');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('mobile-overlay');
        
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('open');
        });
        
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('open');
        });
        
        // Exit Terminal Session
        const exitTerminalBtn = document.getElementById('exit-terminal-btn');
        if (exitTerminalBtn) {
            exitTerminalBtn.addEventListener('click', async () => {
                const confirmed = await this.showConfirmDialog(
                    'Exit Terminal',
                    'Are you sure you want to exit the terminal session?'
                );
                
                if (confirmed) {
                    // Send exit command to terminal
                    if (this.socket && this.socket.connected && this.activeTerminalId) {
                        this.socket.emit('terminal:data', {
                            terminalId: this.activeTerminalId,
                            data: 'exit\r'
                        });
                    }
                }
            });
        }
        
        // Logout
        document.getElementById('logout-btn').addEventListener('click', async () => {
            const confirmed = await this.showConfirmDialog(
                'Logout',
                'Are you sure you want to logout? You will need to authenticate again.'
            );
            
            if (confirmed) {
                // Disconnect socket
                if (this.socket && this.socket.connected) {
                    this.socket.disconnect();
                }
                
                // Clear all session data
                localStorage.removeItem('token');
                localStorage.removeItem('terminal-session-id');
                
                // Redirect to login page
                window.location.href = '/';
            }
        });
        
        // Refresh files
        document.getElementById('refresh-files').addEventListener('click', () => {
            console.log('Refreshing file tree manually');
            this.loadFileTree();
        });
        
        // Mobile terminal focus
        const terminalsWrapper = document.getElementById('terminals-wrapper');
        if (terminalsWrapper) {
            terminalsWrapper.addEventListener('click', (e) => {
                if (this.activeTerminalId) {
                    const terminal = this.terminals.get(this.activeTerminalId);
                    if (terminal) {
                        terminal.term.focus();
                    }
                }
            });
        }
        
        // Setup mobile controls
        this.setupMobileControls();
        
        // Add terminal button
        const addTerminalBtn = document.getElementById('add-terminal-btn');
        if (addTerminalBtn) {
            addTerminalBtn.addEventListener('click', () => {
                this.createNewTerminal();
            });
        }
        
        // Close file viewer
        const closeBtn = document.getElementById('close-file');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.closeFileViewer();
            });
        }
    }
    
    setupMobileControls() {
        // Modifier keys state
        const modifiers = {
            ctrl: false,
            alt: false,
            shift: false
        };
        
        // Modifier buttons
        ['ctrl', 'alt', 'shift'].forEach(key => {
            const btn = document.getElementById(`${key}-btn`);
            if (btn) {
                btn.addEventListener('click', () => {
                    modifiers[key] = !modifiers[key];
                    btn.classList.toggle('active', modifiers[key]);
                });
            }
        });
        
        // Tab key
        const tabBtn = document.getElementById('tab-btn');
        if (tabBtn) {
            tabBtn.addEventListener('click', () => {
                this.sendKey('\t', modifiers);
            });
        }
        
        // Escape key
        const escBtn = document.getElementById('esc-btn');
        if (escBtn) {
            escBtn.addEventListener('click', () => {
                this.sendKey('\x1b', modifiers);
            });
        }
        
        // Clear button
        const clearBtn = document.getElementById('clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (this.socket && this.socket.connected && this.activeTerminalId) {
                    this.socket.emit('terminal:data', {
                        terminalId: this.activeTerminalId,
                        data: 'clear\r'
                    });
                }
            });
        }
        
        // Cmd button (shows command palette)
        const cmdBtn = document.getElementById('cmd-btn');
        if (cmdBtn) {
            cmdBtn.addEventListener('click', async () => {
                await this.showCommandPalette();
            });
        }
        
        // Setup command palette
        this.setupCommandPalette();
        
        // Arrow keys toggle
        const arrowsToggle = document.getElementById('arrows-toggle');
        const arrowKeys = document.getElementById('arrow-keys');
        if (arrowsToggle && arrowKeys) {
            arrowsToggle.addEventListener('click', () => {
                arrowKeys.style.display = arrowKeys.style.display === 'none' ? 'block' : 'none';
            });
        }
        
        // Setup arrow key listeners
        this.setupArrowKeyListeners();
    }
    
    setupArrowKeyListeners() {
        // Remove existing listeners first
        document.querySelectorAll('.arrow-btn').forEach(btn => {
            btn.replaceWith(btn.cloneNode(true));
        });
        
        // Add new listeners
        document.querySelectorAll('.arrow-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.key;
                const sequences = {
                    'ArrowUp': '\x1b[A',
                    'ArrowDown': '\x1b[B',
                    'ArrowRight': '\x1b[C',
                    'ArrowLeft': '\x1b[D',
                    'Enter': '\r'
                };
                
                if (sequences[key] && this.socket && this.socket.connected) {
                    if (!this.activeTerminalId) {
                        console.error('No active terminal ID available');
                        return;
                    }
                    this.socket.emit('terminal:data', {
                        terminalId: this.activeTerminalId,
                        data: sequences[key]
                    });
                } else {
                    console.log('Arrow key click conditions not met:', {
                        key,
                        hasSequence: !!sequences[key],
                        hasSocket: !!this.socket,
                        isConnected: this.socket && this.socket.connected,
                        activeTerminalId: this.activeTerminalId
                    });
                }
            });
        });
    }
    
    sendKey(key, modifiers) {
        if (!this.socket || !this.socket.connected || !this.activeTerminalId) return;
        
        let data = key;
        
        // Apply modifiers
        if (modifiers.ctrl && key.length === 1) {
            // Convert to control character
            const code = key.charCodeAt(0);
            if (code >= 64 && code <= 95) {
                data = String.fromCharCode(code - 64);
            } else if (code >= 97 && code <= 122) {
                data = String.fromCharCode(code - 96);
            }
        }
        
        this.socket.emit('terminal:data', {
            terminalId: this.activeTerminalId,
            data
        });
        
        // Reset modifiers after use
        ['ctrl', 'alt', 'shift'].forEach(mod => {
            if (modifiers[mod]) {
                modifiers[mod] = false;
                const btn = document.getElementById(`${mod}-btn`);
                if (btn) btn.classList.remove('active');
            }
        });
    }
    
    updateStatus(message, connected) {
        const status = document.getElementById('connection-status');
        status.textContent = `● ${message}`;
        status.style.color = connected ? 'var(--status-connected)' : 'var(--status-error)';
    }
    
    loadFileTree() {
        if (this.socket && this.socket.connected) {
            // Send the active terminal ID to get files from its current directory
            this.socket.emit('files:list', {
                terminalId: this.activeTerminalId
            });
        }
    }
    
    renderFileTree(files) {
        const treeContainer = document.getElementById('file-tree');
        
        if (!files || files.length === 0) {
            treeContainer.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                        <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9l-7-7z"/>
                        <path d="M13 2v7h7"/>
                    </svg>
                    <p>No files found</p>
                </div>
            `;
            return;
        }
        
        // Update file count
        document.getElementById('file-count').textContent = `${files.length} files`;
        
        // Build tree structure
        const tree = this.buildTreeStructure(files);
        treeContainer.innerHTML = this.renderTreeNodes(tree);
        
        // Add click handlers
        this.attachTreeHandlers();
    }
    
    buildTreeStructure(files) {
        const tree = {};
        
        files.forEach(file => {
            const parts = file.path.split('/').filter(p => p);
            let current = tree;
            
            parts.forEach((part, index) => {
                if (index === parts.length - 1) {
                    // File
                    current[part] = {
                        type: 'file',
                        name: part,
                        path: file.path
                    };
                } else {
                    // Directory
                    if (!current[part]) {
                        current[part] = {
                            type: 'folder',
                            name: part,
                            children: {}
                        };
                    }
                    current = current[part].children;
                }
            });
        });
        
        return tree;
    }
    
    renderTreeNodes(nodes, level = 0) {
        let html = '';
        
        Object.keys(nodes).sort((a, b) => {
            // Folders first
            if (nodes[a].type !== nodes[b].type) {
                return nodes[a].type === 'folder' ? -1 : 1;
            }
            return a.localeCompare(b);
        }).forEach(key => {
            const node = nodes[key];
            
            if (node.type === 'folder') {
                html += `
                    <div class="tree-folder" data-path="${key}">
                        <div class="tree-item" style="padding-left: ${16 + level * 16}px">
                            <svg class="tree-item-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                            </svg>
                            <svg class="tree-item-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/>
                            </svg>
                            <span>${node.name}</span>
                        </div>
                        <div class="tree-children">
                            ${node.children ? this.renderTreeNodes(node.children, level + 1) : ''}
                        </div>
                    </div>
                `;
            } else {
                const icon = this.getFileIcon(node.name);
                html += `
                    <div class="tree-item" data-path="${node.path}" style="padding-left: ${16 + level * 16}px">
                        <span class="tree-item-icon">${icon}</span>
                        <span>${node.name}</span>
                    </div>
                `;
            }
        });
        
        return html;
    }
    
    getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const icons = {
            js: '📜',
            ts: '📘',
            json: '📋',
            html: '🌐',
            css: '🎨',
            md: '📝',
            txt: '📄',
            sh: '⚙️',
            yml: '📦',
            yaml: '📦',
            env: '🔐'
        };
        
        return icons[ext] || '📄';
    }
    
    attachTreeHandlers() {
        // Folder toggle
        document.querySelectorAll('.tree-folder').forEach(folder => {
            const header = folder.querySelector('.tree-item');
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                folder.classList.toggle('expanded');
            });
        });
        
        // File click
        document.querySelectorAll('.tree-item[data-path]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // Remove previous selection
                document.querySelectorAll('.tree-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                
                // Open file for viewing
                const path = item.dataset.path;
                if (this.socket && this.socket.connected) {
                    this.socket.emit('file:read', {
                        path: path,
                        terminalId: this.activeTerminalId
                    });
                }
            });
        });
    }
    
    showFileContent(path, content) {
        const fileViewer = document.getElementById('file-viewer');
        const fileName = document.getElementById('file-name');
        const fileCode = document.getElementById('file-code');
        
        if (fileViewer && fileName && fileCode) {
            fileName.textContent = path.split('/').pop();
            fileCode.textContent = content;
            fileViewer.style.display = 'flex';
        }
    }
    
    closeFileViewer() {
        const fileViewer = document.getElementById('file-viewer');
        if (fileViewer) {
            fileViewer.style.display = 'none';
        }
    }
    
    setupCommandPalette() {
        const palette = document.getElementById('command-palette');
        const closeBtn = document.getElementById('close-commands');
        const commandList = document.getElementById('command-list');
        const newCommandInput = document.getElementById('new-command-input');
        const runBtn = document.getElementById('run-command');
        
        // Close button
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hideCommandPalette();
            });
        }
        
        // Click on command items and action buttons
        if (commandList) {
            commandList.addEventListener('click', async (e) => {
                const editBtn = e.target.closest('.cmd-action-btn.edit');
                const deleteBtn = e.target.closest('.cmd-action-btn.delete');
                const item = e.target.closest('.command-item');
                
                if (editBtn && item) {
                    e.stopPropagation();
                    e.preventDefault();
                    this.editCommand(item);
                    return;
                }
                
                if (deleteBtn && item) {
                    e.stopPropagation();
                    e.preventDefault();
                    const cmdText = item.querySelector('.command-text').textContent;
                    const confirmed = await this.showConfirmDialog(
                        'Delete Command',
                        `Are you sure you want to delete the command "${cmdText}"?`
                    );
                    if (confirmed) {
                        await this.deleteCommand(item.dataset.id);
                    }
                    return;
                }
                
                if (item && !item.classList.contains('editing') && !e.target.closest('.command-actions')) {
                    const cmd = item.dataset.cmd;
                    this.runCommand(cmd);
                    this.hideCommandPalette();
                }
            });
        }
        
        // Add command form
        const addCommandForm = document.getElementById('add-command-form');
        const newDescInput = document.getElementById('new-desc-input');
        
        if (addCommandForm) {
            addCommandForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const cmd = newCommandInput.value.trim();
                const desc = newDescInput.value.trim() || 'Custom command';
                
                if (cmd) {
                    await this.addCommand(cmd, desc);
                    newCommandInput.value = '';
                    newDescInput.value = '';
                    newCommandInput.focus();
                }
            });
        }
        
        // Click outside to close
        if (palette) {
            palette.addEventListener('click', (e) => {
                if (e.target === palette) {
                    this.hideCommandPalette();
                }
            });
        }
    }
    
    async showCommandPalette() {
        const palette = document.getElementById('command-palette');
        const input = document.getElementById('new-command-input');
        if (palette) {
            palette.style.display = 'flex';
            await this.loadCommands();
            if (input) {
                input.focus();
            }
        }
    }
    
    hideCommandPalette() {
        const palette = document.getElementById('command-palette');
        if (palette) {
            palette.style.display = 'none';
        }
    }
    
    runCommand(cmd) {
        if (this.socket && this.socket.connected && this.activeTerminalId) {
            this.socket.emit('terminal:data', {
                terminalId: this.activeTerminalId,
                data: cmd + '\r'
            });
        }
    }
    
    async loadCommands() {
        const commandList = document.getElementById('command-list');
        if (!commandList) return;
        
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/commands', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.renderCommands(data.commands);
            } else {
                console.error('Failed to load commands:', response.status);
                // Show default commands if API fails
                this.renderDefaultCommands();
            }
        } catch (error) {
            console.error('Error loading commands:', error);
            // Show default commands if API fails
            this.renderDefaultCommands();
        }
    }
    
    renderDefaultCommands() {
        const defaultCommands = [
            { id: 'default-1', cmd: 'ls -la', desc: 'List all files' },
            { id: 'default-2', cmd: 'pwd', desc: 'Current directory' },
            { id: 'default-3', cmd: 'git status', desc: 'Git status' },
            { id: 'default-4', cmd: 'clear', desc: 'Clear terminal' }
        ];
        this.renderCommands(defaultCommands);
    }
    
    renderCommands(commands) {
        const commandList = document.getElementById('command-list');
        if (!commandList) return;
        
        commandList.innerHTML = '';
        
        commands.forEach(cmd => {
            const div = document.createElement('div');
            div.className = 'command-item';
            div.dataset.cmd = cmd.cmd;
            div.dataset.id = cmd.id;
            
            div.innerHTML = `
                <div class="command-content">
                    <div class="command-text">${this.escapeHtml(cmd.cmd)}</div>
                    <div class="command-desc">${this.escapeHtml(cmd.desc)}</div>
                </div>
                <div class="command-actions">
                    <button class="cmd-action-btn edit">Edit</button>
                    <button class="cmd-action-btn delete">Delete</button>
                </div>
            `;
            
            commandList.appendChild(div);
        });
    }
    
    async addCommand(cmd, desc) {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/commands', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ cmd, desc })
            });
            
            if (response.ok) {
                await this.loadCommands();
            } else {
                this.showNotification('Failed to add command', 'error');
            }
        } catch (error) {
            console.error('Error adding command:', error);
            this.showNotification('Failed to add command', 'error');
        }
    }
    
    async deleteCommand(commandId) {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/commands/${commandId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                await this.loadCommands();
            } else {
                this.showNotification('Failed to delete command', 'error');
            }
        } catch (error) {
            console.error('Error deleting command:', error);
            this.showNotification('Failed to delete command', 'error');
        }
    }
    
    editCommand(item) {
        const content = item.querySelector('.command-content');
        const currentCmd = item.dataset.cmd;
        const currentDesc = content.querySelector('.command-desc').textContent;
        
        item.classList.add('editing');
        item.innerHTML = `
            <form class="command-edit-form">
                <input type="text" class="edit-input" id="edit-cmd" value="${this.escapeHtml(currentCmd)}" placeholder="Command">
                <input type="text" class="edit-input" id="edit-desc" value="${this.escapeHtml(currentDesc)}" placeholder="Description">
                <div class="edit-actions">
                    <button type="submit" class="edit-btn save">Save</button>
                    <button type="button" class="edit-btn cancel">Cancel</button>
                </div>
            </form>
        `;
        
        const form = item.querySelector('form');
        const cancelBtn = item.querySelector('.cancel');
        
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newCmd = item.querySelector('#edit-cmd').value.trim();
            const newDesc = item.querySelector('#edit-desc').value.trim();
            
            if (newCmd && newDesc) {
                await this.updateCommand(item.dataset.id, newCmd, newDesc);
            }
        });
        
        cancelBtn.addEventListener('click', () => {
            this.loadCommands();
        });
        
        item.querySelector('#edit-cmd').focus();
    }
    
    async updateCommand(commandId, cmd, desc) {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/commands/${commandId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ cmd, desc })
            });
            
            if (response.ok) {
                await this.loadCommands();
            } else {
                this.showNotification('Failed to update command', 'error');
            }
        } catch (error) {
            console.error('Error updating command:', error);
            this.showNotification('Failed to update command', 'error');
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Restart terminal session
    restartTerminal(terminalId) {
        const terminal = this.terminals.get(terminalId || this.activeTerminalId);
        if (!terminal) return;
        
        // Clear old session
        terminal.sessionId = null;
        localStorage.removeItem(`terminal-session-${terminalId}`);
        
        // Clear terminal
        terminal.term.clear();
        
        // Re-enable input
        terminal.term.options.disableStdin = false;
        
        // Create new terminal session
        if (this.socket && this.socket.connected) {
            this.socket.emit('terminal:create', {
                terminalId: terminalId || this.activeTerminalId,
                cols: terminal.term.cols,
                rows: terminal.term.rows
            });
        }
    }
    
    // Show notification
    showNotification(message, type = 'error') {
        // Simple notification in active terminal
        if (this.activeTerminalId) {
            const terminal = this.terminals.get(this.activeTerminalId);
            if (terminal) {
                const prefix = type === 'error' ? '\x1b[31m✗' : '\x1b[32m✓';
                const suffix = '\x1b[0m';
                terminal.term.writeln(`\r\n${prefix} ${message}${suffix}\r\n`);
            }
        }
    }
    
    // Custom confirmation dialog
    showConfirmDialog(title, message) {
        return new Promise((resolve) => {
            const overlay = document.getElementById('confirm-dialog-overlay');
            const titleEl = document.getElementById('confirm-dialog-title');
            const messageEl = document.getElementById('confirm-dialog-message');
            const cancelBtn = document.getElementById('confirm-cancel');
            const okBtn = document.getElementById('confirm-ok');
            
            // Set content
            titleEl.textContent = title;
            messageEl.textContent = message;
            
            // Show dialog
            overlay.style.display = 'flex';
            
            // Handle buttons
            const handleCancel = () => {
                overlay.style.display = 'none';
                resolve(false);
                cleanup();
            };
            
            const handleOk = () => {
                overlay.style.display = 'none';
                resolve(true);
                cleanup();
            };
            
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    handleCancel();
                }
            };
            
            const cleanup = () => {
                cancelBtn.removeEventListener('click', handleCancel);
                okBtn.removeEventListener('click', handleOk);
                document.removeEventListener('keydown', handleEscape);
            };
            
            // Add event listeners
            cancelBtn.addEventListener('click', handleCancel);
            okBtn.addEventListener('click', handleOk);
            document.addEventListener('keydown', handleEscape);
            
            // Focus on cancel button for safety
            cancelBtn.focus();
        });
    }
    
    checkForDirectoryChange(data) {
        // Add data to buffer
        this.directoryCheckBuffer += data;
        
        // Check for newlines in buffer
        const lines = this.directoryCheckBuffer.split('\n');
        
        // Keep last incomplete line in buffer
        this.directoryCheckBuffer = lines[lines.length - 1];
        
        // Process complete lines
        const now = Date.now();
        if (now - this.lastDirectoryCheck > 500) { // Throttle checks
            for (let i = 0; i < lines.length - 1; i++) {
                const line = lines[i].trim();
                
                // Look for command prompts that might indicate directory change
                // Common patterns: user@host:~/path$ or just path$
                if (line.includes('$') || line.includes('#') || line.includes('>')) {
                    // Check if this looks like a prompt with a path
                    const promptMatch = line.match(/[~\/][^$#>]*[$#>]/);
                    if (promptMatch) {
                        // Directory might have changed, refresh file list
                        setTimeout(() => this.loadFileTree(), 100);
                        this.lastDirectoryCheck = now;
                        break;
                    }
                }
                
                // Check for cd command execution (user input)
                if (line.match(/^cd\s+/) || line === 'cd') {
                    // cd command detected, refresh after a delay
                    setTimeout(() => this.loadFileTree(), 500);
                    this.lastDirectoryCheck = now;
                    break;
                }
                
                // Check for absolute path output (from pwd command)
                if (line.match(/^\/[^\s]+$/)) {
                    // Absolute path detected (likely from pwd), refresh file list
                    setTimeout(() => this.loadFileTree(), 100);
                    this.lastDirectoryCheck = now;
                    break;
                }
            }
        }
    }
    
    showControlsPanel() {
        // Force controls panel to be visible on all devices
        const controlsPanel = document.querySelector('.mobile-controls');
        if (controlsPanel) {
            controlsPanel.style.display = 'flex';
            controlsPanel.style.visibility = 'visible';
            controlsPanel.style.opacity = '1';
            
            console.log('Controls panel forced to be visible');
        } else {
            console.log('Controls panel not found');
        }
    }
}

// Mock file data for testing (remove when API is ready)
function mockFileTree() {
    return [
        { path: '/src/server.ts' },
        { path: '/src/config.ts' },
        { path: '/src/services/TerminalManager.ts' },
        { path: '/src/services/AccessCodeService.ts' },
        { path: '/src/services/EmailService.ts' },
        { path: '/public/index.html' },
        { path: '/public/app.js' },
        { path: '/public/style.css' },
        { path: '/package.json' },
        { path: '/README.md' }
    ];
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.ide = new SimpleIDE();
    
    // Temporary: Use mock data if socket doesn't provide files
    setTimeout(() => {
        const treeContainer = document.getElementById('file-tree');
        if (treeContainer && treeContainer.innerHTML.includes('Loading')) {
            window.ide.renderFileTree(mockFileTree());
        }
    }, 1000);
});