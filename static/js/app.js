// Claude Chat Client JavaScript Application
class ClaudeChatClient {
    constructor() {
        this.sessionId = this.generateSessionId();
        this.currentEventSource = null;
        this.artifacts = [];
        this.slideApiKey = null;
        this.processedToolIds = new Set(); // Track processed tool use blocks
        this.pendingAfterToolContent = null; // Track content to show after tool blocks
        
        this.initializeElements();
        this.setupEventListeners();
        this.initializeTime();
        this.configureMarkdown();
        this.loadApiKey();
    }
    
    initializeElements() {
        this.chatForm = document.getElementById('chat-form');
        this.messageInput = document.getElementById('message-input');
        this.sendButton = document.getElementById('send-button');
        this.chatMessages = document.getElementById('chat-messages');
        this.artifactContent = document.getElementById('artifact-content');
        this.statusIndicator = document.getElementById('status-indicator');
        this.clearArtifactsBtn = document.getElementById('clear-artifacts');
        this.characterCount = document.querySelector('.character-count');
        this.loadingOverlay = document.getElementById('loading-overlay');
        
        // API Key elements
        this.apiKeyButton = document.getElementById('api-key-button');
        this.apiKeyModal = document.getElementById('api-key-modal');
        this.apiKeyInput = document.getElementById('api-key-input');
        this.apiKeyStatus = document.getElementById('api-key-status');
        this.modalClose = document.getElementById('modal-close');
        this.saveApiKey = document.getElementById('save-api-key');
        this.removeApiKey = document.getElementById('remove-api-key');
        this.cancelModal = document.getElementById('cancel-modal');
        this.toggleVisibility = document.getElementById('toggle-visibility');
    }
    
