// Claude Chat Client JavaScript Application
class ClaudeChatClient {
    constructor() {
        this.sessionId = this.generateSessionId();
        this.currentEventSource = null;
        this.artifacts = [];
        this.slideApiKey = null;
        this.processedToolIds = new Set(); // Track processed tool use blocks
        this.pendingAfterToolContent = null; // Track content to show after tool blocks
        
        // Error handling and timeout properties
        this.responseTimeout = 120000; // 120 seconds timeout
        this.timeoutWarningDelay = 60000; // Show warning after 60 seconds
        this.timeoutId = null;
        this.warningTimeoutId = null;
        this.currentAbortController = null;
        this.lastResponseTime = null;
        this.responseStartTime = null;
        
        // Streaming state for scroll behavior
        this.isStreaming = false;
        
        // Context window monitoring
        this.contextCheckInterval = null;
        this.contextStatus = {
            usage_percentage: 0,
            status: 'normal',
            tokens_used: 0,
            tokens_limit: 200000
        };
        
        this.initializeElements();
        this.setupEventListeners();
        this.initializeTime();
        this.configureMarkdown();
        
        // Load API key from storage on startup (async)
        this.loadApiKey().catch(error => {
            console.error('Error loading API key on startup:', error);
        });
        
        // Initialize context usage indicator
        this.resetContextUsageIndicator();
        
        // Start context monitoring
        this.startContextMonitoring();
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
        
        // Context usage elements
        this.contextUsageIndicator = document.getElementById('context-usage-indicator');
        this.contextUsageText = document.getElementById('context-usage-text');
        
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
        
        // Context indicator click
        if (this.contextUsageIndicator) {
            this.contextUsageIndicator.addEventListener('click', () => {
                this.showContextModal();
            });
            this.contextUsageIndicator.style.cursor = 'pointer';
        }
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
        
        // Calculate initial context usage including welcome message
        setTimeout(() => {
            this.updateContextUsageFromEstimate();
        }, 100); // Small delay to ensure DOM is ready
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
        
        // Check if API key is set before allowing chat
        if (!this.slideApiKey || !this.apiKeyButton.classList.contains('has-key')) {
            // Show API key modal if no key is set
            this.openApiKeyModal();
            return;
        }
        
        // Clear processed tool IDs for new conversation
        this.processedToolIds.clear();
        this.pendingAfterToolContent = null;
        
        // Reset context usage indicator for new conversation
        // (it will be updated if/when context status messages are received)
        this.resetContextUsageIndicator();
        
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
        
        // Set streaming state
        this.isStreaming = true;
        
        try {
            await this.streamResponse(message, typingIndicator);
        } catch (error) {
            this.handleError(error, typingIndicator);
        } finally {
            // Clear streaming state and ensure timeout cleanup
            this.isStreaming = false;
            this.cleanupTimeouts();
            // Update context status immediately after message completion
            this.checkContextStatus();
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
        this.scrollToBottom(true); // Force scroll when adding new messages
        
        // Update context usage indicator immediately after adding message
        this.updateContextUsageFromEstimate();
        
        // Also check actual context status from server (but don't wait for it)
        this.checkContextStatus();
        
        return messageDiv;
    }
    
    addContextStatusMessage(content) {
        // Parse context usage from the message content
        this.updateContextUsageIndicator(content);
        
        // Check if we already have a context status message and update it instead
        let existingStatus = document.querySelector('.context-status-message');
        
        if (existingStatus) {
            // Update existing message
            const contentDiv = existingStatus.querySelector('.message-content');
            contentDiv.innerHTML = this.escapeHtml(content);
            
            // Add a brief highlight animation to show it's been updated
            existingStatus.style.backgroundColor = 'var(--background-highlight)';
            setTimeout(() => {
                existingStatus.style.backgroundColor = '';
            }, 1000);
        } else {
            // Create new context status message
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message context-status-message';
            
            const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            messageDiv.innerHTML = `
                <div class="message-header">
                    <span class="message-sender">📊 Context Manager</span>
                    <span class="message-time">${time}</span>
                </div>
                <div class="message-content">
                    ${this.escapeHtml(content)}
                </div>
            `;
            
            this.chatMessages.appendChild(messageDiv);
        }
        
        this.scrollToBottom();
    }
    
    updateContextUsageIndicator(statusMessage) {
        // Extract percentage from status message (e.g., "Context 75% used")
        const percentageMatch = statusMessage.match(/(\d+(?:\.\d+)?)%/);
        
        if (percentageMatch) {
            const percentage = parseFloat(percentageMatch[1]);
            this.setContextUsage(percentage);
        } else if (statusMessage.includes('Context window')) {
            // Show indicator even if we can't parse percentage
            this.contextUsageText.textContent = '⚠️';
            this.contextUsageIndicator.title = statusMessage;
        }
    }
    
    setContextUsage(percentage) {
        // Update the context usage display
        this.contextUsageText.textContent = `${Math.round(percentage)}%`;
        
        // Update indicator styling based on usage level
        this.contextUsageIndicator.className = 'context-usage-indicator';
        if (percentage >= 90) {
            this.contextUsageIndicator.classList.add('critical');
            this.contextUsageIndicator.title = `Context window ${percentage}% full - Critical level`;
        } else if (percentage >= 70) {
            this.contextUsageIndicator.classList.add('warning');
            this.contextUsageIndicator.title = `Context window ${percentage}% full - Warning level`;
        } else {
            this.contextUsageIndicator.title = `Context window ${percentage}% full`;
        }
    }
    
    estimateContextUsage() {
        // Estimate context usage based on current conversation
        const messages = document.querySelectorAll('.message');
        if (messages.length === 0) return 0;
        
        let totalChars = 0;
        messages.forEach(message => {
            const content = message.querySelector('.message-content');
            if (content) {
                totalChars += content.textContent.length;
            }
        });
        
        // Rough estimation: 200,000 tokens = ~700,000 chars
        // This is a very rough approximation
        const estimatedTokens = totalChars / 3.5;
        const maxTokens = 200000; // Claude Sonnet 4 context window
        const percentage = Math.min((estimatedTokens / maxTokens) * 100, 100);
        
        return percentage;
    }
    
    updateContextUsageFromEstimate() {
        // Update context usage indicator based on estimated usage
        const estimatedUsage = this.estimateContextUsage();
        if (estimatedUsage > 0) {
            this.setContextUsage(estimatedUsage);
        }
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
            // Create abort controller for this request
            this.currentAbortController = new AbortController();
            const { signal } = this.currentAbortController;
            
            // Set up timeout handling
            this.responseStartTime = Date.now();
            this.lastResponseTime = Date.now();
            this.setupTimeoutHandling(reject);
            
            fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    session_id: this.sessionId,
                    slide_api_key: this.slideApiKey || ''
                }),
                signal: signal
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
                            this.cleanupTimeouts();
                            this.setInputEnabled(true);
                            this.setStatus('ready', 'Ready');
                            // Ensure final scroll to bottom when done
                            this.scrollToBottom(true);
                            resolve();
                            return;
                        }
                        
                        // Reset timeout on each chunk received
                        this.lastResponseTime = Date.now();
                        this.resetTimeoutWarning();
                        
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
                                        
                                    } else if (data.type === 'context_status') {
                                        // Handle context status messages
                                        this.addContextStatusMessage(data.content);
                                        
                                    } else if (data.type === 'context_percentage') {
                                        // Handle context percentage updates for indicator
                                        this.updateContextIndicatorFromStatus({
                                            usage_percentage: data.percentage,
                                            status: this.getContextStatusFromPercentage(data.percentage)
                                        });
                                        
                                    } else if (data.type === 'artifacts_update') {
                                        this.updateStreamingArtifacts(data.content);
                                        // Reset timeout when artifact updates are received to prevent timeout during long artifact generation
                                        this.resetTimeoutWarning();
                                        
                                    } else if (data.type === 'artifacts_remove') {
                                        this.removeArtifacts(data.content);
                                    }
                                    
                                    if (data.type === 'artifact_save_error') {
                                        this.handleArtifactSaveError(data.content);
                                    }
                                    
                                    if (data.type === 'artifact_processing_error') {
                                        this.handleArtifactProcessingError(data.content);
                                    }
                                    
                                    if (data.type === 'complete') {
                                        this.cleanupTimeouts();
                                        this.setInputEnabled(true);
                                        this.setStatus('ready', 'Ready');
                                        // Ensure final scroll to bottom when complete
                                        this.scrollToBottom(true);
                                        resolve();
                                        return;
                                    } else if (data.type === 'hide_warning') {
                                        this.hideTimeoutWarning();
                                        
                                    } else if (data.type === 'error') {
                                        throw new Error(data.content);
                                    } else if (data.type === 'timeout_error') {
                                        const timeoutError = new Error(data.content);
                                        timeoutError.name = 'TimeoutError';
                                        throw timeoutError;
                                    } else if (data.type === 'rate_limit_error') {
                                        const rateLimitError = new Error(data.content);
                                        rateLimitError.name = 'RateLimitError';
                                        throw rateLimitError;
                                    } else if (data.type === 'connection_error') {
                                        const connectionError = new Error(data.content);
                                        connectionError.name = 'ConnectionError';
                                        throw connectionError;
                                    } else if (data.type === 'stream_error') {
                                        const streamError = new Error(data.content);
                                        streamError.name = 'StreamError';
                                        throw streamError;
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
                    }).catch((error) => {
                        this.cleanupTimeouts();
                        reject(error);
                    });
                };
                
                processStream();
            })
            .catch((error) => {
                this.cleanupTimeouts();
                reject(error);
            });
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
        
        // Auto-scroll HTML and HAML source code views to bottom when building
        this.scrollArtifactSourceToBottom();
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
            
            // Add permalink button if artifact is complete and has a permalink
            const permalinkButton = (artifact.complete !== false && artifact.permalink) ? `
                <button class="artifact-permalink-btn" onclick="window.open('${artifact.permalink}', '_blank')" title="Open in new tab">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
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
                    <div class="artifact-header-right">
                        ${permalinkButton}
                        ${collapseButton}
                    </div>
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
            'haml': 'HAML',
            'code': 'Code',
            'markdown': 'Markdown',
            'text': 'Text'
        };
        return labels[type] || type.toUpperCase();
    }
    
    renderArtifactContent(artifact) {
        switch (artifact.type) {
            case 'html':
                // Show source code while building, iframe when complete
                if (artifact.complete === false) {
                    return `
                        <div class="artifact-source-view">
                            <div class="source-header">
                                <span class="source-label">HTML Source (Building...)</span>
                                <div class="source-progress">
                                    <div class="progress-spinner"></div>
                                </div>
                            </div>
                            <pre class="artifact-html-source"><code class="language-html">${this.escapeHtml(artifact.content)}</code></pre>
                        </div>
                    `;
                } else {
                    // All artifacts should now have permalinks due to streaming file creation
                    if (artifact.permalink) {
                        const iframeId = `iframe_${artifact.id}`;
                        return `
                            <div class="artifact-html-container">
                                <iframe 
                                    id="${iframeId}"
                                    class="artifact-html" 
                                    src="${artifact.permalink}" 
                                    title="${this.escapeHtml(artifact.title || 'HTML Artifact')}"
                                    onload="window.claudeChat.handleIframeLoad('${iframeId}')"
                                    onerror="window.claudeChat.handleIframeError('${iframeId}', '${artifact.permalink}')"
                                    style="display: none;"
                                ></iframe>
                                <div id="${iframeId}_loading" class="artifact-html-loading">
                                    <div class="loading-spinner"></div>
                                    <div>Loading HTML artifact...</div>
                                </div>
                                <div id="${iframeId}_error" class="artifact-html-error" style="display: none;">
                                    <div class="error-icon">⚠️</div>
                                    <div>Failed to load HTML artifact</div>
                                    <button class="retry-button" onclick="window.claudeChat.retryIframe('${iframeId}', '${artifact.permalink}')">
                                        Retry
                                    </button>
                                </div>
                                <script>
                                    // Set a timeout to check if iframe loaded properly
                                    setTimeout(() => {
                                        const iframe = document.getElementById('${iframeId}');
                                        const loading = document.getElementById('${iframeId}_loading');
                                        if (iframe && loading && loading.style.display !== 'none') {
                                            // Still showing loading after 10 seconds - treat as error
                                            window.claudeChat.handleIframeError('${iframeId}', '${artifact.permalink}');
                                        }
                                    }, 10000);
                                </script>
                            </div>
                        `;
                    } else {
                        // Show error if no permalink is available
                        return `
                            <div class="artifact-error">
                                <div class="error-icon">⚠️</div>
                                <div class="error-message">
                                    <strong>HTML Artifact Error</strong><br>
                                    The HTML artifact could not be saved to a file. ${artifact.file_error || artifact.save_error || 'Unknown error occurred.'}
                                </div>
                                <details class="error-details">
                                    <summary>View HTML Source</summary>
                                    <pre class="artifact-source-error"><code class="language-html">${this.escapeHtml(artifact.content)}</code></pre>
                                </details>
                            </div>
                        `;
                    }
                }
                
            case 'haml':
                // Show HAML source code while building, iframe when complete
                if (artifact.complete === false) {
                    return `
                        <div class="artifact-source-view">
                            <div class="source-header">
                                <span class="source-label">HAML Source (Building...)</span>
                                <div class="source-progress">
                                    <div class="progress-spinner"></div>
                                </div>
                            </div>
                            <pre class="artifact-html-source"><code class="language-haml">${this.escapeHtml(artifact.content)}</code></pre>
                        </div>
                    `;
                } else {
                    // HAML artifacts are processed to HTML on the backend, so they render like HTML
                    if (artifact.permalink) {
                        const iframeId = `iframe_${artifact.id}`;
                        return `
                            <div class="artifact-html-container">
                                <iframe 
                                    id="${iframeId}"
                                    class="artifact-html" 
                                    src="${artifact.permalink}" 
                                    title="${this.escapeHtml(artifact.title || 'HAML Artifact (HTML rendered)')}"
                                    onload="window.claudeChat.handleIframeLoad('${iframeId}')"
                                    onerror="window.claudeChat.handleIframeError('${iframeId}', '${artifact.permalink}')"
                                    style="display: none;"
                                ></iframe>
                                <div id="${iframeId}_loading" class="artifact-html-loading">
                                    <div class="loading-spinner"></div>
                                    <div>Loading HAML artifact...</div>
                                </div>
                                <div id="${iframeId}_error" class="artifact-html-error" style="display: none;">
                                    <div class="error-icon">⚠️</div>
                                    <div>Failed to load HAML artifact</div>
                                    <button class="retry-button" onclick="window.claudeChat.retryIframe('${iframeId}', '${artifact.permalink}')">
                                        Retry
                                    </button>
                                </div>
                                <script>
                                    // Set a timeout to check if iframe loaded properly
                                    setTimeout(() => {
                                        const iframe = document.getElementById('${iframeId}');
                                        const loading = document.getElementById('${iframeId}_loading');
                                        if (iframe && loading && loading.style.display !== 'none') {
                                            // Still showing loading after 10 seconds - treat as error
                                            window.claudeChat.handleIframeError('${iframeId}', '${artifact.permalink}');
                                        }
                                    }, 10000);
                                </script>
                            </div>
                        `;
                    } else {
                        // HAML artifacts without permalink should show an error since HAML can't be directly rendered
                        return `
                            <div class="artifact-error">
                                <div class="error-icon">⚠️</div>
                                <div class="error-message">
                                    <strong>HAML Processing Failed</strong><br>
                                    The HAML artifact could not be converted to HTML. This may be due to a syntax error or server issue.
                                </div>
                                <details class="error-details">
                                    <summary>View HAML Source</summary>
                                    <pre class="artifact-source-error"><code class="language-haml">${this.escapeHtml(artifact.content)}</code></pre>
                                </details>
                            </div>
                        `;
                    }
                }
                
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
        // Update context usage after clearing
        this.updateContextUsageFromEstimate();
    }
    
    resetContextUsageIndicator() {
        // Reset the context usage indicator to 0%
        this.contextUsageText.textContent = '0%';
        this.contextUsageIndicator.className = 'context-usage-indicator';
        this.contextUsageIndicator.title = 'Context window usage';
    }
    
    // Timeout and error handling methods
    setupTimeoutHandling(rejectCallback) {
        // Store the reject callback for use in timeout resets
        this.currentRejectCallback = rejectCallback;
        
        // Set up warning timeout (show warning after 30 seconds)
        this.warningTimeoutId = setTimeout(() => {
            this.showTimeoutWarning();
        }, this.timeoutWarningDelay);
        
        // Set up hard timeout (cancel after 120 seconds)
        this.timeoutId = setTimeout(() => {
            this.handleTimeout(rejectCallback);
        }, this.responseTimeout);
    }
    
    resetTimeoutWarning() {
        // Clear and reset both warning and hard timeouts when we receive data
        if (this.warningTimeoutId) {
            clearTimeout(this.warningTimeoutId);
        }
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }
        
        // Reset the response start time to extend the timeout window
        this.responseStartTime = Date.now();
        
        // Restart both timeouts from the current time
        this.warningTimeoutId = setTimeout(() => {
            this.showTimeoutWarning();
        }, this.timeoutWarningDelay);
        
        // Restart the hard timeout
        this.timeoutId = setTimeout(() => {
            this.handleTimeout(this.currentRejectCallback);
        }, this.responseTimeout);
        
        this.hideTimeoutWarning();
    }
    
    cleanupTimeouts() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        if (this.warningTimeoutId) {
            clearTimeout(this.warningTimeoutId);
            this.warningTimeoutId = null;
        }
        this.hideTimeoutWarning();
        this.currentAbortController = null;
        this.currentRejectCallback = null;
    }
    
    showTimeoutWarning() {
        // Check if Claude is currently working on artifacts
        const hasIncompleteArtifacts = this.artifacts.some(artifact => artifact.complete === false);
        
        const elapsedTime = Math.floor((Date.now() - this.responseStartTime) / 1000);
        
        if (hasIncompleteArtifacts) {
            // If artifacts are being built, show a different status message and be more patient
            this.setStatus('thinking', `Claude is building.. (${elapsedTime}s)`);
            
            // Don't show timeout warning for artifact generation, just status update
            // Artifacts can take longer than normal responses
        } else {
            // Show the usual timeout warning only if no artifacts are being built
            this.setStatus('thinking', `Claude is slow... (${elapsedTime}s)`);
            
            // Add a timeout warning message to the chat
            const existingWarning = document.querySelector('.timeout-warning');
            if (!existingWarning) {
                const warningDiv = document.createElement('div');
                warningDiv.className = 'timeout-warning system-message';
                warningDiv.innerHTML = `
                    <div class="warning-content">
                        <div class="warning-icon">⚠️</div>
                        <div class="warning-text">
                            <strong>Claude is taking longer than usual to respond...</strong>
                            <p>This might be due to a complex query or temporary network issues.</p>
                            <button class="cancel-request-btn" onclick="chatClient.cancelCurrentRequest()">
                                Cancel Request
                            </button>
                        </div>
                    </div>
                `;
                this.chatMessages.appendChild(warningDiv);
                this.scrollToBottom();
            }
        }
    }
    
    hideTimeoutWarning() {
        const warningDiv = document.querySelector('.timeout-warning');
        if (warningDiv) {
            warningDiv.remove();
        }
    }
    
    handleTimeout(rejectCallback) {
        // Check if Claude is currently working on artifacts - be more patient
        const hasIncompleteArtifacts = this.artifacts.some(artifact => artifact.complete === false);
        const elapsedTime = Date.now() - this.responseStartTime;
        
        if (hasIncompleteArtifacts && elapsedTime < 300000) { // 5 minutes for artifact generation
            console.log('Extending timeout for artifact generation...');
            // Reset timeout for artifact generation with extended time
            this.timeoutId = setTimeout(() => {
                this.handleTimeout(rejectCallback);
            }, 180000); // Additional 3 minutes
            return;
        }
        
        console.error('Request timed out after', elapsedTime / 1000, 'seconds');
        
        // Cancel the request
        if (this.currentAbortController) {
            this.currentAbortController.abort();
        }
        
        this.cleanupTimeouts();
        
        // Create a timeout error
        const timeoutError = new Error('Claude stopped responding. The request has been cancelled due to timeout.');
        timeoutError.name = 'TimeoutError';
        
        rejectCallback(timeoutError);
    }
    
    cancelCurrentRequest() {
        if (this.currentAbortController) {
            console.log('User cancelled the request');
            this.currentAbortController.abort();
            this.cleanupTimeouts();
            
            // Remove typing indicator
            const typingIndicator = document.querySelector('.typing-indicator');
            if (typingIndicator) {
                typingIndicator.remove();
            }
            
            // Add cancellation message
            this.addMessage('assistant', 'Request was cancelled by user.');
            this.setInputEnabled(true);
            this.setStatus('ready', 'Ready');
        }
    }
    
    handleError(error, typingIndicator = null) {
        console.error('Chat error:', error);
        
        // Clean up any ongoing operations
        this.cleanupTimeouts();
        
        if (typingIndicator) {
            typingIndicator.remove();
        }
        
        // Provide specific error messages based on error type
        let errorMessage;
        let showRetryButton = false;
        
        if (error.name === 'TimeoutError') {
            errorMessage = `
                <div class="error-message timeout-error">
                    <div class="error-icon">⏰</div>
                    <div class="error-content">
                        <strong>Request Timed Out</strong>
                        <p>Claude stopped responding after 120 seconds. This might be due to:</p>
                        <ul>
                            <li>A very complex query requiring more processing time</li>
                            <li>Temporary network connectivity issues</li>
                            <li>High server load</li>
                        </ul>
                        <p>Please try rephrasing your question or breaking it into smaller parts.</p>
                    </div>
                </div>
            `;
            showRetryButton = true;
        } else if (error.name === 'AbortError') {
            errorMessage = 'Request was cancelled.';
        } else if (error.name === 'RateLimitError') {
            errorMessage = `
                <div class="error-message rate-limit-error">
                    <div class="error-icon">🚫</div>
                    <div class="error-content">
                        <strong>Rate Limit Exceeded</strong>
                        <p>${this.escapeHtml(error.message)}</p>
                    </div>
                </div>
            `;
            showRetryButton = true;
        } else if (error.name === 'ConnectionError') {
            errorMessage = `
                <div class="error-message network-error">
                    <div class="error-icon">📡</div>
                    <div class="error-content">
                        <strong>Connection Error</strong>
                        <p>${this.escapeHtml(error.message)}</p>
                    </div>
                </div>
            `;
            showRetryButton = true;
        } else if (error.name === 'StreamError') {
            errorMessage = `
                <div class="error-message timeout-error">
                    <div class="error-icon">⚠️</div>
                    <div class="error-content">
                        <strong>Response Interrupted</strong>
                        <p>${this.escapeHtml(error.message)}</p>
                    </div>
                </div>
            `;
            showRetryButton = true;
        } else if (error.message.includes('HTTP error')) {
            const statusMatch = error.message.match(/status: (\d+)/);
            const status = statusMatch ? statusMatch[1] : 'unknown';
            
            if (status === '429') {
                errorMessage = `
                    <div class="error-message rate-limit-error">
                        <div class="error-icon">🚫</div>
                        <div class="error-content">
                            <strong>Rate Limit Exceeded</strong>
                            <p>Too many requests have been sent. Please wait a moment before trying again.</p>
                        </div>
                    </div>
                `;
            } else if (status === '503') {
                errorMessage = `
                    <div class="error-message service-error">
                        <div class="error-icon">🔧</div>
                        <div class="error-content">
                            <strong>Service Temporarily Unavailable</strong>
                            <p>Claude's servers are currently experiencing high demand. Please try again in a few moments.</p>
                        </div>
                    </div>
                `;
            } else {
                errorMessage = `
                    <div class="error-message http-error">
                        <div class="error-icon">🌐</div>
                        <div class="error-content">
                            <strong>Connection Error (${status})</strong>
                            <p>There was a problem connecting to Claude. Please check your internet connection and try again.</p>
                        </div>
                    </div>
                `;
            }
            showRetryButton = true;
        } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            errorMessage = `
                <div class="error-message network-error">
                    <div class="error-icon">📡</div>
                    <div class="error-content">
                        <strong>Network Connection Error</strong>
                        <p>Unable to connect to the server. Please check your internet connection and try again.</p>
                    </div>
                </div>
            `;
            showRetryButton = true;
        } else {
            // Generic error
            errorMessage = `
                <div class="error-message generic-error">
                    <div class="error-icon">❌</div>
                    <div class="error-content">
                        <strong>Unexpected Error</strong>
                        <p>${this.escapeHtml(error.message)}</p>
                        <p>If this problem persists, please try refreshing the page.</p>
                    </div>
                </div>
            `;
            showRetryButton = true;
        }
        
        // Add retry button if appropriate
        if (showRetryButton) {
            errorMessage += `
                <div class="error-actions">
                    <button class="retry-btn" onclick="chatClient.retryLastMessage()">
                        🔄 Retry Last Message
                    </button>
                </div>
            `;
        }
        
        this.addMessage('assistant', errorMessage);
        this.setInputEnabled(true);
        this.setStatus('error', 'Error occurred');
        
        // Reset status after a few seconds
        setTimeout(() => {
            this.setStatus('ready', 'Ready');
        }, 5000);
    }
    
    retryLastMessage() {
        // Get the last user message from chat history
        const messages = this.chatMessages.querySelectorAll('.user-message');
        if (messages.length > 0) {
            const lastUserMessage = messages[messages.length - 1];
            const messageContent = lastUserMessage.querySelector('.message-content');
            if (messageContent) {
                const lastMessage = messageContent.textContent.trim();
                this.messageInput.value = lastMessage;
                this.sendMessage();
            }
        }
    }
    
    scrollToBottom(forceScroll = false) {
        // During streaming or when forced, always scroll to bottom
        if (this.isStreaming || forceScroll) {
            requestAnimationFrame(() => {
                this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
            });
            return;
        }
        
        // When not streaming, only scroll if user is already at bottom (respectful scrolling)
        const isAtBottom = this.chatMessages.scrollTop + this.chatMessages.clientHeight >= this.chatMessages.scrollHeight - 10;
        if (isAtBottom || this.chatMessages.scrollTop === 0) {
            requestAnimationFrame(() => {
                this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
            });
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
    
    async saveApiKeyHandler() {
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
            // Validate the API key before saving
            const isValid = await this.validateMCPApiKey(apiKey);
            
            if (isValid) {
                this.slideApiKey = apiKey;
                this.saveApiKeyToCookie(apiKey);
                this.updateApiKeyStatus(true);
                this.closeApiKeyModal();
                
                // Show success message
                console.log('Slide API key saved and validated successfully');
            } else {
                alert('Invalid API key. Please check your key and try again.');
            }
        } catch (error) {
            console.error('Error saving API key:', error);
            alert('Error validating API key. Please check your connection and try again.');
        }
    }
    
    removeApiKeyHandler() {
        if (confirm('Are you sure you want to remove the Slide API key?')) {
            this.slideApiKey = null;
            this.removeApiKeyFromCookie();
            this.updateApiKeyStatus(false);
            this.closeApiKeyModal();
            this.setStatus('ready', 'Ready');
            
            console.log('Slide API key removed');
        }
    }
    
    async loadApiKey() {
        try {
            const encryptedKey = this.getCookie('slide_api_key');
            if (encryptedKey) {
                this.slideApiKey = this.decryptApiKey(encryptedKey);
                
                // Validate the loaded API key
                const isValid = await this.validateMCPApiKey(this.slideApiKey);
                
                if (isValid) {
                    this.updateApiKeyStatus(true);
                } else {
                    // Invalid key, remove it
                    this.slideApiKey = null;
                    this.removeApiKeyFromCookie();
                    this.updateApiKeyStatus(false);
                    console.warn('Loaded API key is invalid, removed from storage');
                }
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
            
            // Enable chat input
            this.messageInput.disabled = false;
            this.sendButton.disabled = false;
            this.messageInput.placeholder = 'Type your message to Slide...';
        } else {
            this.apiKeyButton.classList.remove('has-key');
            this.apiKeyStatus.textContent = 'No API Key';
            
            // Disable chat input
            this.messageInput.disabled = true;
            this.sendButton.disabled = true;
            this.messageInput.placeholder = 'Enter your Slide API key to start chatting...';
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
    async validateMCPApiKey(apiKey) {
        try {
            const response = await fetch('/mcp/validate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: apiKey
                })
            });
            
            const result = await response.json();
            
            if (result.valid) {
                console.log('API key validated:', result.message);
                this.setStatus('ready', `Ready (${result.tools_count} tools)`);
                return true;
            } else {
                console.error('API key validation failed:', result.error);
                this.setStatus('error', 'Invalid API Key');
                return false;
            }
        } catch (error) {
            console.error('Error validating API key:', error);
            this.setStatus('error', 'MCP Error');
            return false;
        }
    }

    async testMCPTool(apiKey, toolName, toolArgs = {}) {
        try {
            const response = await fetch('/mcp/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: apiKey,
                    tool_name: toolName,
                    arguments: toolArgs
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                console.log('Tool test successful:', result);
                return result;
            } else {
                console.error('Tool test failed:', result.error);
                return null;
            }
        } catch (error) {
            console.error('Error testing tool:', error);
            return null;
        }
    }
    
    async getMCPStatus() {
        try {
            const response = await fetch('/mcp/status');
            const status = await response.json();
            
            if (status.available) {
                this.setStatus('ready', 'Ready (Stateless MCP)');
            } else {
                this.setStatus('error', 'MCP Unavailable');
            }
            
            return status;
        } catch (error) {
            console.error('Error getting MCP status:', error);
            return { available: false, stateless: true };
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
        
        // Also remove any artifact tags from the chat content
        // Artifacts are handled separately via the artifacts_update events
        cleanContent = cleanContent.replace(/<artifact[^>]*>.*?<\/artifact>/gs, '[Artifact created]');
        
        return { cleanContent };
    }
    
    // createToolBlockAfterMessage method removed - tool blocks are now hidden
    
    scrollArtifactSourceToBottom() {
        // Find all HTML and HAML artifacts that are currently being built
        const incompleteSourceArtifacts = this.artifacts.filter(artifact => 
            (artifact.type === 'html' || artifact.type === 'haml') && artifact.complete === false
        );
        
        // Scroll each source container to the bottom
        incompleteSourceArtifacts.forEach(artifact => {
            const artifactElement = document.querySelector(`[data-artifact-id="${artifact.id}"]`);
            if (artifactElement) {
                const sourceContainer = artifactElement.querySelector('.artifact-html-source');
                if (sourceContainer) {
                    requestAnimationFrame(() => {
                        sourceContainer.scrollTop = sourceContainer.scrollHeight;
                    });
                }
            }
        });
    }

    handleIframeLoad(iframeId) {
        // Hide loading indicator and show iframe
        const iframe = document.getElementById(iframeId);
        const loadingDiv = document.getElementById(`${iframeId}_loading`);
        const errorDiv = document.getElementById(`${iframeId}_error`);
        
        if (iframe && loadingDiv) {
            // Check if iframe loaded a problematic URL (about:blank, etc.)
            const iframeSrc = iframe.contentWindow?.location?.href || iframe.src || '';
            const isProblematicUrl = iframeSrc.startsWith('about:') || 
                                   iframeSrc === '' || 
                                   iframeSrc === 'about:blank';
            
            if (isProblematicUrl) {
                // Treat this as an error instead of successful load
                console.warn(`Iframe loaded problematic URL: ${iframeSrc}`);
                this.handleIframeError(iframeId, iframeSrc);
                return;
            }
            
            loadingDiv.style.display = 'none';
            iframe.style.display = 'block';
            
            // Hide error div if it was showing
            if (errorDiv) {
                errorDiv.style.display = 'none';
            }
        }
    }

    handleIframeError(iframeId, src) {
        // Hide loading indicator and iframe, show error
        const iframe = document.getElementById(iframeId);
        const loadingDiv = document.getElementById(`${iframeId}_loading`);
        const errorDiv = document.getElementById(`${iframeId}_error`);
        
        if (loadingDiv) {
            loadingDiv.style.display = 'none';
        }
        
        if (iframe) {
            iframe.style.display = 'none';
        }
        
        if (errorDiv) {
            // Customize error message based on the type of failure
            let errorMessage = 'Failed to load HTML artifact';
            let errorDetails = '';
            
            if (src.startsWith('about:')) {
                errorMessage = 'Artifact Generation Failed';
                errorDetails = 'The artifact could not be properly generated or saved. This usually indicates a server-side processing error.';
            } else if (src.includes('404') || src.includes('not-found')) {
                errorMessage = 'Artifact Not Found';
                errorDetails = 'The artifact file was not saved properly or has been removed.';
            } else if (src.includes('500') || src.includes('error')) {
                errorMessage = 'Server Error';
                errorDetails = 'There was a server error while processing the artifact.';
            } else {
                errorDetails = `URL: ${src}`;
            }
            
            // Update error content if we have better details
            if (errorDetails) {
                const errorContent = errorDiv.querySelector('div:nth-child(2)');
                if (errorContent) {
                    errorContent.innerHTML = `
                        <strong>${errorMessage}</strong><br>
                        <small style="color: #666; font-size: 0.9em;">${errorDetails}</small>
                    `;
                }
            }
            
            errorDiv.style.display = 'flex';
        }
        
        console.error(`Failed to load iframe: ${src}`);
    }

    retryIframe(iframeId, src) {
        // Show loading, hide error, and retry loading the iframe
        const iframe = document.getElementById(iframeId);
        const loadingDiv = document.getElementById(`${iframeId}_loading`);
        const errorDiv = document.getElementById(`${iframeId}_error`);
        
        if (errorDiv) {
            errorDiv.style.display = 'none';
        }
        
        if (loadingDiv) {
            loadingDiv.style.display = 'flex';
        }
        
        if (iframe) {
            iframe.style.display = 'none';
            // Force reload by changing src
            iframe.src = '';
            setTimeout(() => {
                iframe.src = src;
            }, 100);
        }
    }

    handleArtifactSaveError(errorData) {
        // Display error message to user when artifact saving fails
        const errorMessage = `
            <div class="error-message artifact-save-error">
                <div class="error-icon">💾❌</div>
                <div class="error-content">
                    <strong>Failed to Save Artifact</strong>
                    <p><strong>Artifact:</strong> ${this.escapeHtml(errorData.artifact_title)}</p>
                    <p><strong>Error:</strong> ${this.escapeHtml(errorData.error)}</p>
                    <p>The artifact content is still visible, but it couldn't be saved permanently. You can copy the content manually if needed.</p>
                </div>
            </div>
        `;
        
        this.addMessage('system', errorMessage);
        console.error('Artifact save error:', errorData);
    }

    handleArtifactProcessingError(errorData) {
        // Display error message when artifact processing fails
        const errorMessage = `
            <div class="error-message artifact-processing-error">
                <div class="error-icon">🔧❌</div>
                <div class="error-content">
                    <strong>Artifact Processing Error</strong>
                    <p><strong>Error:</strong> ${this.escapeHtml(errorData.error)}</p>
                    <p>There was an error processing artifacts. Some artifacts may not have been saved properly.</p>
                </div>
            </div>
        `;
        
        this.addMessage('system', errorMessage);
        console.error('Artifact processing error:', errorData);
    }
    
    startContextMonitoring() {
        // Check context status every 10 seconds (reduced from 30)
        this.contextCheckInterval = setInterval(() => {
            this.checkContextStatus();
        }, 10000);
        
        // Initial check
        this.checkContextStatus();
    }
    
    async checkContextStatus() {
        try {
            const url = `/context/status?session_id=${this.sessionId}`;
            const response = await fetch(url);
            
            if (response.ok) {
                const data = await response.json();
                this.contextStatus = data;
                this.updateContextIndicatorFromStatus(data);
            }
        } catch (error) {
            console.error('Error checking context status:', error);
        }
    }
    
    updateContextIndicatorFromStatus(status) {
        const percentage = status.usage_percentage || 0;
        const statusClass = status.status || 'normal';
        
        // Update the context usage display
        this.contextUsageText.textContent = `${Math.round(percentage)}%`;
        
        // Update indicator styling based on usage level
        this.contextUsageIndicator.className = 'context-usage-indicator';
        if (statusClass === 'critical') {
            this.contextUsageIndicator.classList.add('critical');
            this.contextUsageIndicator.title = `Context window ${percentage}% full - Critical level`;
        } else if (statusClass === 'warning' || statusClass === 'caution') {
            this.contextUsageIndicator.classList.add('warning');
            this.contextUsageIndicator.title = `Context window ${percentage}% full - Warning level`;
        } else {
            this.contextUsageIndicator.title = `Context window ${percentage}% full`;
        }
    }
    
    showContextModal() {
        const modal = document.getElementById('context-modal');
        if (!modal) return;
        
        // Update stats
        const statsDiv = document.getElementById('context-stats');
        const status = this.contextStatus;
        
        statsDiv.innerHTML = `
            <div class="context-modal-stats">
                <div class="stat-item">
                    <div class="stat-label">Usage</div>
                    <div class="stat-value ${status.status}">${status.usage_percentage}%</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Tokens Used</div>
                    <div class="stat-value">${status.tokens_used?.toLocaleString() || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Tokens Remaining</div>
                    <div class="stat-value">${status.tokens_remaining?.toLocaleString() || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Messages</div>
                    <div class="stat-value">${status.message_count || 0}</div>
                </div>
            </div>
            <div class="context-modal-bar">
                <div class="context-modal-fill ${status.status}" style="width: ${status.usage_percentage}%"></div>
            </div>
            <div class="context-modal-info">
                ${this.getContextStrategyInfo(status)}
            </div>
        `;
        
        modal.style.display = 'block';
    }
    
    getContextStrategyInfo(status) {
        if (status.status === 'critical') {
            return '<p class="warning">⚠️ Context window is critically full. Older messages are being summarized to maintain conversation flow.</p>';
        } else if (status.status === 'warning') {
            return '<p class="caution">📊 Context usage is high. Consider optimizing to prevent message loss.</p>';
        } else if (status.status === 'caution') {
            return '<p class="info">💡 Context usage is moderate. You have plenty of room for conversation.</p>';
        } else {
            return '<p class="success">✅ Context usage is low. You have plenty of room for conversation.</p>';
        }
    }
    
    closeContextModal() {
        const modal = document.getElementById('context-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }
    
    async clearOldMessages() {
        if (!confirm('Are you sure you want to clear old messages? This will remove the oldest messages from the conversation to free up context space.')) {
            return;
        }
        
        try {
            // For now, we'll just refresh the context status
            // In a real implementation, you'd have a separate endpoint to clear messages
            await this.optimizeContext();
        } catch (error) {
            console.error('Error clearing messages:', error);
            alert('Failed to clear messages. Please try again.');
        }
    }
    
    async optimizeContext() {
        try {
            const response = await fetch('/chat/optimize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    session_id: this.sessionId
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                this.addSystemMessage(`Context optimized: ${data.message}`);
                await this.checkContextStatus();
                this.closeContextModal();
            }
        } catch (error) {
            console.error('Error optimizing context:', error);
            alert('Failed to optimize context. Please try again.');
        }
    }
    
    addSystemMessage(content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message system-message';
        
        const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="message-sender">System</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-content">
                ${this.escapeHtml(content)}
            </div>
        `;
        
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
    }
    
    getContextStatusFromPercentage(percentage) {
        if (percentage >= 90) {
            return 'critical';
        } else if (percentage >= 80) {
            return 'warning';
        } else if (percentage >= 70) {
            return 'caution';
        } else {
            return 'normal';
        }
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
    
    /* Rendered Markdown Styles with Charter Font */
    .artifact-markdown-rendered {
        font-family: 'Charter', 'Charter BT', 'Bitstream Charter', 'Sitka Text', 'Cambria', 'Georgia', 'Times New Roman', serif;
        padding: 24px 28px;
        line-height: 1.7;
        color: #2d3748;
        max-width: none;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
        font-feature-settings: "liga" 1, "kern" 1;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
    }
    
    .artifact-markdown-rendered h1,
    .artifact-markdown-rendered h2,
    .artifact-markdown-rendered h3,
    .artifact-markdown-rendered h4,
    .artifact-markdown-rendered h5,
    .artifact-markdown-rendered h6 {
        font-family: 'Charter', 'Charter BT', 'Bitstream Charter', 'Sitka Text', 'Cambria', 'Georgia', 'Times New Roman', serif;
        font-weight: 700;
        margin-top: 0.2em;
        margin-bottom: 0.3em;
        color: #1a202c;
        line-height: 1.2;
    }
    
    .artifact-markdown-rendered h1 {
        font-size: 2.1rem;
        padding-bottom: 0.2rem;
        margin-top: 0;
        margin-bottom: 0.3em;
    }
    
    .artifact-markdown-rendered h2 {
        font-size: 1.5rem;
        padding-bottom: 0.1rem;
        margin-bottom: 0.2em;
    }
    
    .artifact-markdown-rendered h3 {
        font-size: 1.4rem;
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
        font-weight: 400;
        vertical-align: baseline;
        line-height: 1.7;
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
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
        margin-bottom: 0.5rem;
        line-height: 1.6;
        font-size: 1.05rem;
    }
    
    /* Error handling and timeout warning styles */
    .timeout-warning {
        background: linear-gradient(135deg, #fff3cd, #ffeeba);
        border: 1px solid #ffc107;
        border-radius: 8px;
        padding: 16px;
        margin: 16px 0;
        animation: slideIn 0.3s ease-out;
    }
    
    .warning-content {
        display: flex;
        align-items: flex-start;
        gap: 12px;
    }
    
    .warning-icon {
        font-size: 1.5rem;
        margin-top: 2px;
    }
    
    .warning-text {
        flex: 1;
    }
    
    .warning-text strong {
        color: #856404;
        font-size: 1.1rem;
        display: block;
        margin-bottom: 8px;
    }
    
    .warning-text p {
        color: #856404;
        margin: 0 0 12px 0;
        font-size: 0.95rem;
    }
    
    .cancel-request-btn {
        background: #dc3545;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 500;
        transition: background-color 0.2s;
    }
    
    .cancel-request-btn:hover {
        background: #c82333;
    }
    
    .error-message {
        background: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: 8px;
        padding: 16px;
        margin: 8px 0;
        display: flex;
        align-items: flex-start;
        gap: 12px;
    }
    
    .error-message.timeout-error {
        background: linear-gradient(135deg, #fff3cd, #ffeeba);
        border-color: #ffc107;
    }
    
    .error-message.rate-limit-error {
        background: linear-gradient(135deg, #f8d7da, #f5c6cb);
        border-color: #dc3545;
    }
    
    .error-message.service-error {
        background: linear-gradient(135deg, #d1ecf1, #bee5eb);
        border-color: #17a2b8;
    }
    
    .error-message.network-error {
        background: linear-gradient(135deg, #e2e3e5, #d6d8db);
        border-color: #6c757d;
    }
    
    .error-message.generic-error {
        background: linear-gradient(135deg, #f8d7da, #f5c6cb);
        border-color: #dc3545;
    }
    
    .error-icon {
        font-size: 1.5rem;
        margin-top: 2px;
    }
    
    .error-content {
        flex: 1;
    }
    
    .error-content strong {
        font-size: 1.1rem;
        display: block;
        margin-bottom: 8px;
        color: #212529;
    }
    
    .error-content p {
        margin: 0 0 8px 0;
        color: #6c757d;
        font-size: 0.95rem;
        line-height: 1.4;
    }
    
    .error-content ul {
        margin: 8px 0;
        padding-left: 20px;
        color: #6c757d;
        font-size: 0.9rem;
    }
    
    .error-content li {
        margin-bottom: 4px;
        line-height: 1.4;
    }
    
    .error-actions {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid rgba(0, 0, 0, 0.1);
    }
    
    .retry-btn {
        background: #007bff;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 500;
        transition: background-color 0.2s;
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
    
    .retry-btn:hover {
        background: #0056b3;
    }
    
    .system-message {
        margin: 12px 0;
        padding: 0;
        background: none;
        border: none;
    }
    
    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateY(-10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    /* Enhanced status indicator styles */
    .status-dot.status-thinking {
        animation: pulse 2s infinite, colorShift 3s infinite;
    }
    
    @keyframes colorShift {
        0%, 100% { background-color: #f59e0b; }
        50% { background-color: #fb923c; }
    }
    
    .artifact-markdown-rendered li {
        margin-bottom: 0.4rem;
        font-size: 1.1rem;
        font-weight: 400;
        vertical-align: baseline;
        line-height: 1.7;
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
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
        width: 160px;
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
    
    /* Emoji alignment and sizing */
    .artifact-markdown-rendered {
        font-variant-emoji: text;
    }
    
    .artifact-markdown-rendered * {
        font-variant-emoji: text;
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
    window.chatClient = new ClaudeChatClient();
    window.claudeChat = window.chatClient; // Backward compatibility
}); 