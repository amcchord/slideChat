# Claude Chat Client - Deployment Guide

This guide provides step-by-step instructions for updating and deploying the Claude chat application to your Apache server.

## 📋 Prerequisites

- Apache web server with mod_wsgi enabled
- Python 3.10+ installed
- SSL certificate configured for HTTPS
- Domain pointing to your server (e.g., chat.slide.recipes)

## 🚀 Deployment Steps

### 1. Navigate to Application Directory

```bash
cd /var/www/chat.slide.recipes
```

### 2. Backup Current Application (Optional but Recommended)

```bash
# Create backup of current version
sudo cp -r /var/www/chat.slide.recipes /var/www/chat.slide.recipes.backup.$(date +%Y%m%d_%H%M%S)
```

### 3. Update Application Files

Upload or update your application files:

```bash
# If using git
git pull origin main

# Or if uploading files manually, ensure you have:
# - app.py (main Flask application)
# - wsgi.py (WSGI entry point)
# - requirements.txt (Python dependencies)
# - templates/ (HTML templates)
# - static/ (CSS, JS, images)
```

### 4. Install/Update Dependencies

```bash
# Install or update Python packages
sudo pip3 install -r requirements.txt --upgrade

# Or install specific packages if needed
sudo pip3 install Flask==3.0.0 anthropic requests python-dotenv
```

### 5. Verify WSGI Configuration

Check that `wsgi.py` is properly configured:

```bash
# Verify wsgi.py content
cat wsgi.py
```

Should contain:
```python
#!/usr/bin/env python3
import sys
import os

# Add the project directory to the Python path
sys.path.insert(0, "/var/www/chat.slide.recipes/")

# Set environment variables
os.environ['CLAUDE_API_KEY'] = 'your-api-key-here'

from app import app

# WSGI expects an 'application' variable
application = app

if __name__ == "__main__":
    app.run()
```

### 6. Set Proper Permissions

```bash
# Set ownership to Apache user (usually www-data)
sudo chown -R www-data:www-data /var/www/chat.slide.recipes

# Set proper file permissions
sudo chmod -R 755 /var/www/chat.slide.recipes
sudo chmod +x wsgi.py
```

### 7. Test Configuration Syntax

```bash
# Test Apache configuration
sudo apache2ctl configtest

# Should output: "Syntax OK"
```

### 8. Restart Apache Server

```bash
# Restart Apache to load changes
sudo systemctl restart apache2

# Verify Apache is running
sudo systemctl status apache2
```

### 9. Verify Deployment

#### Check Application Health
```bash
# Test health endpoint
curl -s https://chat.slide.recipes/health

# Should return: {"status":"ok","timestamp":"..."}
```

#### Check Main Page
```bash
# Test main page loads
curl -s https://chat.slide.recipes/ | head -10

# Should return HTML content starting with <!DOCTYPE html>
```

#### Test Chat Functionality
```bash
# Test chat endpoint
curl -X POST https://chat.slide.recipes/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello","session_id":"test"}' | head -5

# Should return streaming data starting with "data: {"
```

## 🔧 Troubleshooting

### Common Issues and Solutions

#### 1. Apache Won't Start
```bash
# Check Apache error logs
sudo tail -f /var/log/apache2/error.log

# Check site-specific error logs
sudo tail -f /var/log/apache2/chat.slide.recipes-error.log
```

#### 2. 500 Internal Server Error
```bash
# Check Python import errors
cd /var/www/chat.slide.recipes
python3 -c "from app import app; print('Import successful')"

# Check WSGI file
python3 wsgi.py
```

#### 3. Module Import Errors
```bash
# Reinstall dependencies
sudo pip3 install -r requirements.txt --force-reinstall

# Check Python path
python3 -c "import sys; print('\n'.join(sys.path))"
```

#### 4. Permission Denied Errors
```bash
# Fix permissions
sudo chown -R www-data:www-data /var/www/chat.slide.recipes
sudo chmod -R 755 /var/www/chat.slide.recipes
```

