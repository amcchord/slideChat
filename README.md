# Slide Chat 💬

A powerful chat application that integrates with Slide backup and disaster recovery systems, powered by Claude AI and built with Flask.

![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)
![Python](https://img.shields.io/badge/python-3.8%2B-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## ✨ Features

- **AI-Powered Conversations**: Chat with Claude AI with streaming responses
- **Slide Integration**: Monitor and manage Slide backup devices through MCP tools
- **Real-time Monitoring**: Check backup status, schedules, and system health
- **Artifact Support**: View and manage generated code, markdown reports, and documents
- **Session Management**: Persistent chat sessions with conversation history
- **Modern UI**: Clean, responsive interface with dark theme
- **Tool Integration**: Seamless integration with Slide MCP tools for device management

## 🚀 Quick Start

### Prerequisites

- Python 3.8 or higher
- Anthropic Claude API key
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
   
   Edit `config.env` and add your actual API key:
   ```
   CLAUDE_API_KEY=your_anthropic_api_key_here
   SECRET_KEY=your_random_secret_key_here
   ```

4. **Load environment variables:**
   ```bash
   # Option 1: Source the config file
   source config.env
   
   # Option 2: Create a .env file (automatically loaded by python-dotenv)
   cp config.env .env
   ```

5. **Run the application:**
   ```bash
   python app.py
   ```

6. **Open your browser:**
   Navigate to `http://localhost:5000`

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `CLAUDE_API_KEY` | Your Anthropic Claude API key | ✅ Yes | None |
| `SECRET_KEY` | Flask secret key for sessions | ✅ Yes | `dev-secret-key-change-in-production` |
| `FLASK_ENV` | Flask environment mode | ❌ No | `development` |

### Getting an Anthropic API Key

1. Sign up at [Anthropic Console](https://console.anthropic.com/)
2. Navigate to API Keys section
3. Create a new API key
4. Copy the key to your configuration

## 🛠️ Slide Integration

This application integrates with Slide backup and disaster recovery systems through MCP (Model Context Protocol) tools, allowing you to:

- **Monitor Devices**: Check status of Slide backup devices
- **Manage Backups**: View backup schedules and status
- **Control Virtualization**: Manage server virtualization and recovery
- **Access Logs**: Review system logs and health metrics
- **Generate Reports**: Create detailed backup and recovery reports

### MCP Server Management

The application includes endpoints to manage the MCP server:

- `POST /mcp/start` - Start the MCP server
- `POST /mcp/stop` - Stop the MCP server
- `GET /mcp/status` - Check MCP server status

## 📁 Project Structure

```
slideChat/
├── app.py                 # Main Flask application
├── mcp_manager.py         # MCP server management
├── templates/
│   └── index.html         # Main chat interface
├── static/
│   ├── css/
│   │   └── style.css      # Application styles
│   └── js/
│       └── app.js         # Frontend JavaScript
├── config.example         # Environment variables template
├── requirements.txt       # Python dependencies
├── DEPLOYMENT.md         # Deployment guide
├── TODO.md               # Project roadmap
└── README.md             # This file
```

## 🔒 Security

- **API Keys**: Never commit API keys to version control
- **Environment Files**: All `.env` and `config.env` files are ignored by git
- **Production**: Change the SECRET_KEY in production environments
- **HTTPS**: Use HTTPS in production for secure communication

## 🚀 Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions including:

- Production server setup
- Docker deployment
- Environment configuration
- Security best practices

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 API Endpoints

| Endpoint | Method | Description |
|----------|---------|-------------|
| `/` | GET | Main chat interface |
| `/chat` | POST | Send chat messages (streaming) |
| `/health` | GET | Health check |
| `/version` | GET | Application version |
| `/mcp/start` | POST | Start MCP server |
| `/mcp/stop` | POST | Stop MCP server |
| `/mcp/status` | GET | MCP server status |

## 🐛 Issues & Support

If you encounter any issues or need support:

1. Check the [Issues](https://github.com/amcchord/slideChat/issues) page
2. Create a new issue with detailed information
3. Include error messages and steps to reproduce

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Anthropic Claude](https://www.anthropic.com/) for the AI capabilities
- [Flask](https://flask.palletsprojects.com/) for the web framework
- [Slide](https://slide.com/) for backup and disaster recovery solutions

---

**Made with ❤️ for the Slide community** 