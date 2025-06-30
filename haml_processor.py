#!/usr/bin/env python3
"""
Simple HAML to HTML processor
Supports basic HAML syntax for converting HAML artifacts to HTML
"""

import re
from typing import List, Tuple


class SimpleHamlProcessor:
    """A simple HAML to HTML processor"""
    
    def __init__(self):
        self.output = []
        self.indent_stack = []
    
    def process(self, haml_content: str) -> str:
        """Convert HAML content to HTML"""
        self.output = []
        self.indent_stack = []
        
        lines = haml_content.split('\n')
        
        for line in lines:
            processed_line = self._process_line(line)
            if processed_line:
                self.output.append(processed_line)
        
        # Close any remaining open tags
        self._close_remaining_tags()
        
        return '\n'.join(self.output)
    
    def _process_line(self, line: str) -> str:
        """Process a single HAML line"""
        original_line = line
        stripped = line.lstrip()
        
        # Calculate indentation level
        indent_level = len(line) - len(stripped)
        
        # Handle empty lines
        if not stripped:
            return ""
        
        # Handle DOCTYPE
        if stripped.startswith('!!!'):
            return "<!DOCTYPE html>"
        
        # Handle comments
        if stripped.startswith('/'):
            comment_text = stripped[1:].strip()
            return f"{'  ' * (indent_level // 2)}<!-- {comment_text} -->"
        
        # Handle plain text (no tag indicator)
        if not stripped.startswith('%') and not stripped.startswith('.') and not stripped.startswith('#'):
            return f"{'  ' * (indent_level // 2)}{stripped}"
        
        # Close tags if we've outdented
        self._handle_indentation(indent_level)
        
        # Parse HAML tag line
        tag_info = self._parse_haml_tag(stripped)
        
        if tag_info:
            tag_name, attributes, content, self_closing = tag_info
            
            # Track indentation for closing tags (only if no inline content and not self-closing)
            if not self_closing and not content:
                self.indent_stack.append((indent_level, tag_name))
            
            # Build the HTML tag
            return self._build_html_tag(tag_name, attributes, content, self_closing, indent_level)
        
        return ""
    
    def _handle_indentation(self, current_indent: int):
        """Close tags based on indentation changes"""
        while self.indent_stack and self.indent_stack[-1][0] >= current_indent:
            tag_indent, tag_name = self.indent_stack.pop()
            close_tag = f"{'  ' * (tag_indent // 2)}</{tag_name}>"
            self.output.append(close_tag)
    
    def _close_remaining_tags(self):
        """Close any remaining open tags"""
        while self.indent_stack:
            tag_indent, tag_name = self.indent_stack.pop()
            close_tag = f"{'  ' * (tag_indent // 2)}</{tag_name}>"
            self.output.append(close_tag)
    
    def _parse_haml_tag(self, line: str) -> Tuple[str, dict, str, bool]:
        """Parse a HAML tag line and extract components"""
        # Remove leading % for tag names
        if line.startswith('%'):
            line = line[1:]
        
        # Initialize
        tag_name = 'div'  # Default for class/id shortcuts
        attributes = {}
        content = ""
        self_closing = False
        
        # Handle class/id shortcuts (e.g., .class, #id, .class#id)
        if line.startswith('.') or line.startswith('#'):
            tag_name = 'div'
            # Parse classes and ids
            class_id_part = ""
            space_index = line.find(' ')
            if space_index != -1:
                class_id_part = line[:space_index]
                content = line[space_index + 1:].strip()
            else:
                class_id_part = line
            
            # Extract classes and ids
            classes = re.findall(r'\.([^#\.\s]+)', class_id_part)
            ids = re.findall(r'#([^#\.\s]+)', class_id_part)
            
            if classes:
                attributes['class'] = ' '.join(classes)
            if ids:
                attributes['id'] = ids[-1]  # Use last id if multiple
        
        else:
            # Parse regular tag (e.g., %div, %p, %html{lang: "en"})
            # First extract any attributes in curly braces
            attrs_match = re.search(r'\{([^}]+)\}', line)
            if attrs_match:
                attrs_str = attrs_match.group(1)
                # Remove the attributes from the line
                line = re.sub(r'\{[^}]+\}', '', line)
                # Parse the attributes
                attributes.update(self._parse_haml_attributes(attrs_str))
            
            # Now parse the remaining tag part
            parts = line.split(' ', 1)
            tag_part = parts[0]
            content = parts[1] if len(parts) > 1 else ""
            
            # Extract tag name, classes, and ids
            # Handle patterns like: div.class#id, div.class1.class2, etc.
            match = re.match(r'^([a-zA-Z][a-zA-Z0-9]*)((?:\.[^#\s]+|#[^.\s]+)*)', tag_part)
            if match:
                tag_name = match.group(1)
                class_id_part = match.group(2)
                
                # Extract classes and ids
                classes = re.findall(r'\.([^#\.\s]+)', class_id_part)
                ids = re.findall(r'#([^#\.\s]+)', class_id_part)
                
                if classes:
                    # Merge with any existing class attribute
                    existing_class = attributes.get('class', '')
                    all_classes = (existing_class + ' ' + ' '.join(classes)).strip()
                    attributes['class'] = all_classes
                if ids:
                    attributes['id'] = ids[-1]  # Use last id if multiple
        
        # Check for self-closing tag
        if content.endswith('/'):
            self_closing = True
            content = content[:-1].strip()
        
        # Common self-closing tags
        if tag_name in ['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']:
            self_closing = True
        
        return tag_name, attributes, content, self_closing
    
    def _parse_haml_attributes(self, attrs_str: str) -> dict:
        """Parse HAML attributes from string like 'lang: "en", charset: "utf-8"'"""
        attributes = {}
        
        # Handle both new style (key: "value") and old style (:key => "value")
        # Split by commas, but be careful of commas inside quotes
        attr_pairs = []
        current_pair = ""
        in_quotes = False
        quote_char = None
        
        for char in attrs_str:
            if char in ['"', "'"] and not in_quotes:
                in_quotes = True
                quote_char = char
                current_pair += char
            elif char == quote_char and in_quotes:
                in_quotes = False
                quote_char = None
                current_pair += char
            elif char == ',' and not in_quotes:
                if current_pair.strip():
                    attr_pairs.append(current_pair.strip())
                current_pair = ""
            else:
                current_pair += char
        
        # Add the last pair
        if current_pair.strip():
            attr_pairs.append(current_pair.strip())
        
        # Parse each attribute pair
        for pair in attr_pairs:
            pair = pair.strip()
            
            # Handle new style: key: "value"
            if ':' in pair and '=>' not in pair:
                key_part, value_part = pair.split(':', 1)
                key = key_part.strip()
                value = value_part.strip()
                
                # Remove quotes from value
                if value.startswith('"') and value.endswith('"'):
                    value = value[1:-1]
                elif value.startswith("'") and value.endswith("'"):
                    value = value[1:-1]
                
                attributes[key] = value
            
            # Handle old style: :key => "value"
            elif '=>' in pair:
                key_part, value_part = pair.split('=>', 1)
                key = key_part.strip()
                value = value_part.strip()
                
                # Remove leading colon from key
                if key.startswith(':'):
                    key = key[1:]
                
                # Remove quotes from value
                if value.startswith('"') and value.endswith('"'):
                    value = value[1:-1]
                elif value.startswith("'") and value.endswith("'"):
                    value = value[1:-1]
                
                attributes[key] = value
        
        return attributes
    
    def _build_html_tag(self, tag_name: str, attributes: dict, content: str, self_closing: bool, indent_level: int) -> str:
        """Build the HTML tag string"""
        indent = '  ' * (indent_level // 2)
        
        # Build attributes string
        attr_str = ""
        if attributes:
            attr_parts = []
            for key, value in attributes.items():
                attr_parts.append(f'{key}="{value}"')
            attr_str = ' ' + ' '.join(attr_parts)
        
        if self_closing:
            html_tag = f"{indent}<{tag_name}{attr_str}>"
        else:
            if content:
                # If there's inline content, create a complete tag and don't add to indent stack
                html_tag = f"{indent}<{tag_name}{attr_str}>{content}</{tag_name}>"
            else:
                # No inline content, create opening tag only
                html_tag = f"{indent}<{tag_name}{attr_str}>"
        
        return html_tag


def convert_haml_to_html(haml_content: str) -> str:
    """Convert HAML content to HTML using our simple processor"""
    processor = SimpleHamlProcessor()
    return processor.process(haml_content)


if __name__ == "__main__":
    # Test the processor
    haml_test = """!!!
%html{lang: "en"}
  %head
    %title Test Page
    %meta{charset: "utf-8"}
  %body
    %h1 Hello World
    %p This is a test paragraph.
    %div.container{id: "main-container", data-role: "content"}
      %ul
        %li Item 1
        %li Item 2
        %li Item 3
    .footer
      %p Footer content
    #main-content
      %p Main content here
"""

    print("Original HAML:")
    print(haml_test)
    print("\n" + "="*50 + "\n")
    
    try:
        html_result = convert_haml_to_html(haml_test)
        print("Converted HTML:")
        print(html_result)
        print("\nHAML conversion test: SUCCESS ✓")
    except Exception as e:
        print(f"HAML conversion test: FAILED ✗")
        print(f"Error: {e}") 