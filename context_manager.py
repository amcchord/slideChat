import logging
import re
from datetime import datetime
from typing import List, Dict, Tuple, Optional
import json

logger = logging.getLogger(__name__)

class ContextManager:
    """
    Advanced context window management for chat conversations.
    Implements progressive management strategies to prevent abrupt cutoffs.
    """
    
    def __init__(self, context_window: int = 200000, 
                 warning_threshold: float = 0.7,
                 soft_limit_threshold: float = 0.8,
                 hard_limit_threshold: float = 0.9):
        self.context_window = context_window
        self.warning_threshold = warning_threshold
        self.soft_limit_threshold = soft_limit_threshold  
        self.hard_limit_threshold = hard_limit_threshold
        
        # Importance keywords for scoring messages
        self.importance_keywords = {
            'high': ['important', 'remember', 'key', 'critical', 'essential', 'must', 
                    'error', 'bug', 'issue', 'problem', 'solution', 'fixed'],
            'medium': ['please', 'help', 'question', 'how', 'what', 'why', 'when',
                      'explain', 'understand', 'clarify'],
            'low': ['thanks', 'okay', 'yes', 'no', 'sure', 'got it', 'understood']
        }
        
    def estimate_tokens(self, text: str) -> int:
        """Estimate token count using improved heuristics"""
        if not text:
            return 0
        
        # More accurate estimation considering punctuation and special chars
        char_count = len(str(text))
        word_count = len(text.split())
        
        # Average of character and word-based estimates
        char_estimate = char_count / 3.5
        word_estimate = word_count * 1.3
        
        return int((char_estimate + word_estimate) / 2)
    
    def calculate_message_importance(self, message: Dict) -> float:
        """
        Score message importance based on content and context.
        Returns score between 0.0 and 1.0
        """
        content = message.get('content', '').lower()
        role = message.get('role', '')
        
        # Base scores by role
        score = 0.3 if role == 'assistant' else 0.4
        
        # Check for code blocks (important for technical conversations)
        if '```' in content:
            score += 0.2
            
        # Check for tool usage (indicates action taken)
        if 'tool_use' in message or '🔧' in content:
            score += 0.15
            
        # Check for artifacts (important content)
        if 'artifact' in content or '<artifact' in content:
            score += 0.2
            
        # Keyword scoring
        for level, keywords in self.importance_keywords.items():
            matches = sum(1 for keyword in keywords if keyword in content)
            if matches > 0:
                if level == 'high':
                    score += min(0.3, matches * 0.1)
                elif level == 'medium':
                    score += min(0.2, matches * 0.05)
                else:
                    score -= min(0.1, matches * 0.02)
        
        # Length factor (longer messages often contain more info)
        if len(content) > 500:
            score += 0.1
        elif len(content) < 50:
            score -= 0.1
            
        # Recency boost (newer messages get slight preference)
        if 'timestamp' in message:
            try:
                msg_time = datetime.fromisoformat(message['timestamp'])
                age_hours = (datetime.now() - msg_time).total_seconds() / 3600
                if age_hours < 1:
                    score += 0.1
                elif age_hours > 24:
                    score -= 0.1
            except:
                pass
                
        return max(0.0, min(1.0, score))
    
    def summarize_messages(self, messages: List[Dict]) -> str:
        """
        Create a concise summary of multiple messages.
        This is a simple implementation - could be enhanced with AI.
        """
        if not messages:
            return ""
            
        summary_parts = []
        user_topics = set()
        assistant_actions = set()
        
        for msg in messages:
            role = msg.get('role', '')
            content = msg.get('content', '')
            
            if role == 'user':
                # Extract main topics from user messages
                if len(content) > 20:
                    # Simple topic extraction (could be improved)
                    if '?' in content:
                        user_topics.add(content.split('?')[0].strip()[-50:] + '?')
                    else:
                        user_topics.add(content[:50] + '...')
                        
            elif role == 'assistant':
                # Track assistant actions
                if '🔧' in content:
                    assistant_actions.add('used tools')
                if 'artifact' in content.lower():
                    assistant_actions.add('created artifacts')
                if '```' in content:
                    assistant_actions.add('provided code')
                    
        # Build summary
        if user_topics:
            summary_parts.append(f"User asked about: {', '.join(list(user_topics)[:3])}")
        if assistant_actions:
            summary_parts.append(f"Assistant {', '.join(assistant_actions)}")
            
        timestamp = messages[0].get('timestamp', datetime.now().isoformat())
        summary = f"[Summary of {len(messages)} messages from {timestamp[:10]}] " + '. '.join(summary_parts)
        
        return summary
    
    def get_context_state(self, messages: List[Dict], system_message: str = "") -> Dict:
        """Get detailed context window state"""
        total_tokens = self.estimate_tokens(system_message)
        
        for message in messages:
            content = message.get('content', '')
            total_tokens += self.estimate_tokens(content) + 10  # overhead
            
        usage_ratio = total_tokens / self.context_window
        
        # Determine management strategy needed
        if usage_ratio >= self.hard_limit_threshold:
            strategy = 'aggressive'
            status = 'critical'
        elif usage_ratio >= self.soft_limit_threshold:
            strategy = 'moderate'
            status = 'warning'
        elif usage_ratio >= self.warning_threshold:
            strategy = 'light'
            status = 'caution'
        else:
            strategy = 'none'
            status = 'normal'
            
        return {
            'tokens_used': total_tokens,
            'tokens_limit': self.context_window,
            'usage_percentage': round(usage_ratio * 100, 1),
            'usage_ratio': usage_ratio,
            'message_count': len(messages),
            'status': status,
            'strategy': strategy,
            'tokens_remaining': self.context_window - total_tokens
        }
    
    def manage_context(self, messages: List[Dict], system_message: str = "") -> Tuple[List[Dict], Dict]:
        """
        Main context management function with progressive strategies.
        Returns (managed_messages, management_info)
        """
        if not messages:
            return messages, {'action': 'none', 'removed': 0}
            
        state = self.get_context_state(messages, system_message)
        
        if state['strategy'] == 'none':
            return messages, {'action': 'none', 'removed': 0, 'state': state}
            
        # Calculate importance scores for all messages
        scored_messages = []
        for i, msg in enumerate(messages):
            score = self.calculate_message_importance(msg)
            # Boost score for recent messages
            recency_boost = (i / len(messages)) * 0.3
            final_score = score + recency_boost
            scored_messages.append((final_score, i, msg))
            
        # Sort by score (lower scores = less important)
        scored_messages.sort(key=lambda x: x[0])
        
        managed_messages = messages.copy()
        removed_count = 0
        summarized_groups = []
        
        # Progressive removal based on strategy
        if state['strategy'] == 'light':
            # Remove lowest importance messages (up to 20%)
            remove_count = max(2, int(len(messages) * 0.2))
            
        elif state['strategy'] == 'moderate':
            # Remove more messages and start summarizing (up to 40%)
            remove_count = max(4, int(len(messages) * 0.4))
            
        elif state['strategy'] == 'aggressive':
            # Keep only essential messages (remove up to 60%)
            remove_count = max(6, int(len(messages) * 0.6))
            
        # Build list of messages to remove
        messages_to_remove = []
        groups_to_summarize = []
        
        for score, idx, msg in scored_messages[:remove_count]:
            # Don't remove the most recent 4 messages
            if idx >= len(messages) - 4:
                continue
                
            # Group consecutive messages for summarization
            if groups_to_summarize and idx == groups_to_summarize[-1][-1] + 1:
                groups_to_summarize[-1].append(idx)
            else:
                groups_to_summarize.append([idx])
                
            messages_to_remove.append(idx)
            
        # Create summaries for removed message groups
        summary_messages = []
        for group in groups_to_summarize:
            if len(group) >= 2:  # Only summarize groups of 2+ messages
                group_messages = [messages[i] for i in group]
                summary = self.summarize_messages(group_messages)
                if summary:
                    summary_msg = {
                        'role': 'system',
                        'content': summary,
                        'timestamp': group_messages[0].get('timestamp'),
                        'is_summary': True
                    }
                    summary_messages.append((group[0], summary_msg))
                    
        # Build final message list
        final_messages = []
        removed_indices = set(messages_to_remove)
        summary_dict = dict(summary_messages)
        
        for i, msg in enumerate(messages):
            if i in summary_dict and i == min(removed_indices):
                # Insert summary at the position of first removed message
                final_messages.append(summary_dict[i])
            if i not in removed_indices:
                final_messages.append(msg)
                
        # Ensure we actually reduced token count
        new_state = self.get_context_state(final_messages, system_message)
        
        management_info = {
            'action': state['strategy'],
            'removed': len(messages_to_remove),
            'summarized': len(summary_messages),
            'original_tokens': state['tokens_used'],
            'final_tokens': new_state['tokens_used'],
            'reduction_percentage': round((1 - new_state['tokens_used']/state['tokens_used']) * 100, 1),
            'state': new_state
        }
        
        logger.info(f"Context management: {management_info}")
        
        return final_messages, management_info
    
    def get_context_status_message(self, state: Dict) -> Optional[str]:
        """Generate user-friendly status message about context usage"""
        usage = state['usage_percentage']
        remaining = state['tokens_remaining']
        
        if state['status'] == 'critical':
            return f"⚠️ Context window {usage}% full. Older messages being summarized to maintain conversation flow."
        elif state['status'] == 'warning':
            return f"📊 Context usage at {usage}%. Starting to optimize conversation history."
        elif state['status'] == 'caution':
            return f"💡 Context {usage}% used (~{remaining:,} tokens remaining)."
        
        return None 