    setupEventListeners() {
        // Chat form submission
        this.chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendMessage();
        });
        
        // Auto-resize textarea and character count
        this.messageInput.addEventListener('input', (e) => {
            this.updateCharacterCount();
            this.autoResizeTextarea();
        });
        
        // Enter key to send (Shift+Enter for new line)
        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Clear artifacts
        this.clearArtifactsBtn.addEventListener('click', () => {
            this.clearArtifacts();
        });
        
        // API Key modal events
        this.apiKeyButton.addEventListener('click', () => {
            this.openApiKeyModal();
        });
        
        this.modalClose.addEventListener('click', () => {
            this.closeApiKeyModal();
        });
        
        this.cancelModal.addEventListener('click', () => {
            this.closeApiKeyModal();
        });
        
        this.saveApiKey.addEventListener('click', () => {
            this.saveApiKeyHandler();
        });
        
        this.removeApiKey.addEventListener('click', () => {
            this.removeApiKeyHandler();
        });
        
        this.toggleVisibility.addEventListener('click', () => {
            this.togglePasswordVisibility();
        });
        
        // Close modal on overlay click
        this.apiKeyModal.addEventListener('click', (e) => {
            if (e.target === this.apiKeyModal) {
                this.closeApiKeyModal();
            }
        });
        
        // Handle page unload
        window.addEventListener('beforeunload', () => {
            if (this.currentEventSource) {
                this.currentEventSource.close();
            }
        });
    }
    
    generateSessionId() {
        return 'session_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    }
    
    initializeTime() {
        // Set the time for the welcome message
        const welcomeTime = document.getElementById('welcome-time');
        if (welcomeTime) {
            welcomeTime.textContent = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }
    }
    
    configureMarkdown() {
        // Configure marked.js for extended markdown syntax
        if (typeof marked !== 'undefined') {
            marked.setOptions({
                breaks: true,
                gfm: true, // GitHub Flavored Markdown
                tables: true,
                sanitize: false, // Allow HTML in markdown
                smartLists: true,
                smartypants: true, // Smart quotes, dashes, ellipses
                highlight: function(code, language) {
                    if (language && hljs.getLanguage(language)) {
                        try {
                            return hljs.highlight(code, { language: language }).value;
                        } catch (e) {
                            console.warn('Highlight.js error:', e);
                        }
                    }
                    return hljs.highlightAuto(code).value;
                }
            });
        }
    }
    
    updateCharacterCount() {
        const length = this.messageInput.value.length;
        this.characterCount.textContent = `${length}/4000`;
        
        if (length > 3800) {
            this.characterCount.style.color = '#dc2626';
        } else if (length > 3000) {
            this.characterCount.style.color = '#f59e0b';
        } else {
            this.characterCount.style.color = '#9ca3af';
        }
    }
    
    autoResizeTextarea() {
        this.messageInput.style.height = 'auto';
        const maxHeight = 150;
        const newHeight = Math.min(this.messageInput.scrollHeight, maxHeight);
        this.messageInput.style.height = newHeight + 'px';
    }
    
    setStatus(status, text) {
        const statusDot = this.statusIndicator.querySelector('.status-dot');
        const statusText = this.statusIndicator.querySelector('.status-text');
        
        statusDot.className = 'status-dot';
        switch (status) {
            case 'ready':
                statusDot.classList.add('status-ready');
                break;
            case 'thinking':
                statusDot.classList.add('status-thinking');
                break;
            case 'error':
                statusDot.classList.add('status-error');
                break;
        }
        
        statusText.textContent = text;
    }
    
    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message || this.currentEventSource) return;
        
        // Clear processed tool IDs for new conversation
        this.processedToolIds.clear();
        this.pendingAfterToolContent = null;
        
        // Add user message to chat
        this.addMessage('user', message);
        
        // Clear input and reset height
        this.messageInput.value = '';
        this.messageInput.style.height = 'auto';
        this.updateCharacterCount();
        
        // Disable input during processing
        this.setInputEnabled(false);
        this.setStatus('thinking', 'Claude is thinking...');
        
        // Add typing indicator
        const typingIndicator = this.addTypingIndicator();
        
        try {
            await this.streamResponse(message, typingIndicator);
        } catch (error) {
            this.handleError(error, typingIndicator);
        }
    }
    
    setInputEnabled(enabled) {
        this.messageInput.disabled = !enabled;
        this.sendButton.disabled = !enabled;
        
        if (enabled) {
            this.messageInput.focus();
        }
    }
    
    addMessage(role, content, timestamp = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}-message`;
        
        const time = timestamp || new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const senderName = role === 'user' ? 'You' : 'Claude';
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="message-sender">${senderName}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-content">
                ${role === 'user' ? this.escapeHtml(content) : this.renderMarkdown(content)}
            </div>
        `;
        
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
        
        return messageDiv;
    }
    
    addTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'typing-indicator';
        typingDiv.innerHTML = `
            <div class="message-header">
                <span class="message-sender">Claude</span>
                <span class="message-time">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
            <div class="typing-dots">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;
        
        this.chatMessages.appendChild(typingDiv);
        this.scrollToBottom();
        
        return typingDiv;
    }
    
    async streamResponse(message, typingIndicator) {
        return new Promise((resolve, reject) => {
            const eventSource = new EventSource('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    session_id: this.sessionId
                })
            });
            
            // Note: EventSource doesn't support POST directly, so we'll use fetch with streaming
            this.streamWithFetch(message)
                .then(resolve)
                .catch(reject);
        });
    }
    
    async streamWithFetch(message) {
        return new Promise((resolve, reject) => {
            fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    session_id: this.sessionId
                })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                
                let assistantMessage = null;
                let fullContent = '';
                let currentBuffer = '';
                let inToolUse = false;
                let inToolError = false;
                
                // Remove typing indicator
                const typingIndicator = document.querySelector('.typing-indicator');
                if (typingIndicator) {
                    typingIndicator.remove();
                }
                
                const processStream = () => {
                    reader.read().then(({ done, value }) => {
                        if (done) {
                            this.setInputEnabled(true);
                            this.setStatus('ready', 'Ready');
                            resolve();
                            return;
                        }
                        
                        const chunk = decoder.decode(value, { stream: true });
                        currentBuffer += chunk;
                        
                        // Process complete lines
                        const lines = currentBuffer.split('\n');
                        currentBuffer = lines.pop() || ''; // Keep incomplete line in buffer
                        
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                try {
                                    const data = JSON.parse(line.slice(6));
                                    
                                    if (data.type === 'text') {
                                        if (!assistantMessage) {
                                            assistantMessage = this.addMessage('assistant', '');
                                        }
                                        
                                        fullContent += data.content;
                                        
                                        // Check if this chunk contains tool use and handle it immediately
                                        const processedResult = this.processStreamingChunk(fullContent);
                                        fullContent = processedResult.cleanContent;
                                        
                                        // Update the chat message with clean content
                                        const contentDiv = assistantMessage.querySelector('.message-content');
                                        contentDiv.innerHTML = this.renderMarkdown(fullContent);
                                        this.scrollToBottom();
                                        
                                    } else if (data.type === 'artifacts_update') {
                                        this.updateStreamingArtifacts(data.content);
                                        
                                    } else if (data.type === 'artifacts_remove') {
                                        this.removeArtifacts(data.content);
                                        
                                    } else if (data.type === 'artifact') {
                                        this.addArtifact(data.content);
                                       
                                    } else if (data.type === 'complete') {
                                        this.setInputEnabled(true);
                                        this.setStatus('ready', 'Ready');
                                        resolve();
                                        return;
                                        
                                    } else if (data.type === 'error') {
                                        throw new Error(data.content);
                                    }
                                } catch (e) {
                                    console.error('Error parsing stream data:', e);
                                }
                            }
                            // Handle tool use markers
                            else if (line === 'TOOL_USE_START') {
                                inToolUse = true;
                            }
                            else if (line === 'TOOL_USE_END') {
                                inToolUse = false;
                            }
                            else if (line === 'TOOL_ERROR_START') {
                                inToolError = true;
                            }
                            else if (line === 'TOOL_ERROR_END') {
                                inToolError = false;
                            }
                            else if (inToolUse) {
                                // This is tool use data
                                try {
                                    const toolData = JSON.parse(line);
                                    this.addToolUseBlock(toolData);
                                } catch (e) {
                                    console.error('Error parsing tool use data:', e);
                                }
                            }
                            else if (inToolError) {
                                // This is tool error data
                                try {
                                    const errorData = JSON.parse(line);
                                    this.addToolErrorBlock(errorData);
                                } catch (e) {
                                    console.error('Error parsing tool error data:', e);
                                }
                            }
                            else if (line.trim() && !line.startsWith('data: ')) {
                                // Check for tool use markers within the text
                                if (line.includes('TOOL_USE_START') || line.includes('TOOL_USE_END') || 
                                    line.includes('TOOL_ERROR_START') || line.includes('TOOL_ERROR_END')) {
                                    
                                    // Process tool use data and filter out markers from chat content
                                    const filteredLine = this.processToolUseInText(line);
                                    
                                    // Only add filtered content if there's meaningful text left
                                    if (filteredLine && filteredLine.trim()) {
                                        if (!assistantMessage) {
                                            assistantMessage = this.addMessage('assistant', '');
                                        }
                                        
                                        fullContent += filteredLine + '\n';
                                        const contentDiv = assistantMessage.querySelector('.message-content');
                                        contentDiv.innerHTML = this.renderMarkdown(fullContent);
                                        this.scrollToBottom();
                                    }
                                } else {
                                    // Regular streaming text (not JSON data)
                                    if (!assistantMessage) {
                                        assistantMessage = this.addMessage('assistant', '');
                                    }
                                    
                                    fullContent += line + '\n';
                                    const contentDiv = assistantMessage.querySelector('.message-content');
                                    contentDiv.innerHTML = this.renderMarkdown(fullContent);
                                    this.scrollToBottom();
                                }
                            }
                        }
                        
                        processStream();
                    }).catch(reject);
                };
                
                processStream();
            })
            .catch(reject);
        });
    }
    
    renderMarkdown(content) {
        // Simple markdown rendering for chat messages
        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>')
            .replace(/^- (.+)/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    }
    
    renderFullMarkdown(content) {
        // Full markdown rendering for artifacts using marked.js
        if (typeof marked !== 'undefined') {
            try {
                return marked.parse(content);
            } catch (e) {
                console.warn('Markdown parsing error:', e);
                return `<pre>${this.escapeHtml(content)}</pre>`;
            }
        } else {
            // Fallback to simple rendering
            return this.renderMarkdown(content);
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    updateStreamingArtifacts(artifactUpdates) {
        for (const update of artifactUpdates) {
            // Find existing artifact by ID or create new one
            let existingIndex = this.artifacts.findIndex(a => a.id === update.id);
            
            if (existingIndex >= 0) {
                // Update existing artifact
                this.artifacts[existingIndex] = { ...this.artifacts[existingIndex], ...update };
            } else {
                // Add new artifact
                this.artifacts.push(update);
            }
        }
        
        // Re-render artifacts to show updates
        this.renderArtifacts();
    }
    
    removeArtifacts(artifactsToRemove) {
        for (const removal of artifactsToRemove) {
            // Remove artifact by ID
            this.artifacts = this.artifacts.filter(a => a.id !== removal.id);
        }
        
        // Re-render artifacts after removal
        this.renderArtifacts();
    }
    
    addArtifact(artifact) {
        // Legacy method - add ID if not present
        if (!artifact.id) {
            artifact.id = 'legacy_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        }
        this.artifacts.push(artifact);
        this.renderArtifacts();
    }
    
    renderArtifacts() {
        if (this.artifacts.length === 0) {
            this.artifactContent.innerHTML = `
                <div class="artifact-placeholder">
                    <div class="placeholder-icon">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21,15 16,10 5,21"></polyline>
                        </svg>
                    </div>
                    <h3>No artifacts yet</h3>
                    <p>When Claude creates HTML pages, code, or other artifacts, they'll appear here for you to view and interact with.</p>
                </div>
            `;
            return;
        }
        
        this.artifactContent.innerHTML = '';
        
        // Sort artifacts - newest first (by array order, as newer artifacts are added later)
        const sortedArtifacts = [...this.artifacts].reverse();
        
        sortedArtifacts.forEach((artifact, index) => {
            const artifactDiv = document.createElement('div');
            const isNewest = index === 0; // First item is newest after reverse
            const isCollapsed = !isNewest && artifact.complete !== false; // Collapse completed older artifacts
            
            artifactDiv.className = `artifact-item ${isCollapsed ? 'collapsed' : 'expanded'}`;
            
            const typeLabel = this.getArtifactTypeLabel(artifact.type);
            
            const buildingIndicator = artifact.complete === false ? 
                '<span class="artifact-building">Building...</span>' : '';
            
            const collapseButton = !isNewest ? `
                <button class="artifact-collapse-btn" onclick="window.claudeChat.toggleArtifact('${artifact.id}')">
                    <svg class="collapse-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6,9 12,15 18,9"></polyline>
                    </svg>
                </button>
            ` : '';
            
            artifactDiv.innerHTML = `
                <div class="artifact-item-header" ${!isNewest ? 'onclick="window.claudeChat.toggleArtifact(\'' + artifact.id + '\')"' : ''}>
                    <div class="artifact-header-left">
                        <span class="artifact-title">${artifact.title || 'Untitled'}</span>
                        <span class="artifact-type">${typeLabel}</span>
                        ${buildingIndicator}
                    </div>
                    ${collapseButton}
                </div>
                <div class="artifact-item-content">
                    ${this.renderArtifactContent(artifact)}
                </div>
            `;
            
            // Add data attribute for easy identification
            artifactDiv.setAttribute('data-artifact-id', artifact.id);
            
            this.artifactContent.appendChild(artifactDiv);
        });
    }
    
    toggleArtifact(artifactId) {
        const artifactElement = document.querySelector(`[data-artifact-id="${artifactId}"]`);
        if (artifactElement) {
            const isCollapsed = artifactElement.classList.contains('collapsed');
            if (isCollapsed) {
                artifactElement.classList.remove('collapsed');
                artifactElement.classList.add('expanded');
            } else {
                artifactElement.classList.add('collapsed');
                artifactElement.classList.remove('expanded');
            }
        }
    }
    
    getArtifactTypeLabel(type) {
        const labels = {
            'html': 'HTML',
            'code': 'Code',
            'markdown': 'Markdown',
            'text': 'Text'
        };
        return labels[type] || type.toUpperCase();
    }
    
    renderArtifactContent(artifact) {
        switch (artifact.type) {
            case 'html':
                return `<iframe class="artifact-html" srcdoc="${this.escapeHtml(artifact.content)}"></iframe>`;
                
            case 'markdown':
                return `<div class="artifact-markdown-rendered">${this.renderFullMarkdown(artifact.content)}</div>`;
                
            case 'code':
                const language = artifact.language || 'text';
                return `<pre class="artifact-code"><code class="language-${language}">${this.escapeHtml(artifact.content)}</code></pre>`;
                
            default:
                return `<pre class="artifact-text">${this.escapeHtml(artifact.content)}</pre>`;
        }
    }
    
    clearArtifacts() {
        this.artifacts = [];
        this.renderArtifacts();
    }
    
    handleError(error, typingIndicator = null) {
        console.error('Chat error:', error);
        
        if (typingIndicator) {
            typingIndicator.remove();
        }
        
        this.addMessage('assistant', `Sorry, I encountered an error: ${error.message}`);
        this.setInputEnabled(true);
        this.setStatus('error', 'Error occurred');
        
        // Reset status after a few seconds
        setTimeout(() => {
            this.setStatus('ready', 'Ready');
        }, 3000);
    }
    
    scrollToBottom() {
        const isAtBottom = this.chatMessages.scrollTop + this.chatMessages.clientHeight >= this.chatMessages.scrollHeight - 10;
        if (isAtBottom || this.chatMessages.scrollTop === 0) {
            this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        }
    }
    
    // API Key Management Methods
    openApiKeyModal() {
        this.apiKeyModal.classList.add('show');
        this.apiKeyInput.focus();
        
        // Pre-fill with existing key if available
        if (this.slideApiKey) {
            this.apiKeyInput.value = this.slideApiKey;
        }
    }
    
    closeApiKeyModal() {
        this.apiKeyModal.classList.remove('show');
        this.apiKeyInput.value = '';
        this.apiKeyInput.type = 'password';
        this.updateToggleVisibilityIcon(false);
    }
    
    togglePasswordVisibility() {
        const isPassword = this.apiKeyInput.type === 'password';
        this.apiKeyInput.type = isPassword ? 'text' : 'password';
        this.updateToggleVisibilityIcon(!isPassword);
    }
    
    updateToggleVisibilityIcon(isVisible) {
        const icon = this.toggleVisibility.querySelector('svg');
        if (isVisible) {
            // Eye with slash (hide)
            icon.innerHTML = `
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M21 21L3 3"></path>
            `;
        } else {
            // Regular eye (show)
            icon.innerHTML = `
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            `;
        }
    }
    
    saveApiKeyHandler() {
        const apiKey = this.apiKeyInput.value.trim();
        
        if (!apiKey) {
            alert('Please enter an API key');
            return;
        }
        
        if (!apiKey.startsWith('tk_')) {
            alert('Invalid API key format. Slide API keys should start with "tk_"');
            return;
        }
        
        try {
            this.slideApiKey = apiKey;
            this.saveApiKeyToCookie(apiKey);
            this.updateApiKeyStatus(true);
            this.closeApiKeyModal();
            
            // Automatically start MCP server with the new API key
            this.startMCPServer(apiKey);
            
            // Show success message
            console.log('Slide API key saved successfully');
        } catch (error) {
            console.error('Error saving API key:', error);
            alert('Error saving API key. Please try again.');
        }
    }
    
    removeApiKeyHandler() {
        if (confirm('Are you sure you want to remove the Slide API key?')) {
            // Stop MCP server first
            this.stopMCPServer();
            
            this.slideApiKey = null;
            this.removeApiKeyFromCookie();
            this.updateApiKeyStatus(false);
            this.closeApiKeyModal();
            
            console.log('Slide API key removed');
        }
    }
    
    loadApiKey() {
        try {
            const encryptedKey = this.getCookie('slide_api_key');
            if (encryptedKey) {
                this.slideApiKey = this.decryptApiKey(encryptedKey);
                this.updateApiKeyStatus(true);
                
                // Automatically start MCP server if API key is loaded
                this.startMCPServer(this.slideApiKey);
            } else {
                this.updateApiKeyStatus(false);
            }
        } catch (error) {
            console.error('Error loading API key:', error);
            this.updateApiKeyStatus(false);
        }
    }
    
    updateApiKeyStatus(hasKey) {
        if (hasKey) {
            this.apiKeyButton.classList.add('has-key');
            this.apiKeyStatus.textContent = 'API Key Set';
        } else {
            this.apiKeyButton.classList.remove('has-key');
            this.apiKeyStatus.textContent = 'No API Key';
        }
    }
    
    saveApiKeyToCookie(apiKey) {
        const encrypted = this.encryptApiKey(apiKey);
        this.setCookie('slide_api_key', encrypted, 365); // 1 year expiry
    }
    
    removeApiKeyFromCookie() {
        this.setCookie('slide_api_key', '', -1);
    }
    
    // Simple encryption/decryption using base64 and simple XOR
    // Note: This is not cryptographically secure, but provides basic obfuscation
    encryptApiKey(apiKey) {
        const key = 'slide-chat-encryption-key-2024';
        let encrypted = '';
        
        for (let i = 0; i < apiKey.length; i++) {
            const charCode = apiKey.charCodeAt(i) ^ key.charCodeAt(i % key.length);
            encrypted += String.fromCharCode(charCode);
        }
        
        return btoa(encrypted);
    }
    
    decryptApiKey(encryptedKey) {
        const key = 'slide-chat-encryption-key-2024';
        const decoded = atob(encryptedKey);
        let decrypted = '';
        
        for (let i = 0; i < decoded.length; i++) {
            const charCode = decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length);
            decrypted += String.fromCharCode(charCode);
        }
        
        return decrypted;
    }
    
    // Cookie utilities
    setCookie(name, value, days) {
        let expires = '';
        if (days) {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = '; expires=' + date.toUTCString();
        }
        document.cookie = name + '=' + (value || '') + expires + '; path=/; SameSite=Strict';
    }
    
    getCookie(name) {
        const nameEQ = name + '=';
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
        }
        return null;
    }
    
    // MCP Server Management Methods
    async startMCPServer(apiKey) {
        try {
            const response = await fetch('/mcp/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: apiKey
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                console.log('MCP server started:', result.message);
                this.setStatus('ready', `Ready (${result.status.tools_count} tools)`);
            } else {
                console.error('Failed to start MCP server:', result.error);
                this.setStatus('error', 'MCP Error');
            }
        } catch (error) {
            console.error('Error starting MCP server:', error);
            this.setStatus('error', 'MCP Error');
        }
    }
    
    async stopMCPServer() {
        try {
            const response = await fetch('/mcp/stop', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                console.log('MCP server stopped:', result.message);
                this.setStatus('ready', 'Ready');
            } else {
                console.error('Failed to stop MCP server:', result.error);
            }
        } catch (error) {
            console.error('Error stopping MCP server:', error);
        }
    }
    
    async getMCPStatus() {
        try {
            const response = await fetch('/mcp/status');
            const status = await response.json();
            
            if (status.running) {
                this.setStatus('ready', `Ready (${status.tools_count} tools)`);
            } else {
                this.setStatus('ready', 'Ready');
            }
            
            return status;
        } catch (error) {
            console.error('Error getting MCP status:', error);
            return { running: false, tools_count: 0, tools: [] };
        }
    }
    
    // Tool Use Display Methods - Hidden from user
    addToolUseBlock(toolData) {
        // Tool use blocks are now hidden from the user interface
        // Just track that we've processed this tool ID
        if (toolData && toolData.tool_id) {
            this.processedToolIds.add(toolData.tool_id);
        }
    }
    
    addToolErrorBlock(errorData) {
        // Tool error blocks are now hidden from the user interface
        // Errors will be handled silently or shown in the main chat if needed
        console.warn('Tool error occurred:', errorData);
    }
    
    // toggleToolUse method removed - tool blocks are now hidden
    
    processToolUseInText(text) {
        // Handle tool use markers embedded in text lines and return filtered text
        // Keep the "🔧 Using tool:" messages but filter out detailed responses
        let filteredText = text;
        
        try {
            // Look for TOOL_USE_START...TOOL_USE_END pattern
            const toolUseMatch = text.match(/TOOL_USE_START(.*?)TOOL_USE_END/);
            if (toolUseMatch) {
                const toolDataString = toolUseMatch[1];
                try {
                    const toolData = JSON.parse(toolDataString);
                    this.addToolUseBlock(toolData);
                    
                    // Remove only the tool use markers and data, keep any tool intro messages
                    filteredText = text.replace(/TOOL_USE_START.*?TOOL_USE_END/, '').trim();
                } catch (e) {
                    console.error('Error parsing embedded tool use data:', e);
                    // Remove the tool section even if parsing failed
                    filteredText = text.replace(/TOOL_USE_START.*?TOOL_USE_END/, '').trim();
                }
            }
            
            // Look for TOOL_ERROR_START...TOOL_ERROR_END pattern
            const toolErrorMatch = filteredText.match(/TOOL_ERROR_START(.*?)TOOL_ERROR_END/);
            if (toolErrorMatch) {
                const errorDataString = toolErrorMatch[1];
                try {
                    const errorData = JSON.parse(errorDataString);
                    this.addToolErrorBlock(errorData);
                    
                    // Remove the tool error markers and data from the text
                    filteredText = filteredText.replace(/TOOL_ERROR_START.*?TOOL_ERROR_END/, '').trim();
                } catch (e) {
                    console.error('Error parsing embedded tool error data:', e);
                    // Remove the tool section even if parsing failed
                    filteredText = filteredText.replace(/TOOL_ERROR_START.*?TOOL_ERROR_END/, '').trim();
                }
            }
            
            return filteredText;
            
        } catch (error) {
            console.error('Error processing tool use in text:', error);
            return filteredText;
        }
    }
    
    processStreamingChunk(fullContent) {
        // Keep "🔧 Using tool:" messages but filter out detailed tool responses
        let cleanContent = fullContent;
        
        // Check for complete tool use pattern
        const completeToolPattern = /TOOL_USE_START(.*?)TOOL_USE_END/s;
        const toolMatch = fullContent.match(completeToolPattern);
        
        if (toolMatch) {
            const toolDataString = toolMatch[1];
            try {
                const toolData = JSON.parse(toolDataString);
                
                // Only process if we haven't seen this tool use before
                if (!this.processedToolIds.has(toolData.tool_id)) {
                    this.processedToolIds.add(toolData.tool_id);
                    
                    // Track the tool use but don't create visible blocks
                    this.addToolUseBlock(toolData);
                }
                
                // Remove only the detailed TOOL_USE_START...TOOL_USE_END section
                // Keep the "🔧 Using tool:" message
                cleanContent = fullContent.replace(/TOOL_USE_START.*?TOOL_USE_END/s, '');
                
            } catch (e) {
                console.error('Error parsing tool use data:', e);
                // Remove the tool section even if parsing failed
                cleanContent = fullContent.replace(/TOOL_USE_START.*?TOOL_USE_END/s, '');
            }
        }
        
        return { cleanContent };
    }
    
    // createToolBlockAfterMessage method removed - tool blocks are now hidden
}

// Additional CSS for status indicators
const additionalStyles = `
    .status-dot.status-ready {
        background-color: #10b981;
    }
    
    .status-dot.status-thinking {
        background-color: #f59e0b;
        animation: pulse 1s infinite;
    }
    
    .status-dot.status-error {
        background-color: #dc2626;
        animation: none;
    }
    
    .artifact-building {
        background: #fef3c7;
        color: #92400e;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 500;
        text-transform: uppercase;
        animation: pulse 1.5s infinite;
        margin-left: 8px;
    }
    
    .artifact-markdown {
        padding: 20px;
        line-height: 1.6;
    }
    
    /* Rendered Markdown Styles with Neuton Font */
    .artifact-markdown-rendered {
        font-family: 'Neuton', serif;
        padding: 24px 28px;
        line-height: 1.7;
        color: #2d3748;
        max-width: none;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    }
    
    .artifact-markdown-rendered h1,
    .artifact-markdown-rendered h2,
    .artifact-markdown-rendered h3,
    .artifact-markdown-rendered h4,
    .artifact-markdown-rendered h5,
    .artifact-markdown-rendered h6 {
        font-family: 'Neuton', serif;
        font-weight: 700;
        margin-top: 0.2em;
        margin-bottom: 0.3em;
        color: #1a202c;
        line-height: 1.2;
    }
    
    .artifact-markdown-rendered h1 {
        font-size: 2.1rem;
        border-bottom: 2px solid #e2e8f0;
        padding-bottom: 0.2rem;
        margin-top: 0;
        margin-bottom: 0.2em;
    }
    
    .artifact-markdown-rendered h2 {
        font-size: 1.75rem;
        border-bottom: 1px solid #e2e8f0;
        padding-bottom: 0.1rem;
        margin-bottom: 0.1em;
    }
    
    .artifact-markdown-rendered h3 {
        font-size: 1.5rem;
    }
    
    .artifact-markdown-rendered h4 {
        font-size: 1.25rem;
    }
    
    .artifact-markdown-rendered h5 {
        font-size: 1.125rem;
    }
    
    .artifact-markdown-rendered h6 {
        font-size: 1rem;
        font-weight: 600;
    }
    
    .artifact-markdown-rendered p {
        margin-bottom: 1.1em;
        font-size: 1.1rem;
        font-weight: 300;
    }
    
    .artifact-markdown-rendered blockquote {
        border-left: 4px solid #3182ce;
        padding-left: 1.2rem;
        margin: 1.2rem 0;
        font-style: italic;
        color: #4a5568;
        background: rgba(247, 250, 252, 0.7);
        padding: 0.8rem 1.2rem;
        border-radius: 0 6px 6px 0;
    }
    
    .artifact-markdown-rendered ul,
    .artifact-markdown-rendered ol {
        margin: 1.2rem 0;
        padding-left: 1.8rem;
    }
    
    .artifact-markdown-rendered li {
        margin-bottom: 0.4rem;
        font-size: 1.1rem;
        font-weight: 300;
    }
    
    .artifact-markdown-rendered li > ul,
    .artifact-markdown-rendered li > ol {
        margin: 0.4rem 0;
    }
    
    .artifact-markdown-rendered code {
        background: #edf2f7;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.9em;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        color: #e53e3e;
        font-weight: 500;
    }
    
    .artifact-markdown-rendered pre {
        background: #1a202c;
        color: #f7fafc;
        padding: 1rem 1.2rem;
        border-radius: 6px;
        overflow-x: auto;
        margin: 1.2rem 0;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 0.9rem;
        line-height: 1.5;
    }
    
    .artifact-markdown-rendered pre code {
        background: none;
        padding: 0;
        color: inherit;
        font-size: inherit;
    }
    
    .artifact-markdown-rendered table {
        width: 100%;
        border-collapse: collapse;
        margin: 1.2rem 0;
        font-size: 0.95rem;
    }
    
    .artifact-markdown-rendered th,
    .artifact-markdown-rendered td {
        border: 1px solid #e2e8f0;
        padding: 0.75rem;
        text-align: left;
    }
    
    .artifact-markdown-rendered th {
        background: #f7fafc;
        font-weight: 600;
        color: #2d3748;
    }
    
    .artifact-markdown-rendered tr:nth-child(even) {
        background: #f7fafc;
    }
    
    .artifact-markdown-rendered a {
        color: #3182ce;
        text-decoration: none;
        font-weight: 400;
        border-bottom: 1px solid transparent;
        transition: border-color 0.2s ease;
    }
    
    .artifact-markdown-rendered a:hover {
        border-bottom-color: #3182ce;
    }
    
    .artifact-markdown-rendered img {
        max-width: 100%;
        height: auto;
        border-radius: 6px;
        margin: 1rem 0;
    }
    
    .artifact-markdown-rendered hr {
        border: none;
        height: 1px;
        background: linear-gradient(90deg, #e2e8f0, #cbd5e0, #e2e8f0);
        margin: 1.5rem 0;
        border-radius: 1px;
    }
    
    .artifact-markdown-rendered strong {
        font-weight: 700;
        color: #1a202c;
    }
    
    .artifact-markdown-rendered em {
        font-style: italic;
        color: #4a5568;
    }
    
    .artifact-markdown-rendered del {
        text-decoration: line-through;
        color: #718096;
    }
    
    /* GitHub-style task lists */
    .artifact-markdown-rendered input[type="checkbox"] {
        margin-right: 0.5rem;
    }
    
    .artifact-markdown-rendered .task-list-item {
        list-style: none;
        margin-left: -2rem;
        padding-left: 2rem;
    }
    
    .artifact-text {
        padding: 20px;
        background: #f8f9fa;
        border-radius: 4px;
        white-space: pre-wrap;
        font-family: monospace;
    }
    
    /* Artifact collapse/expand functionality */
    .artifact-item-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid #e5e5e5;
        background: #f9fafb;
    }
    
    .artifact-header-left {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
    }
    
    .artifact-collapse-btn {
        background: none;
        border: none;
        color: #6b7280;
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .artifact-collapse-btn:hover {
        background: #e5e7eb;
        color: #374151;
    }
    
    .artifact-item.collapsed .artifact-item-content {
        display: none;
    }
    
    .artifact-item.collapsed .artifact-item-header {
        cursor: pointer;
        border-bottom: none;
    }
    
    .artifact-item.collapsed .artifact-item-header:hover {
        background: #f3f4f6;
    }
    
    .artifact-item.collapsed .collapse-icon {
        transform: rotate(-90deg);
    }
    
    .artifact-item.expanded .collapse-icon {
        transform: rotate(0deg);
    }
    
    .collapse-icon {
        transition: transform 0.2s ease;
    }
    
    /* Spacing between artifacts */
    .artifact-item + .artifact-item {
        margin-top: 8px;
    }
    
    /* Newest artifact emphasis */
    .artifact-item.expanded:first-child {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        border: 1px solid #e5e7eb;
    }
`;

// Add additional styles to the page
const styleSheet = document.createElement('style');
styleSheet.textContent = additionalStyles;
document.head.appendChild(styleSheet);

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.claudeChat = new ClaudeChatClient();
}); 