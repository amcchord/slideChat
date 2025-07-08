"""
Style Guide Framework for Chat.Slide.Recipes

This module provides utilities for generating consistent HTML artifacts with proper
theming, layout, and styling conventions.
"""

import json
from typing import Dict, List, Optional, Any
from datetime import datetime

class StyleGuide:
    """
    Framework for generating consistent HTML artifacts with proper styling.
    Provides templates and utilities for creating professional-looking HTML content.
    """
    
    def __init__(self):
        # CSS Variables that match the main application theme
        self.css_variables = {
            # Primary Colors
            'primary': '#1a1a1a',
            'primary-light': '#333333',
            'primary-dark': '#000000',
            
            # Background Colors
            'background': '#f5f5f5',
            'background-light': '#ffffff',
            'background-dark': '#f9fafb',
            'background-highlight': '#f8fafc',
            
            # Accent Colors
            'accent': '#2563eb',
            'accent-light': '#3b82f6',
            'accent-dark': '#1d4ed8',
            'accent-subtle': 'rgba(37, 99, 235, 0.1)',
            
            # Text Colors
            'text-primary': '#1a1a1a',
            'text-secondary': '#6b7280',
            'text-muted': '#9ca3af',
            
            # Status Colors
            'success': '#10b981',
            'warning': '#f59e0b',
            'error': '#dc2626',
            'warning-bg': '#fef3c7',
            
            # Border Colors
            'border': '#e5e5e5',
            'border-light': '#f3f4f6',
            'border-dark': '#d1d5db',
            
            # Shadows
            'shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.05)',
            'shadow-md': '0 1px 3px rgba(0, 0, 0, 0.1)',
            'shadow-lg': '2px 0 10px rgba(0, 0, 0, 0.1)',
        }
        
        # Base HTML template with consistent styling
        self.base_template = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <style>
        {css_variables}
        {base_styles}
        {custom_styles}
    </style>
</head>
<body>
    {content}
