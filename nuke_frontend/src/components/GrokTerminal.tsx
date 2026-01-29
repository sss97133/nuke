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

const IconSparkle = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z"/>
  </svg>
);

const IconSend = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
  </svg>
);

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

    setMessages(prev => [...prev, {
      id: userMsgId,
      role: 'user',
      content: userInput,
      timestamp: new Date()
    }]);

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
      if (line.startsWith('### ')) {
        return <div key={i} style={{ fontWeight: 700, marginTop: '12px', marginBottom: '6px', fontSize: 'var(--fs-11)' }}>{line.slice(4)}</div>;
      }
      if (line.startsWith('## ')) {
        return <div key={i} style={{ fontWeight: 700, marginTop: '16px', marginBottom: '8px', fontSize: 'var(--fs-11)' }}>{line.slice(3)}</div>;
      }

      if (line.startsWith('- ') || line.startsWith('* ')) {
        return (
          <div key={i} style={{ paddingLeft: '12px', position: 'relative', marginBottom: '4px' }}>
            <span style={{ position: 'absolute', left: '4px' }}>-</span>
            {renderInlineFormatting(line.slice(2))}
          </div>
        );
      }

      const numMatch = line.match(/^(\d+)\.\s+(.+)/);
      if (numMatch) {
        return (
          <div key={i} style={{ marginTop: '6px', marginBottom: '4px' }}>
            <span style={{ color: 'var(--text-secondary)', marginRight: '6px' }}>{numMatch[1]}.</span>
            {renderInlineFormatting(numMatch[2])}
          </div>
        );
      }

      if (line.startsWith('```') || line.endsWith('```')) {
        return null;
      }

      if (!line.trim()) {
        return <div key={i} style={{ height: '8px' }} />;
      }

      return <div key={i} style={{ marginBottom: '4px' }}>{renderInlineFormatting(line)}</div>;
    });
  };

  const renderInlineFormatting = (text: string) => {
    const boldParts = text.split(/\*\*(.+?)\*\*/g);
    if (boldParts.length > 1) {
      return (
        <>
          {boldParts.map((part, j) =>
            j % 2 === 1
              ? <strong key={j} style={{ fontWeight: 600 }}>{part}</strong>
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
              ? <a key={j} href={part} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{part}</a>
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
      background: 'var(--bg)',
      color: 'var(--text)',
      fontFamily: 'var(--font-family)',
      fontSize: 'var(--fs-10)'
    }}>
      <div
        ref={scrollRef}
        style={{ flex: 1, overflow: 'auto', padding: '16px' }}
        onClick={() => inputRef.current?.focus()}
      >
        {messages.length === 0 ? (
          <div style={{ maxWidth: '500px' }}>
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'var(--text)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--surface)'
                }}>
                  <IconSparkle />
                </div>
                <div>
                  <div style={{ fontSize: 'var(--fs-11)', fontWeight: 700 }}>Grok</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-9)' }}>Social media strategist</div>
                </div>
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-10)' }}>
                I have access to your vehicles, photos, and posts. Ask about content strategy, viral trends, or what to post.
              </div>
            </div>

            <div>
              <div style={{ fontSize: 'var(--fs-9)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Try
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
                  className="card"
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    marginBottom: '4px',
                    fontSize: 'var(--fs-10)'
                  }}
                >
                  {suggestion}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: '600px' }}>
            {messages.map((msg) => (
              <div key={msg.id} style={{ marginBottom: '16px' }}>
                {msg.role === 'user' ? (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--border)', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 'var(--fs-9)', marginBottom: '4px' }}>You</div>
                      <div>{msg.content}</div>
                    </div>
                  </div>
                ) : msg.loading ? (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: 'var(--text)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--surface)',
                      flexShrink: 0
                    }}>
                      <IconSparkle />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 'var(--fs-9)', marginBottom: '4px' }}>Grok</div>
                      <div style={{ color: 'var(--text-secondary)' }}>thinking...</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: 'var(--text)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--surface)',
                      flexShrink: 0
                    }}>
                      <IconSparkle />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 'var(--fs-9)', marginBottom: '6px' }}>Grok</div>
                      <div>{renderContent(msg.content)}</div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ borderTop: '2px solid var(--border)', padding: '12px 16px', background: 'var(--surface)' }}>
        <div className="card" style={{ display: 'flex', alignItems: 'flex-end', padding: '8px 12px', gap: '8px' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Grok..."
            disabled={loading}
            rows={1}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text)',
              fontSize: 'var(--fs-10)',
              fontFamily: 'var(--font-family)',
              resize: 'none',
              padding: '4px 0'
            }}
          />
          {input.trim() && (
            <button
              onClick={() => handleSubmit()}
              disabled={loading}
              className="btn-utility"
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <IconSend /> Send
            </button>
          )}
        </div>
        <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-disabled)', marginTop: '6px' }}>
          shift+enter for new line / paste X links to analyze
        </div>
      </div>
    </div>
  );
}
