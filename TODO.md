# Claude Chat Client TODO List

## 🎯 Project Overview
Build a Claude chat client with streaming responses and artifacts support.
- Chat interface on left (450px width)
- Artifact rendering on right side
- Support for markdown and HTML artifacts
- Streaming responses from Claude API
- Model: claude-sonnet-4-20250514
- **NEW**: MCP Integration for Slide backup devices

## 📋 Development Tasks

### Phase 1: Foundation & Setup
- [ ] 1.1 Create Flask application structure
- [ ] 1.2 Set up project dependencies (requirements.txt)
- [ ] 1.3 Create WSGI entry point
- [ ] 1.4 Set up basic routing and error handling
- [ ] 1.5 Create static file structure (CSS, JS, images)

### Phase 2: Frontend Development
- [ ] 2.1 Create main HTML template with split layout
- [ ] 2.2 Design chat interface (450px left panel)
- [ ] 2.3 Design artifact display area (right panel)
- [ ] 2.4 Implement responsive CSS styling
- [ ] 2.5 Add JavaScript for chat functionality
- [ ] 2.6 Implement streaming response handling
- [ ] 2.7 Add markdown rendering support
- [ ] 2.8 Add HTML artifact rendering support

### Phase 3: Backend API Development
- [ ] 3.1 Create chat API endpoint
- [ ] 3.2 Integrate Claude API client
- [ ] 3.3 Implement streaming response handling
- [ ] 3.4 Add artifact detection and parsing
- [ ] 3.5 Implement session management
- [ ] 3.6 Add proper error handling and logging

### Phase 4: Claude Integration
- [ ] 4.1 Set up Claude API authentication
- [ ] 4.2 Implement message formatting for Claude
- [ ] 4.3 Handle streaming responses from Claude
- [ ] 4.4 Parse and extract artifacts from responses
- [ ] 4.5 Support multiple artifact types (markdown, HTML, code)

### Phase 5: Advanced Features
- [ ] 5.1 Add message history persistence
- [ ] 5.2 Implement artifact download functionality
- [ ] 5.3 Add syntax highlighting for code artifacts
- [ ] 5.4 Implement chat export functionality
- [ ] 5.5 Add responsive design for mobile devices

### Phase 6: Testing & Deployment
- [ ] 6.1 Test streaming functionality
- [ ] 6.2 Test artifact rendering
- [ ] 6.3 Test error handling
- [ ] 6.4 Security review and hardening
- [ ] 6.5 Performance optimization
- [ ] 6.6 Final deployment and testing

### Phase 7: MCP Integration (Slide Backup Devices)
- [x] 7.1 Add Slide API key input button next to "Slide Chat" title
- [x] 7.2 Implement secure cookie storage for API key (with encryption)
- [x] 7.3 Create MCP server communication module 
- [x] 7.4 Integrate slide-mcp-server binary with SLIDE_API_KEY environment variable
- [x] 7.5 Modify Claude API calls to include MCP tools
- [x] 7.6 Add tool use display blocks in chat interface
- [x] 7.7 Implement expandable tool call/result viewer
- [x] 7.8 Update system prompt to inform Claude about Slide devices
- [x] 7.9 Add MCP server lifecycle management (start/stop/restart)
- [x] 7.10 Handle MCP server errors and connection issues

### MCP Integration Features Implemented
- **Secure API Key Management**: Encrypted cookie storage with XOR encryption
- **Automatic MCP Server Startup**: Server starts automatically when API key is provided
- **Real-time Tool Integration**: MCP tools are automatically included in Claude API calls
- **Interactive Tool Display**: Expandable blocks show tool calls and results in chat
- **System Prompt Enhancement**: Claude is informed about Slide backup devices and capabilities
- **Error Handling**: Comprehensive error handling for MCP server issues
- **Lifecycle Management**: Clean startup/shutdown of MCP server processes

## 🔧 Technical Stack
- **Backend**: Python Flask
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **AI Integration**: Claude API (Anthropic) + MCP (Model Context Protocol)
- **MCP Server**: slide-mcp-server binary for Slide device management
- **Web Server**: Apache with WSGI
- **Streaming**: Server-Sent Events (SSE) or WebSockets
- **Rendering**: Marked.js for markdown, native HTML for artifacts

## 📝 Notes
- Domain: https://chat.slide.recipes
- Document Root: /var/www/chat.slide.recipes
- API Key: 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
- Model: claude-sonnet-4-20250514

## ✅ Completed Tasks
- [x] Created project todo list
- [x] Analyzed Apache configuration
- [x] Determined project structure and requirements

### Phase 1: Foundation & Setup - COMPLETED
- [x] 1.1 Create Flask application structure
- [x] 1.2 Set up project dependencies (requirements.txt)
- [x] 1.3 Create WSGI entry point
- [x] 1.4 Set up basic routing and error handling
- [x] 1.5 Create static file structure (CSS, JS, images)

### Phase 2: Frontend Development - COMPLETED
- [x] 2.1 Create main HTML template with split layout
- [x] 2.2 Design chat interface (450px left panel)
- [x] 2.3 Design artifact display area (right panel)
- [x] 2.4 Implement responsive CSS styling
- [x] 2.5 Add JavaScript for chat functionality
- [x] 2.6 Implement streaming response handling
- [x] 2.7 Add markdown rendering support
- [x] 2.8 Add HTML artifact rendering support

### Phase 3: Backend API Development - COMPLETED
- [x] 3.1 Create chat API endpoint
- [x] 3.2 Integrate Claude API client
- [x] 3.3 Implement streaming response handling
- [x] 3.4 Add artifact detection and parsing
- [x] 3.5 Implement session management
- [x] 3.6 Add proper error handling and logging

### Phase 4: Claude Integration - COMPLETED
- [x] 4.1 Set up Claude API authentication
- [x] 4.2 Implement message formatting for Claude
- [x] 4.3 Handle streaming responses from Claude
- [x] 4.4 Parse and extract artifacts from responses
- [x] 4.5 Support multiple artifact types (markdown, HTML, code)

### Deployment Issues Fixed
- [x] Fixed Anthropic client initialization issues
- [x] Fixed WSGI application variable name
- [x] Fixed Jinja2 template errors  
- [x] Fixed 'proxies' argument error by implementing direct API calls
- [x] Successfully deployed to https://chat.slide.recipes

### Enhanced Features Implemented
- [x] Real-time artifact streaming - artifacts now build up as Claude types them
- [x] Multiple artifact type detection (HTML, code blocks, etc.)
- [x] Building indicators for incomplete artifacts
- [x] Progressive rendering as content streams in
- [x] Clean chat separation - artifact content excluded from chat messages
- [x] Smart filtering - only explanatory text appears in chat, code/HTML in artifacts panel
- [x] Fixed "Building..." indicator persistence - artifacts properly marked complete
- [x] Improved artifact detection - only captures actual code with specific languages
- [x] Empty artifact cleanup - removes artifacts with insufficient content
- [x] Collapsible artifacts - newest at top expanded, older ones collapsed but expandable
- [x] Enhanced artifact organization - better visual hierarchy and space management
- [x] Beautiful markdown rendering - full extended syntax support with Neuton font
- [x] Professional typography - GitHub-flavored markdown with syntax highlighting
- [x] Rich markdown features - tables, blockquotes, task lists, and smart typography
- [x] Optimized markdown spacing - tightened padding and margins for better readability
- [x] Attractive off-white background - subtle gradient and shadow for visual distinction 