import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  loading?: boolean;
}

interface Props {
  userId: string;
}

export default function GrokTerminal({ userId }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || loading) return;

    const userInput = input.trim();
    setInput('');
    setHistory(prev => [...prev, userInput]);
    setHistoryIndex(-1);

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `assistant-${Date.now()}`;

    // Add user message
    setMessages(prev => [...prev, {
      id: userMsgId,
      role: 'user',
      content: userInput,
      timestamp: new Date()
    }]);

    // Add loading message
    setMessages(prev => [...prev, {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      loading: true
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
              .filter(m => m.role !== 'system' && !m.loading)
              .map(m => ({ role: m.role, content: m.content }))
          })
        }
      );

      const result = await response.json();

      // Update the loading message with actual content
      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId
          ? { ...m, content: result.reply || result.error || 'No response', loading: false }
          : m
      ));
    } catch (err: any) {
      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId
          ? { ...m, content: `Error: ${err.message}`, loading: false }
          : m
      ));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'ArrowUp' && !input) {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setInput(history[history.length - 1 - newIndex] || '');
      }
    } else if (e.key === 'ArrowDown' && !input) {
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

  const renderContent = (content: string) => {
    // Simple markdown-ish rendering
    const lines = content.split('\n');

    return lines.map((line, i) => {
      // Headers
      if (line.startsWith('### ')) {
        return <div key={i} style={{ fontWeight: 600, marginTop: '16px', marginBottom: '8px', color: '#fff' }}>{line.slice(4)}</div>;
      }
      if (line.startsWith('## ')) {
        return <div key={i} style={{ fontWeight: 600, fontSize: '15px', marginTop: '20px', marginBottom: '8px', color: '#fff' }}>{line.slice(3)}</div>;
      }

      // Bullet points
      if (line.startsWith('- ') || line.startsWith('• ')) {
        return <div key={i} style={{ paddingLeft: '16px', position: 'relative' }}><span style={{ position: 'absolute', left: 0 }}>•</span>{line.slice(2)}</div>;
      }

      // Numbered lists
      const numMatch = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*:?\s*(.*)/);
      if (numMatch) {
        return (
          <div key={i} style={{ marginTop: '12px' }}>
            <span style={{ color: '#737373' }}>{numMatch[1]}.</span>{' '}
            <span style={{ fontWeight: 600, color: '#e5e5e5' }}>{numMatch[2]}</span>
            {numMatch[3] && <span style={{ color: '#a3a3a3' }}>: {numMatch[3]}</span>}
          </div>
        );
      }

      // Bold text
      const boldParts = line.split(/\*\*(.+?)\*\*/g);
      if (boldParts.length > 1) {
        return (
          <div key={i}>
            {boldParts.map((part, j) =>
              j % 2 === 1
                ? <strong key={j} style={{ color: '#e5e5e5' }}>{part}</strong>
                : <span key={j}>{part}</span>
            )}
          </div>
        );
      }

      // Links
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      if (urlRegex.test(line)) {
        const parts = line.split(urlRegex);
        return (
          <div key={i}>
            {parts.map((part, j) =>
              part.match(urlRegex)
                ? <a key={j} href={part} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'none' }}>{part}</a>
                : <span key={j}>{part}</span>
            )}
          </div>
        );
      }

      // Empty line = paragraph break
      if (!line.trim()) {
        return <div key={i} style={{ height: '12px' }} />;
      }

      return <div key={i}>{line}</div>;
    });
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#000',
      color: '#a3a3a3',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '14px',
      lineHeight: 1.6
    }}>
      {/* Content Area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '24px 32px'
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {messages.length === 0 ? (
          <div style={{ maxWidth: '600px' }}>
            <div style={{ color: '#525252', marginBottom: '32px' }}>
              <div style={{ color: '#737373', fontWeight: 500, marginBottom: '8px' }}>grok</div>
              <div>Your social media strategist. I have access to your vehicles, photos, and posts.</div>
            </div>

            <div style={{ color: '#525252' }}>
              <div style={{ marginBottom: '16px' }}>Try:</div>
              {[
                "what content should I post this week?",
                "analyze https://x.com/...",
                "write me a thread about my K5 build",
                "what's going viral in car culture?",
                "draft a post showcasing my LS swap"
              ].map((suggestion, i) => (
                <div
                  key={i}
                  onClick={() => setInput(suggestion)}
                  style={{
                    padding: '8px 0',
                    cursor: 'pointer',
                    color: '#525252',
                    borderBottom: '1px solid #1a1a1a'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#a3a3a3'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#525252'}
                >
                  {suggestion}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: '800px' }}>
            {messages.map((msg) => (
              <div key={msg.id} style={{ marginBottom: '24px' }}>
                {msg.role === 'user' ? (
                  <div style={{ color: '#e5e5e5' }}>
                    <span style={{ color: '#525252', marginRight: '8px' }}>›</span>
                    {msg.content}
                  </div>
                ) : msg.loading ? (
                  <div style={{ color: '#525252', paddingLeft: '20px' }}>
                    <span style={{ animation: 'pulse 1.5s infinite' }}>thinking...</span>
                  </div>
                ) : (
                  <div style={{ paddingLeft: '20px', borderLeft: '1px solid #262626' }}>
                    {renderContent(msg.content)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div style={{
        borderTop: '1px solid #1a1a1a',
        padding: '16px 32px',
        background: '#000'
      }}>
        <div style={{ maxWidth: '800px', display: 'flex', alignItems: 'flex-end', gap: '12px' }}>
          <span style={{ color: '#525252', paddingBottom: '8px' }}>›</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="ask grok..."
            disabled={loading}
            rows={1}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#e5e5e5',
              fontSize: '14px',
              fontFamily: 'inherit',
              resize: 'none',
              padding: '8px 0',
              lineHeight: 1.6
            }}
          />
          {input.trim() && (
            <button
              onClick={() => handleSubmit()}
              disabled={loading}
              style={{
                background: '#262626',
                border: 'none',
                color: '#a3a3a3',
                padding: '8px 16px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              send
            </button>
          )}
        </div>
        <div style={{ maxWidth: '800px', paddingLeft: '20px', marginTop: '8px' }}>
          <span style={{ color: '#333', fontSize: '12px' }}>
            shift+enter for new line • paste x links to analyze
          </span>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
