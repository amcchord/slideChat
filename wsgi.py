#!/usr/bin/env python3
import sys
import os

# Add the project directory to the Python path
sys.path.insert(0, "/var/www/chat.slide.recipes/")

# Set environment variables
os.environ['CLAUDE_API_KEY'] = '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'

from app import app

# WSGI expects an 'application' variable
application = app

if __name__ == "__main__":
    app.run() 