import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: {
    tweet_analyzed?: boolean;
    images?: string[];
    links?: string[];
  };
}

interface Props {
  userId: string;
}

export default function GrokTerminal({ userId }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'system',
      content: `grok v3 • connected as @1991skylar • type /help for commands`,
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const extractLinks = (text: string): string[] => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex) || [];
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userInput = input.trim();
    setInput('');
    setHistory(prev => [...prev, userInput]);
    setHistoryIndex(-1);

    // Handle local commands
    if (userInput.startsWith('/')) {
      handleCommand(userInput);
      return;
    }

    // Add user message
    const links = extractLinks(userInput);
    setMessages(prev => [...prev, {
      role: 'user',
      content: userInput,
      timestamp: new Date(),
      metadata: { links }
    }]);

    setLoading(true);

    try {
      const session = await supabase.auth.getSession();
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/grok-agent`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.data.session?.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: userId,
            message: userInput,
            conversation_history: messages
              .filter(m => m.role !== 'system')
              .map(m => ({ role: m.role, content: m.content }))
          })
        }
      );

      const result = await response.json();

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.reply || result.error || 'No response',
        timestamp: new Date(),
        metadata: { tweet_analyzed: result.tweet_analyzed }
      }]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `error: ${err.message}`,
        timestamp: new Date()
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleCommand = (cmd: string) => {
    const [command, ...args] = cmd.slice(1).split(' ');

    switch (command.toLowerCase()) {
      case 'help':
        setMessages(prev => [...prev, {
          role: 'system',
          content: `commands:
  /help           show this help
  /clear          clear conversation
  /viral          what's trending now
  /analyze <url>  analyze a tweet/post
  /draft          draft a long-form post
  /thread         plan a thread
  /style          content style guide

just type naturally to chat with grok about:
  • meme trends and viral content
  • content strategy
  • analyzing posts (paste links)
  • drafting threads and long-form`,
          timestamp: new Date()
        }]);
        break;

      case 'clear':
        setMessages([{
          role: 'system',
          content: 'conversation cleared',
          timestamp: new Date()
        }]);
        break;

      case 'viral':
        setInput('what content is going viral right now in car culture and memes?');
        break;

      case 'analyze':
        if (args.length > 0) {
          setInput(`analyze this post: ${args.join(' ')}`);
        } else {
          setMessages(prev => [...prev, {
            role: 'system',
            content: 'usage: /analyze <url>',
            timestamp: new Date()
          }]);
        }
        break;

      case 'draft':
        setInput('help me draft a long-form post or thread about my K5 Blazer build');
        break;

      case 'thread':
        setInput('help me plan a thread about ');
        break;

      case 'style':
        setMessages(prev => [...prev, {
          role: 'system',
          content: `content style guide:

short posts (under 280):
  • minimal captions: "she ready", "finally", "built not bought"
  • let photos speak
  • no meme formats, no cringe

long-form / threads:
  • story arcs work: before/after, journey, lessons learned
  • educational content: how-tos, breakdowns, comparisons
  • hot takes with substance
  • numbered threads for builds/projects

what's working now:
  • raw authenticity over polish
  • behind-the-scenes > finished product
  • engagement bait that delivers value
  • community callouts and collaborations`,
          timestamp: new Date()
        }]);
        break;

      default:
        setMessages(prev => [...prev, {
          role: 'system',
          content: `unknown command: ${command}. type /help for commands`,
          timestamp: new Date()
        }]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setInput(history[history.length - 1 - newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(history[history.length - 1 - newIndex] || '');
      } else {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  const formatContent = (content: string) => {
    // Handle code blocks
    const parts = content.split(/(```[\s\S]*?```)/g);

    return parts.map((part, i) => {
      if (part.startsWith('```')) {
        const code = part.slice(3, -3).replace(/^\w+\n/, '');
        return (
          <pre key={i} style={{
            background: 'rgba(255,255,255,0.05)',
            padding: '12px',
            borderRadius: '4px',
            overflow: 'auto',
            margin: '8px 0'
          }}>
            {code}
          </pre>
        );
      }

      // Handle inline links
      const linkRegex = /(https?:\/\/[^\s]+)/g;
      const textParts = part.split(linkRegex);

      return textParts.map((text, j) => {
        if (text.match(linkRegex)) {
          return (
            <a
              key={`${i}-${j}`}
              href={text}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#60a5fa', textDecoration: 'underline' }}
            >
              {text}
            </a>
          );
        }
        return <span key={`${i}-${j}`}>{text}</span>;
      });
    });
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#0d0d0d',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: '13px',
      color: '#e5e5e5'
    }}>
      {/* Terminal Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #262626',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        background: '#171717'
      }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ef4444' }} />
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#eab308' }} />
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#22c55e' }} />
        </div>
        <span style={{ color: '#737373', flex: 1 }}>grok — social strategy agent</span>
        <span style={{
          padding: '2px 8px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: 600
        }}>
          LIVE
        </span>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px'
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: '16px' }}>
            {msg.role === 'user' ? (
              <div>
                <span style={{ color: '#22c55e' }}>❯ </span>
                <span style={{ color: '#fafafa' }}>{msg.content}</span>
              </div>
            ) : msg.role === 'system' ? (
              <div style={{ color: '#737373', whiteSpace: 'pre-wrap' }}>
                {msg.content}
              </div>
            ) : (
              <div style={{
                paddingLeft: '16px',
                borderLeft: '2px solid #404040',
                marginTop: '8px',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.6
              }}>
                {msg.metadata?.tweet_analyzed && (
                  <div style={{
                    color: '#60a5fa',
                    fontSize: '11px',
                    marginBottom: '8px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    ◆ tweet analyzed
                  </div>
                )}
                {formatContent(msg.content)}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ color: '#737373' }}>
            <span style={{ color: '#667eea' }}>⟳</span> thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} style={{
        padding: '16px',
        borderTop: '1px solid #262626',
        background: '#171717'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#22c55e' }}>❯</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="ask grok anything... paste links to analyze... /help for commands"
            disabled={loading}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#fafafa',
              fontSize: '13px',
              fontFamily: 'inherit'
            }}
          />
        </div>
      </form>
    </div>
  );
}
