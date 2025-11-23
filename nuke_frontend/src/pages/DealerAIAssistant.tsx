import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  attachments?: Array<{ name: string; url: string; type: string }>;
  actions?: Array<{
    type: 'create_vehicle' | 'update_vehicle' | 'add_images' | 'parse_receipt';
    data: any;
    status: 'pending' | 'completed' | 'failed';
  }>;
}

const DealerAIAssistant: React.FC = () => {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [organization, setOrganization] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    if (orgId && session) {
      loadOrganization();
      loadConversationHistory();
    }
  }, [orgId, session]);

  const loadSession = async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    setSession(s);
  };

  const loadOrganization = async () => {
    const { data } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', orgId)
      .single();
    setOrganization(data);
  };

  const loadConversationHistory = async () => {
    // Load previous conversation from localStorage for now
    const stored = localStorage.getItem(`dealer_ai_${orgId}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      setMessages(parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })));
    } else {
      // Welcome message
      setMessages([{
        id: '1',
        role: 'assistant',
        content: `Hey! I'm your AI assistant for ${organization?.business_name || 'your dealership'}. 

You can:
• Paste inventory lists (VINs, prices, descriptions)
• Drop photos of cars (I'll extract details)
• Forward emails from customers/vendors
• Upload receipts and invoices
• Just chat naturally about what you need

I'll organize everything into your inventory, link images to the right vehicles, and extract pricing/VIN data automatically.

What do you want to do first?`,
        timestamp: new Date()
      }]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles([...selectedFiles, ...files]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && selectedFiles.length === 0) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
      attachments: selectedFiles.map(f => ({
        name: f.name,
        url: URL.createObjectURL(f),
        type: f.type
      }))
    };

    setMessages([...messages, userMessage]);
    setInput('');
    setProcessing(true);

    try {
      // Upload files to Supabase storage
      const uploadedFiles = await Promise.all(
        selectedFiles.map(async (file) => {
          const fileName = `${Date.now()}_${file.name}`;
          const { data, error } = await supabase.storage
            .from('dealer-ai-uploads')
            .upload(`${orgId}/${fileName}`, file);
          
          if (error) throw error;
          
          const { data: { publicUrl } } = supabase.storage
            .from('dealer-ai-uploads')
            .getPublicUrl(data.path);
          
          return {
            name: file.name,
            url: publicUrl,
            type: file.type
          };
        })
      );

      // Call AI assistant Edge Function
      const { data, error } = await supabase.functions.invoke('dealer-ai-assistant', {
        body: {
          organizationId: orgId,
          message: input,
          attachments: uploadedFiles,
          conversationHistory: messages.slice(-10).map(m => ({
            role: m.role,
            content: m.content
          }))
        }
      });

      if (error) throw error;

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
        actions: data.actions || []
      };

      const updatedMessages = [...messages, userMessage, assistantMessage];
      setMessages(updatedMessages);
      
      // Save to localStorage
      localStorage.setItem(`dealer_ai_${orgId}`, JSON.stringify(updatedMessages));
      
      setSelectedFiles([]);
    } catch (error: any) {
      console.error('AI Assistant error:', error);
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}. Let me try a simpler approach - can you break down what you need into smaller pieces?`,
        timestamp: new Date()
      };
      
      setMessages([...messages, userMessage, errorMessage]);
    } finally {
      setProcessing(false);
    }
  };

  const clearConversation = () => {
    if (confirm('Clear entire conversation?')) {
      localStorage.removeItem(`dealer_ai_${orgId}`);
      loadConversationHistory();
    }
  };

  if (!session) {
    return <div style={{ padding: '20px' }}>Please log in</div>;
  }

  return (
    <div style={{ 
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: 'var(--surface)'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'white',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <h1 style={{ fontSize: '14pt', fontWeight: 700, margin: 0 }}>
            AI Assistant
          </h1>
          <p style={{ fontSize: '8pt', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
            {organization?.business_name || 'Loading...'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => navigate(`/dealer/${orgId}/bulk-editor`)}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              border: '1px solid var(--border)',
              background: 'white',
              cursor: 'pointer'
            }}
          >
            Bulk Editor
          </button>
          <button
            onClick={clearConversation}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              border: '1px solid var(--border)',
              background: 'white',
              cursor: 'pointer'
            }}
          >
            Clear Chat
          </button>
          <button
            onClick={() => navigate(`/org/${orgId}`)}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              border: '1px solid var(--border)',
              background: 'white',
              cursor: 'pointer'
            }}
          >
            Back to Profile
          </button>
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }}>
        {messages.map((message) => (
          <div
            key={message.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '70%'
            }}
          >
            <div
              style={{
                padding: '12px',
                borderRadius: '8px',
                background: message.role === 'user' 
                  ? 'var(--accent)' 
                  : 'white',
                color: message.role === 'user' ? 'white' : 'black',
                border: message.role === 'assistant' ? '1px solid var(--border)' : 'none',
                fontSize: '9pt',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {message.content}
              
              {/* Attachments */}
              {message.attachments && message.attachments.length > 0 && (
                <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {message.attachments.map((att, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '4px 8px',
                        background: message.role === 'user' ? 'rgba(255,255,255,0.2)' : 'var(--grey-50)',
                        borderRadius: '4px',
                        fontSize: '7pt'
                      }}
                    >
                      {att.name}
                    </div>
                  ))}
                </div>
              )}
              
              {/* Actions */}
              {message.actions && message.actions.length > 0 && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px', opacity: 0.7 }}>
                    Actions Taken:
                  </div>
                  {message.actions.map((action, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '6px 8px',
                        background: 'var(--grey-50)',
                        borderRadius: '4px',
                        fontSize: '8pt',
                        marginBottom: '4px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <span>
                        {action.type === 'create_vehicle' && '+ Created vehicle'}
                        {action.type === 'update_vehicle' && '✓ Updated vehicle'}
                        {action.type === 'add_images' && 'Added images'}
                        {action.type === 'parse_receipt' && '🧾 Parsed receipt'}
                      </span>
                      <span style={{
                        fontSize: '7pt',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        background: action.status === 'completed' ? 'var(--success)' : 
                                   action.status === 'failed' ? 'var(--danger)' : 'var(--warning)',
                        color: 'white'
                      }}>
                        {action.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{
              fontSize: '7pt',
              color: 'var(--text-muted)',
              marginTop: '4px',
              alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start'
            }}>
              {message.timestamp.toLocaleTimeString()}
            </div>
          </div>
        ))}
        
        {processing && (
          <div style={{
            alignSelf: 'flex-start',
            padding: '12px',
            borderRadius: '8px',
            background: 'white',
            border: '1px solid var(--border)',
            fontSize: '9pt',
            color: 'var(--text-muted)'
          }}>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <span>Processing</span>
              <span className="loading-dots">...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div style={{
        padding: '16px 20px',
        borderTop: '1px solid var(--border)',
        background: 'white'
      }}>
        {/* Selected Files */}
        {selectedFiles.length > 0 && (
          <div style={{
            marginBottom: '12px',
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap'
          }}>
            {selectedFiles.map((file, idx) => (
              <div
                key={idx}
                style={{
                  padding: '6px 12px',
                  background: 'var(--grey-50)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  fontSize: '8pt',
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center'
                }}
              >
                <span>{file.name}</span>
                <button
                  onClick={() => {
                    const updated = [...selectedFiles];
                    updated.splice(idx, 1);
                    setSelectedFiles(updated);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '10pt',
                    color: 'var(--danger)',
                    padding: 0
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '12px' }}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
            accept="image/*,.pdf,.csv,.xlsx,.txt"
          />
          
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '10px',
              border: '1px solid var(--border)',
              background: 'white',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14pt'
            }}
            title="Attach files"
          >
            📎
          </button>
          
          <textarea
            ref={textAreaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Paste inventory lists, VINs, emails, photos... anything!"
            style={{
              flex: 1,
              padding: '10px',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              fontSize: '9pt',
              resize: 'none',
              minHeight: '60px',
              fontFamily: 'inherit'
            }}
            disabled={processing}
          />
          
          <button
            type="submit"
            disabled={processing || (!input.trim() && selectedFiles.length === 0)}
            style={{
              padding: '10px 20px',
              background: 'var(--accent)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: processing ? 'wait' : 'pointer',
              fontSize: '9pt',
              fontWeight: 600,
              opacity: processing || (!input.trim() && selectedFiles.length === 0) ? 0.5 : 1
            }}
          >
            {processing ? 'Processing...' : 'Send'}
          </button>
        </form>
        
        <div style={{
          marginTop: '8px',
          fontSize: '7pt',
          color: 'var(--text-muted)',
          display: 'flex',
          gap: '16px'
        }}>
          <span>💡 Press Enter to send, Shift+Enter for new line</span>
          <span>📎 Supports images, PDFs, CSV, Excel, text</span>
        </div>
      </div>
    </div>
  );
};

export default DealerAIAssistant;

