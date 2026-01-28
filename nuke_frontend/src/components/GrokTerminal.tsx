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
    const lines = content.split('\n');

    return lines.map((line, i) => {
      // Headers
      if (line.startsWith('### ')) {
        return (
          <div key={i} style={{ fontWeight: 700, marginTop: '16px', marginBottom: '8px', color: '#e7e9ea', fontSize: '16px' }}>
            {line.slice(4)}
          </div>
        );
      }
      if (line.startsWith('## ')) {
        return (
          <div key={i} style={{ fontWeight: 700, fontSize: '18px', marginTop: '20px', marginBottom: '8px', color: '#e7e9ea' }}>
            {line.slice(3)}
          </div>
        );
      }

      // Bullet points
      if (line.startsWith('- ') || line.startsWith('* ')) {
        return (
          <div key={i} style={{ paddingLeft: '20px', position: 'relative', marginBottom: '4px' }}>
            <span style={{ position: 'absolute', left: '8px', color: '#1d9bf0' }}>•</span>
            {renderInlineFormatting(line.slice(2))}
          </div>
        );
      }

      // Numbered lists
      const numMatch = line.match(/^(\d+)\.\s+(.+)/);
      if (numMatch) {
        return (
          <div key={i} style={{ marginTop: '8px', marginBottom: '4px' }}>
            <span style={{ color: '#1d9bf0', marginRight: '8px' }}>{numMatch[1]}.</span>
            {renderInlineFormatting(numMatch[2])}
          </div>
        );
      }

      // Code blocks (inline)
      if (line.startsWith('```') || line.endsWith('```')) {
        return null; // Skip code fence markers
      }

      // Empty line = paragraph break
      if (!line.trim()) {
        return <div key={i} style={{ height: '12px' }} />;
      }

      return <div key={i} style={{ marginBottom: '4px' }}>{renderInlineFormatting(line)}</div>;
    });
  };

  const renderInlineFormatting = (text: string) => {
    // Bold text
    const boldParts = text.split(/\*\*(.+?)\*\*/g);
    if (boldParts.length > 1) {
      return (
        <>
          {boldParts.map((part, j) =>
            j % 2 === 1
              ? <strong key={j} style={{ color: '#e7e9ea', fontWeight: 600 }}>{part}</strong>
              : <span key={j}>{renderLinks(part)}</span>
          )}
        </>
      );
    }

    return renderLinks(text);
  };

  const renderLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    if (urlRegex.test(text)) {
      const parts = text.split(urlRegex);
      return (
        <>
          {parts.map((part, j) =>
            part.match(urlRegex)
              ? <a key={j} href={part} target="_blank" rel="noopener noreferrer" style={{ color: '#1d9bf0', textDecoration: 'none' }}>{part}</a>
              : <span key={j}>{part}</span>
          )}
        </>
      );
    }
    return text;
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#000',
      color: '#e7e9ea',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '15px',
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
            <div style={{ marginBottom: '32px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '16px'
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #1d9bf0 0%, #7856ff 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '24px'
                }}>
                  ✨
                </div>
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 700 }}>Grok</div>
                  <div style={{ color: '#71767b', fontSize: '14px' }}>Your social media strategist</div>
                </div>
              </div>
              <div style={{ color: '#71767b', fontSize: '15px' }}>
                I have access to your vehicles, photos, and posts. Ask me anything about content strategy, viral trends, or what to post next.
              </div>
            </div>

            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#71767b', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Try these
              </div>
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
                    padding: '14px 16px',
                    cursor: 'pointer',
                    color: '#e7e9ea',
                    background: '#16181c',
                    borderRadius: '12px',
                    marginBottom: '8px',
                    transition: 'background 0.15s',
                    fontSize: '15px'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#1d1f23'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#16181c'}
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
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: '#2f3336',
                      flexShrink: 0
                    }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '4px' }}>You</div>
                      <div style={{ color: '#e7e9ea' }}>{msg.content}</div>
                    </div>
                  </div>
                ) : msg.loading ? (
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #1d9bf0 0%, #7856ff 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '16px',
                      flexShrink: 0
                    }}>
                      ✨
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '4px' }}>Grok</div>
                      <div style={{ color: '#71767b' }}>
                        <span style={{ animation: 'pulse 1.5s infinite' }}>thinking...</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #1d9bf0 0%, #7856ff 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '16px',
                      flexShrink: 0
                    }}>
                      ✨
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>Grok</div>
                      <div style={{ color: '#e7e9ea' }}>
                        {renderContent(msg.content)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div style={{
        borderTop: '1px solid #2f3336',
        padding: '16px 32px',
        background: '#000'
      }}>
        <div style={{
          maxWidth: '800px',
          background: '#16181c',
          borderRadius: '16px',
          border: '1px solid #2f3336',
          overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', padding: '12px 16px', gap: '12px' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Grok anything..."
              disabled={loading}
              rows={1}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#e7e9ea',
                fontSize: '15px',
                fontFamily: 'inherit',
                resize: 'none',
                padding: '4px 0',
                lineHeight: 1.5
              }}
            />
            {input.trim() && (
              <button
                onClick={() => handleSubmit()}
                disabled={loading}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: '#1d9bf0',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                  flexShrink: 0
                }}
              >
                ↑
              </button>
            )}
          </div>
        </div>
        <div style={{ maxWidth: '800px', paddingLeft: '4px', marginTop: '8px' }}>
          <span style={{ color: '#536471', fontSize: '13px' }}>
            shift+enter for new line · paste X links to analyze
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
