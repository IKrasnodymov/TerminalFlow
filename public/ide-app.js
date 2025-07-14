// Simple IDE Application
class SimpleIDE {
    constructor() {
        this.term = null;
        this.fitAddon = null;
        this.socket = null;
        this.fileTree = {};
        this.currentPath = '/';
        
        this.init();
    }
    
    init() {
        // Check authentication
        const token = localStorage.getItem('token');
        if (!token) {
            window.location.href = '/auth.html';
            return;
        }
        
        this.setupTerminal();
        this.setupSocket(token);
        this.setupEventListeners();
        this.loadTheme();
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
            auth: { token }
        });
        
        this.socket.on('connect', () => {
            this.updateStatus('Connected', true);
            this.socket.emit('terminal:create', {
                cols: this.term.cols,
                rows: this.term.rows
            });
        });
        
        this.socket.on('terminal:ready', () => {
            this.term.focus();
        });
        
        this.socket.on('terminal:data', (data) => {
            this.term.write(data);
        });
        
        this.socket.on('disconnect', () => {
            this.updateStatus('Disconnected', false);
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
        
        // Theme toggle
        document.getElementById('theme-toggle').addEventListener('click', () => {
            this.toggleTheme();
        });
        
        // Logout
        document.getElementById('logout-btn').addEventListener('click', () => {
            if (confirm('Are you sure you want to logout?')) {
                localStorage.removeItem('token');
                window.location.href = '/auth.html';
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
        
        // Cmd button (runs common commands)
        const cmdBtn = document.getElementById('cmd-btn');
        if (cmdBtn) {
            cmdBtn.addEventListener('click', () => {
                const commands = ['ls -la', 'pwd', 'git status', 'npm run'];
                const cmd = prompt('Enter command:', commands[0]);
                if (cmd && this.socket && this.socket.connected) {
                    this.socket.emit('terminal:data', cmd + '\r');
                }
            });
        }
        
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
    
    loadTheme() {
        const savedTheme = localStorage.getItem('ide-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
        this.updateTerminalTheme(savedTheme);
    }
    
    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('ide-theme', newTheme);
        this.updateTerminalTheme(newTheme);
    }
    
    updateTerminalTheme(theme) {
        if (this.term) {
            const isDark = theme === 'dark';
            this.term.options.theme = {
                background: isDark ? '#000000' : '#ffffff',
                foreground: isDark ? '#ffffff' : '#000000',
                cursor: isDark ? '#ffffff' : '#000000',
                selection: isDark ? '#ffffff44' : '#00000044'
            };
        }
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