#### 5. SSL Certificate Issues
```bash
# Test SSL certificate
sudo certbot certificates

# Renew if needed
sudo certbot renew
```

## 📊 Health Checks

### Verify All Components

1. **Apache Status**: `sudo systemctl status apache2`
2. **Application Health**: `curl https://chat.slide.recipes/health`
3. **SSL Certificate**: `curl -I https://chat.slide.recipes/`
4. **Static Files**: `curl https://chat.slide.recipes/static/css/style.css`
5. **Chat Functionality**: Test in browser

### Performance Monitoring

```bash
# Monitor Apache processes
sudo htop -p $(pgrep apache2 | tr '\n' ',' | sed 's/,$//')

# Monitor error logs in real-time
sudo tail -f /var/log/apache2/chat.slide.recipes-error.log

# Monitor access logs
sudo tail -f /var/log/apache2/chat.slide.recipes-access.log
```

## 🔄 Quick Update Script

Create a deployment script for faster updates:

```bash
#!/bin/bash
# save as: deploy.sh

echo "🚀 Deploying Claude Chat Client..."

# Navigate to app directory
cd /var/www/chat.slide.recipes

# Update dependencies
echo "📦 Installing dependencies..."
sudo pip3 install -r requirements.txt --upgrade

# Set permissions
echo "🔒 Setting permissions..."
sudo chown -R www-data:www-data /var/www/chat.slide.recipes
sudo chmod -R 755 /var/www/chat.slide.recipes
sudo chmod +x wsgi.py

# Test configuration
echo "🧪 Testing configuration..."
sudo apache2ctl configtest

# Restart Apache
echo "🔄 Restarting Apache..."
sudo systemctl restart apache2

# Verify deployment
echo "✅ Verifying deployment..."
sleep 2
curl -s https://chat.slide.recipes/health | grep -q "ok" && echo "✅ Health check passed" || echo "❌ Health check failed"

echo "🎉 Deployment complete!"
```

Make it executable:
```bash
chmod +x deploy.sh
sudo ./deploy.sh
```

## 📝 Environment Configuration

### Required Environment Variables

Set these in your `wsgi.py` or system environment:

```bash
# Claude API Configuration
CLAUDE_API_KEY=sk-ant-api03-...
SECRET_KEY=your-secret-key-here

# Optional: For MCP integration
SLIDE_API_KEY=tk_...
```

### Apache Virtual Host

Ensure your Apache configuration includes:

```apache
<VirtualHost *:443>
    ServerName chat.slide.recipes
    DocumentRoot /var/www/chat.slide.recipes
    
    # WSGI Configuration
    WSGIDaemonProcess chat.slide.recipes python-path=/var/www/chat.slide.recipes
    WSGIProcessGroup chat.slide.recipes
    WSGIScriptAlias / /var/www/chat.slide.recipes/wsgi.py
    WSGIApplicationGroup %{GLOBAL}
    
    # Static files
    Alias /static /var/www/chat.slide.recipes/static
    
    # SSL Configuration
    SSLCertificateFile /etc/letsencrypt/live/chat.slide.recipes/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/chat.slide.recipes/privkey.pem
</VirtualHost>
```

## 🎯 Final Verification

After deployment, verify these features work:

- [ ] **Main page loads** (https://chat.slide.recipes)
- [ ] **Chat interface functional** (can send messages)
- [ ] **Streaming responses** (messages appear in real-time)
- [ ] **Artifacts display** (code blocks, HTML, markdown render properly)
- [ ] **Collapsible artifacts** (newest on top, older collapsed)
- [ ] **Markdown rendering** (with Neuton font and proper styling)
- [ ] **Mobile responsive** (works on phone/tablet)
- [ ] **SSL certificate** (HTTPS lock icon in browser)

## 📞 Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review Apache error logs: `/var/log/apache2/chat.slide.recipes-error.log`
3. Test individual components step by step
4. Verify all dependencies are installed correctly

---

**🎉 Your Claude Chat Client should now be successfully deployed and ready to use!** 