</body>
</html>"""
        
        # Base CSS styles
        self.base_styles = """
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: var(--text-primary);
            background-color: var(--background);
            padding: 2rem;
            max-width: 1200px;
            margin: 0 auto;
        }
        
        h1, h2, h3, h4, h5, h6 {
            color: var(--text-primary);
            margin-bottom: 1rem;
            font-weight: 600;
        }
        
        h1 { font-size: 2.5rem; }
        h2 { font-size: 2rem; }
        h3 { font-size: 1.5rem; }
        h4 { font-size: 1.25rem; }
        h5 { font-size: 1.125rem; }
        h6 { font-size: 1rem; }
        
        p {
            margin-bottom: 1rem;
            color: var(--text-secondary);
        }
        
        .header {
            background: var(--primary);
            color: white;
            padding: 2rem;
            margin: -2rem -2rem 2rem -2rem;
            border-radius: 0 0 8px 8px;
        }
        
        .header h1 {
            color: white;
            margin-bottom: 0.5rem;
        }
        
        .header p {
            color: rgba(255, 255, 255, 0.8);
            margin-bottom: 0;
        }
        
        .content-section {
            background: var(--background-light);
            padding: 2rem;
            margin-bottom: 2rem;
            border-radius: 8px;
            box-shadow: var(--shadow-md);
        }
        
        .highlight-box {
            background: var(--background-highlight);
            border-left: 4px solid var(--accent);
            padding: 1rem;
            margin: 1rem 0;
            border-radius: 0 4px 4px 0;
        }
        
        .warning-box {
            background: var(--warning-bg);
            border-left: 4px solid var(--warning);
            padding: 1rem;
            margin: 1rem 0;
            border-radius: 0 4px 4px 0;
        }
        
        .button {
            background: var(--accent);
            color: white;
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            text-decoration: none;
            display: inline-block;
            transition: background-color 0.2s ease;
        }
        
        .button:hover {
            background: var(--accent-dark);
        }
        
        .button-secondary {
            background: var(--background-dark);
            color: var(--text-primary);
            border: 1px solid var(--border-dark);
        }
        
        .button-secondary:hover {
            background: var(--border-light);
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 1rem 0;
            background: var(--background-light);
            border-radius: 8px;
            overflow: hidden;
            box-shadow: var(--shadow-sm);
        }
        
        th {
            background: var(--primary);
            color: white;
            padding: 1rem;
            text-align: left;
            font-weight: 600;
        }
        
        td {
            padding: 1rem;
            border-bottom: 1px solid var(--border-light);
        }
        
        tr:last-child td {
            border-bottom: none;
        }
        
        tr:nth-child(even) {
            background: var(--background-highlight);
        }
        
        .status-success {
            color: var(--success);
            font-weight: 500;
        }
        
        .status-warning {
            color: var(--warning);
            font-weight: 500;
        }
        
        .status-error {
            color: var(--error);
            font-weight: 500;
        }
        
        .grid {
            display: grid;
            gap: 1rem;
            margin: 1rem 0;
        }
        
        .grid-2 { grid-template-columns: repeat(2, 1fr); }
        .grid-3 { grid-template-columns: repeat(3, 1fr); }
        .grid-4 { grid-template-columns: repeat(4, 1fr); }
        
        .card {
            background: var(--background-light);
            padding: 1.5rem;
            border-radius: 8px;
            box-shadow: var(--shadow-md);
            border: 1px solid var(--border-light);
        }
        
        .card h3 {
            margin-bottom: 0.5rem;
            color: var(--text-primary);
        }
        
        .card p {
            color: var(--text-secondary);
            margin-bottom: 0;
        }
        
        .metric {
            text-align: center;
            padding: 1rem;
        }
        
        .metric-value {
            font-size: 2rem;
            font-weight: 700;
            color: var(--accent);
            display: block;
        }
        
        .metric-label {
            font-size: 0.875rem;
            color: var(--text-muted);
            text-transform: uppercase;
            font-weight: 500;
        }
        
        .footer {
            text-align: center;
            margin-top: 3rem;
            padding-top: 2rem;
            border-top: 1px solid var(--border);
            color: var(--text-muted);
            font-size: 0.875rem;
        }
        
        @media (max-width: 768px) {
            body {
                padding: 1rem;
            }
            
            .header {
                margin: -1rem -1rem 1rem -1rem;
                padding: 1.5rem;
            }
            
            .content-section {
                padding: 1.5rem;
            }
            
            .grid-2, .grid-3, .grid-4 {
                grid-template-columns: 1fr;
            }
        }
        """
    
    def get_css_variables(self) -> str:
        """Generate CSS variables string"""
        variables = []
        for key, value in self.css_variables.items():
            variables.append(f"    --{key}: {value};")
        
        return ":root {\n" + "\n".join(variables) + "\n}"
    
    def generate_html(self, title: str, content: str, custom_styles: str = "") -> str:
        """Generate complete HTML document with consistent styling"""
        return self.base_template.format(
            title=title,
            css_variables=self.get_css_variables(),
            base_styles=self.base_styles,
            custom_styles=custom_styles,
            content=content
        )
    
    def create_report_header(self, title: str, subtitle: str = "", timestamp: str = None) -> str:
        """Create a standard report header"""
        if timestamp is None:
            timestamp = datetime.now().strftime("%B %d, %Y at %I:%M %p")
        
        subtitle_html = f"<p>Generated on {timestamp}</p>" if not subtitle else f"<p>{subtitle}</p><p>Generated on {timestamp}</p>"
        
        return f"""
        <div class="header">
            <h1>{title}</h1>
            {subtitle_html}
        </div>
        """
    
    def create_data_table(self, headers: List[str], rows: List[List[str]], 
                         status_column: Optional[int] = None) -> str:
        """Create a properly styled data table"""
        header_html = "<tr>" + "".join(f"<th>{header}</th>" for header in headers) + "</tr>"
        
        row_html = []
        for row in rows:
            row_cells = []
            for i, cell in enumerate(row):
                if status_column is not None and i == status_column:
                    # Apply status styling
                    cell_lower = str(cell).lower()
                    if any(word in cell_lower for word in ['success', 'ok', 'active', 'healthy']):
                        cell_html = f'<td><span class="status-success">{cell}</span></td>'
                    elif any(word in cell_lower for word in ['warning', 'caution', 'pending']):
                        cell_html = f'<td><span class="status-warning">{cell}</span></td>'
                    elif any(word in cell_lower for word in ['error', 'failed', 'down', 'critical']):
                        cell_html = f'<td><span class="status-error">{cell}</span></td>'
                    else:
                        cell_html = f'<td>{cell}</td>'
                else:
                    cell_html = f'<td>{cell}</td>'
                row_cells.append(cell_html)
            row_html.append("<tr>" + "".join(row_cells) + "</tr>")
        
        return f"""
        <table>
            <thead>{header_html}</thead>
            <tbody>{"".join(row_html)}</tbody>
        </table>
        """
    
    def create_metrics_grid(self, metrics: List[Dict[str, Any]], columns: int = 3) -> str:
        """Create a grid of metric cards"""
        grid_class = f"grid-{columns}"
        
        cards = []
        for metric in metrics:
            value = metric.get('value', 'N/A')
            label = metric.get('label', '')
            
            card_html = f"""
            <div class="card metric">
                <span class="metric-value">{value}</span>
                <span class="metric-label">{label}</span>
            </div>
            """
            cards.append(card_html)
        
        return f'<div class="grid {grid_class}">{"".join(cards)}</div>'
    
    def create_highlight_box(self, content: str, box_type: str = "info") -> str:
        """Create a highlighted information box"""
        box_class = "highlight-box" if box_type == "info" else "warning-box"
        return f'<div class="{box_class}">{content}</div>'
    
    def create_button(self, text: str, href: str = "#", button_type: str = "primary") -> str:
        """Create a styled button"""
        button_class = "button" if button_type == "primary" else "button button-secondary"
        return f'<a href="{href}" class="{button_class}">{text}</a>'
    
    def create_footer(self, text: str = None) -> str:
        """Create a standard footer"""
        if text is None:
            text = f"Generated by Chat.Slide.Recipes on {datetime.now().strftime('%B %d, %Y at %I:%M %p')}"
        
        return f'<div class="footer">{text}</div>'

# Global style guide instance
style_guide = StyleGuide() 