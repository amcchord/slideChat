// Claude Chat Client JavaScript Application
class ClaudeChatClient {
    constructor() {
        this.sessionId = this.generateSessionId();
        this.currentEventSource = null;
        this.artifacts = [];
        
        this.initializeElements();
        this.setupEventListeners();
        this.initializeTime();
        this.configureMarkdown();
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
                        const lines = chunk.split('\n');
                        
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                try {
                                    const data = JSON.parse(line.slice(6));
                                    
                                                                         if (data.type === 'text') {
                                         if (!assistantMessage) {
                                             assistantMessage = this.addMessage('assistant', '');
                                         }
                                         
                                         fullContent += data.content;
                                         const contentDiv = assistantMessage.querySelector('.message-content');
                                         contentDiv.innerHTML = this.renderMarkdown(fullContent);
                                         this.scrollToBottom();
                                         
                                     } else if (data.type === 'artifacts_update') {
                                         // Handle real-time artifact updates
                                         this.updateStreamingArtifacts(data.content);
                                         
                                     } else if (data.type === 'artifacts_remove') {
                                         // Handle artifact removal (empty artifacts cleanup)
                                         this.removeArtifacts(data.content);
                                         
                                     } else if (data.type === 'artifact') {
                                         // Legacy artifact handling (for compatibility)
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
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
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
        background: linear-gradient(135deg, #fefefe 0%, #f8f9fa 100%);
        border: 1px solid #e8ecef;
        border-radius: 12px;
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