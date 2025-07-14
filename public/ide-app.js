// Simple IDE Application
class SimpleIDE {
    constructor() {
        this.term = null;
        this.fitAddon = null;
        this.socket = null;
        this.fileTree = {};
        this.currentPath = '/';
        this.sessionId = null;
        
        this.init();
    }
    
    init() {
        // Check authentication
        const token = localStorage.getItem('token');
        if (!token) {
            window.location.href = '/';
            return;
        }
        
        this.setupTerminal();
        this.setupSocket(token);
        this.setupEventListeners();
        this.loadFileTree();
    }
    
    setupTerminal() {
        this.term = new Terminal({
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
        
        this.fitAddon = new FitAddon.FitAddon();
        this.term.loadAddon(this.fitAddon);
        
        this.term.open(document.getElementById('terminal'));
        this.fitAddon.fit();
        
        // Handle resize
        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => {
                this.fitAddon.fit();
            }, 100);
        });
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
            
            // Check for existing session ID
            const storedSessionId = localStorage.getItem('terminal-session-id');
            
            this.socket.emit('terminal:create', {
                cols: this.term.cols,
                rows: this.term.rows,
                sessionId: storedSessionId || undefined
            });
        });
        
        this.socket.on('terminal:ready', (data) => {
            // Handle both old format (no data) and new format (with session info)
            if (data && data.sessionId) {
                this.sessionId = data.sessionId;
                localStorage.setItem('terminal-session-id', data.sessionId);
                
                if (!data.isNew) {
                    // Session was reconnected, show a message
                    this.term.writeln('\r\n\x1b[32m✓ Reconnected to existing session\x1b[0m\r\n');
                }
            }
            
            this.term.focus();
        });
        
        this.socket.on('terminal:data', (data) => {
            this.term.write(data);
        });
        
        this.socket.on('disconnect', () => {
            this.updateStatus('Disconnected', false);
        });
        
        this.socket.on('terminal:exit', () => {
            // Terminal process exited, clear session ID
            this.sessionId = null;
            localStorage.removeItem('terminal-session-id');
            this.term.writeln('\r\n\x1b[31mTerminal process exited.\x1b[0m');
            this.term.writeln('\x1b[33mPress Ctrl+R to start a new session or refresh the page.\x1b[0m\r\n');
            
            // Disable terminal input
            this.term.options.disableStdin = true;
            
            // Update status
            this.updateStatus('Session Ended', false);
            
            // Add keyboard shortcut for restart
            const restartHandler = (e) => {
                if (e.ctrlKey && e.key === 'r') {
                    e.preventDefault();
                    document.removeEventListener('keydown', restartHandler);
                    this.restartTerminal();
                }
            };
            document.addEventListener('keydown', restartHandler);
        });
        
        this.socket.on('files:list', (files) => {
            this.renderFileTree(files);
        });
        
        this.socket.on('file:content', (data) => {
            this.showFileContent(data.path, data.content);
        });
        
        // Terminal events
        this.term.onData((data) => {
            if (this.socket && this.socket.connected) {
                this.socket.emit('terminal:data', data);
            }
        });
        
        this.term.onResize(({ cols, rows }) => {
            if (this.socket && this.socket.connected) {
                this.socket.emit('terminal:resize', { cols, rows });
            }
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
        
        // Logout (Exit terminal)
        document.getElementById('logout-btn').addEventListener('click', async () => {
            const confirmed = await this.showConfirmDialog(
                'Exit Terminal',
                'Are you sure you want to exit the terminal session?'
            );
            
            if (confirmed) {
                // Send exit command to terminal
                if (this.socket && this.socket.connected) {
                    this.socket.emit('terminal:data', 'exit\r');
                }
            }
        });
        
        // Refresh files
        document.getElementById('refresh-files').addEventListener('click', () => {
            this.loadFileTree();
        });
        
        // Mobile terminal focus
        const termContainer = document.querySelector('.terminal-container');
        termContainer.addEventListener('click', () => {
            this.term.focus();
        });
        
        // Setup mobile controls
        this.setupMobileControls();
        
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
                if (this.socket && this.socket.connected) {
                    this.socket.emit('terminal:data', 'clear\r');
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
        
        // Arrow buttons
        document.querySelectorAll('.arrow-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.key;
                const sequences = {
                    'ArrowUp': '\x1b[A',
                    'ArrowDown': '\x1b[B',
                    'ArrowRight': '\x1b[C',
                    'ArrowLeft': '\x1b[D'
                };
                
                if (sequences[key] && this.socket && this.socket.connected) {
                    this.socket.emit('terminal:data', sequences[key]);
                }
            });
        });
    }
    
    sendKey(key, modifiers) {
        if (!this.socket || !this.socket.connected) return;
        
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
        
        this.socket.emit('terminal:data', data);
        
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
            this.socket.emit('files:list', this.currentPath);
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
                    this.socket.emit('file:read', path);
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
        if (this.socket && this.socket.connected) {
            this.socket.emit('terminal:data', cmd + '\r');
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
    restartTerminal() {
        // Clear old session
        this.sessionId = null;
        localStorage.removeItem('terminal-session-id');
        
        // Clear terminal
        this.term.clear();
        
        // Re-enable input
        this.term.options.disableStdin = false;
        
        // Create new terminal session
        if (this.socket && this.socket.connected) {
            this.socket.emit('terminal:create', {
                cols: this.term.cols,
                rows: this.term.rows
            });
        }
    }
    
    // Show notification
    showNotification(message, type = 'error') {
        // Simple notification in terminal
        const prefix = type === 'error' ? '\x1b[31m✗' : '\x1b[32m✓';
        const suffix = '\x1b[0m';
        this.term.writeln(`\r\n${prefix} ${message}${suffix}\r\n`);
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