# Slide Chat 💬

A powerful, enterprise-grade chat application that integrates with Slide backup and disaster recovery systems, powered by Claude AI and built with Flask. Features real-time streaming responses, comprehensive artifact management, advanced session handling, and full MCP integration.

![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)
![Python](https://img.shields.io/badge/python-3.8%2B-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## ✨ Key Features

### 🤖 AI-Powered Conversations
- **Claude AI Integration**: Powered by Claude Sonnet 4 with streaming responses
- **Context-Aware**: Maintains conversation history across sessions
- **Tool Integration**: Seamlessly integrates with Slide MCP tools for real-time data

### 🔧 Slide Backup & Recovery Integration
- **Real-time Device Monitoring**: Check status of Slide backup devices
- **Backup Management**: View schedules, status, and health metrics
- **Server Virtualization**: Manage virtualization and recovery operations
- **Comprehensive Reporting**: Generate detailed backup and recovery reports
- **Hierarchical Data**: Navigate Clients → Devices → Agents → Backups → Snapshots

### 📊 Advanced Artifact System
- **Multi-format Support**: HTML, Markdown, Code, JSON, XML artifacts
- **Real-time Rendering**: Live preview as artifacts are generated
- **Persistent Storage**: Automatic saving with unique permalinks
- **File Management**: Organized artifact directory with metadata
- **Language Support**: Syntax highlighting for 15+ programming languages

### 🔒 Security & Session Management
- **Stateless MCP Architecture**: Secure, isolated per-request tool execution
- **API Key Management**: Separate Claude and Slide API key handling
- **Session Persistence**: Maintain chat history across browser sessions
- **Environment Security**: All sensitive data via environment variables

### 📋 Advanced Logging & Debugging
- **Multi-level Logging**: API interactions, session events, error tracking
- **Debug Endpoints**: Real-time log access and session debugging
- **File-based Persistence**: Organized daily log files with rotation
- **Comprehensive Monitoring**: Health checks and system status

## 🚀 Quick Start

### Prerequisites

- Python 3.8 or higher
- Anthropic Claude API key
- Slide API key (for backup system integration)
- Git

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/amcchord/slideChat.git
   cd slideChat
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Set up environment variables:**
   ```bash
   cp config.example config.env
   ```
   
   Edit `config.env` and add your actual API keys:
   ```
   CLAUDE_API_KEY=sk-ant-your_anthropic_api_key_here
   SECRET_KEY=your_random_secret_key_here
   FLASK_ENV=production
   ```

4. **Load environment variables:**
   ```bash
   # Option 1: Source the config file
   source config.env
   
   # Option 2: Create a .env file (automatically loaded)
   cp config.env .env
   ```

5. **Run the application:**
   ```bash
   python app.py
   ```

6. **Access the application:**
   Navigate to `http://localhost:5000`

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `CLAUDE_API_KEY` | Your Anthropic Claude API key | ✅ Yes | None |
| `SECRET_KEY` | Flask secret key for sessions | ✅ Yes | `dev-secret-key-change-in-production` |
| `FLASK_ENV` | Flask environment mode | ❌ No | `development` |

### Getting API Keys

#### Anthropic Claude API Key
1. Sign up at [Anthropic Console](https://console.anthropic.com/)
2. Navigate to API Keys section
3. Create a new API key
4. Copy the key to your configuration

#### Slide API Key
1. Access your Slide management console
2. Navigate to API settings
3. Generate or copy your API key (format: `tk_...`)
4. Use this key in the chat interface for backup operations

## 🛠️ Slide Backup Integration

### MCP Server Architecture

The application uses a **stateless MCP server** approach for enhanced security:
- Each request spawns a fresh MCP server process
- API keys are passed per-request for isolation
- No persistent server state or sessions
- Better security and resource management

### Available Slide Tools

Through MCP integration, you can:
- **Device Management**: List, monitor, and control backup devices
- **Backup Operations**: View backup schedules, status, and history
- **Agent Monitoring**: Track backup agents and their health
- **Snapshot Management**: Access and manage backup snapshots
- **Virtualization Control**: Manage server virtualization and recovery
- **Reporting**: Generate comprehensive backup and recovery reports
- **Log Analysis**: Review system logs and diagnostics

### Using Slide Features

In the chat interface:
1. Click the "API Key" button to configure your Slide API key
2. Once configured, ask about your backup infrastructure:
   - "Show me my backup devices"
   - "What's the status of my recent backups?"
   - "Generate a backup report for this week"
   - "List all my backup agents"

## 📁 Project Structure

```
slideChat/
├── app.py                    # Main Flask application (1,177 lines)
├── mcp_manager.py           # MCP server management (233 lines)
├── wsgi.py                  # WSGI entry point
├── templates/
│   └── index.html           # Modern chat interface (150 lines)
├── static/
│   ├── css/
│   │   ├── style.css        # Application styles
│   │   └── charter.css      # Typography
│   ├── js/
│   │   └── app.js           # Frontend JavaScript client
│   ├── fonts/               # Web fonts
│   └── images/              # UI assets
├── artifacts/               # Generated artifact storage
├── logs/                    # Application logs
├── mcp/                     # MCP server binary
├── config.example           # Environment template
├── requirements.txt         # Dependencies
├── DEPLOYMENT.md           # Production deployment guide
├── LOGGING_README.md       # Logging system documentation
└── TODO.md                 # Development roadmap
```

## 📝 Complete API Reference

### Chat & Core Endpoints

| Endpoint | Method | Description | Parameters |
|----------|---------|-------------|------------|
| `/` | GET | Main chat interface | None |
| `/chat` | POST | Send chat messages (SSE streaming) | `message`, `session_id`, `slide_api_key` |
| `/health` | GET | Application health check | None |
| `/version` | GET | Application version info | None |

### Artifact Management

| Endpoint | Method | Description | Parameters |
|----------|---------|-------------|------------|
| `/artifacts/<filename>` | GET | Serve saved artifacts | `filename` |

### MCP & Slide Integration

| Endpoint | Method | Description | Parameters |
|----------|---------|-------------|------------|
| `/mcp/validate` | POST | Validate Slide API key | `api_key` |
| `/mcp/test` | POST | Test specific MCP tool | `api_key`, `tool_name`, `arguments` |
| `/mcp/status` | GET | MCP server availability | None |

### Logging & Debugging

| Endpoint | Method | Description | Parameters |
|----------|---------|-------------|------------|
| `/logs/status` | GET | Logging system status | None |
| `/logs/recent/<log_type>` | GET | Recent log entries | `log_type` (sessions/api), `lines` |
| `/logs/debug/<session_id>` | GET | Session-specific debug logs | `session_id` |

### API Response Formats

#### Chat Streaming (Server-Sent Events)

```javascript
// Text content
data: {"type": "content", "content": "Chat message text"}

// Artifact updates
data: {"type": "artifacts_update", "content": [{"id": "...", "type": "markdown", ...}]}

// Tool usage
data: {"type": "tool_use", "content": {"tool_name": "...", "result": {...}}}

// Completion
data: {"type": "complete"}

// Errors
data: {"type": "error", "content": "Error message"}
```

## 🎨 User Interface Features

### Modern Chat Interface
- **Clean Design**: Professional dark theme with excellent readability
- **Responsive Layout**: Works on desktop, tablet, and mobile devices
- **Real-time Indicators**: Status indicators for connection and processing
- **Typing Animation**: Live streaming response rendering

### Artifact Viewer
- **Syntax Highlighting**: Code highlighting for 15+ languages
- **Live Preview**: Real-time artifact rendering as they're generated
- **Download Links**: Persistent links to generated artifacts
- **Multi-format Support**: HTML, Markdown, Code, JSON, XML, and more

### API Key Management
- **Visual Indicators**: Clear status for both Claude and Slide API keys
- **Secure Storage**: Session-based storage (not persisted to disk)
- **Easy Configuration**: One-click API key setup modal

## 🔒 Security & Production

### Security Features
- **Environment Variables**: All sensitive data via environment variables
- **No API Key Persistence**: Keys stored only in browser session
- **Stateless Architecture**: No server-side session persistence
- **Input Validation**: Comprehensive input sanitization
- **Error Handling**: Graceful error handling without information leakage

### Production Deployment
See [DEPLOYMENT.md](DEPLOYMENT.md) for comprehensive production setup including:
- **Docker Configuration**: Multi-stage Docker builds
- **Reverse Proxy Setup**: Nginx configuration examples
- **SSL/HTTPS Setup**: Security best practices
- **Environment Management**: Production environment configuration
- **Monitoring**: Health checks and log monitoring

## 🔧 Development & Debugging

### Logging System
The application includes a comprehensive logging system:

- **API Interactions**: Detailed API request/response logging
- **Session Events**: User session tracking and debugging
- **Error Tracking**: Comprehensive error logging with stack traces
- **Debug Files**: Per-session debug file generation

For detailed logging information, see [LOGGING_README.md](LOGGING_README.md).

### Local Development

```bash
# Run in development mode
FLASK_ENV=development python app.py

# Access debug logs
curl http://localhost:5000/logs/status
curl http://localhost:5000/logs/recent/sessions
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow PEP 8 style guidelines
- Add comprehensive docstrings
- Include error handling
- Update tests for new features
- Update documentation

## 🐛 Troubleshooting

### Common Issues

**API Key Errors**
- Ensure your Claude API key starts with `sk-ant-`
- Ensure your Slide API key starts with `tk_`
- Check environment variable loading

**MCP Tool Issues**
- Verify the `mcp/slide-mcp-server` binary exists and is executable
- Check Slide API key validity with `/mcp/validate`
- Review MCP server logs in the logs directory

**Artifact Not Saving**
- Check `artifacts/` directory permissions
- Review application logs for save errors
- Ensure adequate disk space

### Debug Endpoints

For troubleshooting, use these endpoints:
- `GET /health` - Application health
- `GET /logs/status` - Log file status
- `GET /mcp/status` - MCP server status
- `GET /logs/recent/api` - Recent API logs

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **[Anthropic Claude](https://www.anthropic.com/)** - Advanced AI capabilities with Claude Sonnet 4
- **[Flask](https://flask.palletsprojects.com/)** - Robust web framework
- **[Slide](https://slide.com/)** - Backup and disaster recovery solutions
- **[MCP Protocol](https://modelcontextprotocol.io/)** - Model Context Protocol for tool integration

---

**Built with ❤️ for enterprise backup and disaster recovery management**

*For questions, issues, or feature requests, please visit our [GitHub Issues](https://github.com/amcchord/slideChat/issues) page.* 