/**
 * Image AI Chat Component
 * Cursor-inspired AI chat interface for asking questions about images
 * and triggering analyses. Tracks user contributions for quality assessment.
 */

import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  actions?: Array<{
    type: 'field_update' | 'analysis_triggered' | 'question_answered';
    field?: string;
    value?: any;
    confidence?: number;
  }>;
}

interface ImageAIChatProps {
  imageId: string;
  imageUrl: string;
  vehicleId?: string;
  vehicleYMM?: string;
  imageMetadata?: any;
  onFieldUpdate?: (field: string, value: any, userId: string) => void;
  onAnalysisTriggered?: (analysisType: string, userId: string) => void;
}

export const ImageAIChat: React.FC<ImageAIChatProps> = ({
  imageId,
  imageUrl,
  vehicleId,
  vehicleYMM,
  imageMetadata,
  onFieldUpdate,
  onAnalysisTriggered
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'system',
      content: 'Ask me anything about this image. I can analyze it, answer questions, or help fill in missing information.',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsProcessing(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Call image-specific AI chat edge function
      const { data, error } = await supabase.functions.invoke('image-ai-chat', {
        body: {
          image_id: imageId,
          image_url: imageUrl,
          vehicle_id: vehicleId,
          vehicle_ymm: vehicleYMM,
          question: input.trim(),
          image_metadata: imageMetadata,
          conversation_history: messages.slice(-5).map(m => ({
            role: m.role,
            content: m.content
          }))
        }
      });

      if (error) throw error;

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response || 'I processed your request.',
        timestamp: new Date(),
        actions: data.actions || []
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Handle actions (field updates, analysis triggers)
      if (data.actions) {
        for (const action of data.actions) {
          if (action.type === 'field_update' && action.field && action.value) {
            onFieldUpdate?.(action.field, action.value, user.id);
          } else if (action.type === 'analysis_triggered') {
            onAnalysisTriggered?.(action.analysis_type || 'unknown', user.id);
          }
        }
      }

      // Log user contribution
      await supabase.from('user_contributions').insert({
        user_id: user.id,
        image_id: imageId,
        vehicle_id: vehicleId,
        contribution_type: 'ai_chat_interaction',
        contribution_data: {
          question: input.trim(),
          response: data.response,
          actions: data.actions,
          confidence: data.confidence || 0
        },
        created_at: new Date().toISOString()
      });

    } catch (error: any) {
      const errorMessage: Message = {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        content: `Error: ${error.message || 'Failed to process request'}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsProcessing(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      border: '2px solid rgba(255,255,255,0.1)',
      backgroundColor: 'rgba(0,0,0,0.3)',
      fontFamily: 'Arial, sans-serif'
    }}>
      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px',
        fontSize: '7pt',
        lineHeight: '1.4'
      }}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              marginBottom: '8px',
              padding: '4px 6px',
              backgroundColor: msg.role === 'user' 
                ? 'rgba(255,255,255,0.1)' 
                : msg.role === 'system'
                ? 'rgba(255,255,0,0.1)'
                : 'rgba(0,0,0,0.2)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '0px'
            }}
          >
            <div style={{
              fontSize: '6pt',
              color: 'rgba(255,255,255,0.5)',
              marginBottom: '2px',
              textTransform: 'uppercase'
            }}>
              {msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : 'AI'}
            </div>
            <div style={{ color: '#fff', wordBreak: 'break-word' }}>
              {msg.content}
            </div>
            {msg.actions && msg.actions.length > 0 && (
              <div style={{ marginTop: '4px', fontSize: '6pt', color: 'rgba(0,255,0,0.7)' }}>
                {msg.actions.map((action, idx) => (
                  <div key={idx}>
                    {action.type === 'field_update' && `✓ Updated ${action.field}`}
                    {action.type === 'analysis_triggered' && `✓ Triggered analysis`}
                    {action.type === 'question_answered' && `✓ Answered question`}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {isProcessing && (
          <div style={{
            padding: '4px 6px',
            fontSize: '6pt',
            color: 'rgba(255,255,255,0.5)',
            fontStyle: 'italic'
          }}>
            Thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} style={{
        borderTop: '2px solid rgba(255,255,255,0.1)',
        padding: '6px',
        display: 'flex',
        gap: '4px'
      }}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this image..."
          disabled={isProcessing}
          style={{
            flex: 1,
            padding: '4px 6px',
            fontSize: '7pt',
            backgroundColor: 'rgba(0,0,0,0.5)',
            border: '2px inset rgba(255,255,255,0.2)',
            color: '#fff',
            fontFamily: 'Arial, sans-serif'
          }}
        />
        <button
          type="submit"
          disabled={!input.trim() || isProcessing}
          style={{
            padding: '4px 8px',
            fontSize: '7pt',
            fontWeight: 'bold',
            backgroundColor: input.trim() && !isProcessing 
              ? 'rgba(255,255,255,0.2)' 
              : 'rgba(255,255,255,0.05)',
            border: '2px outset rgba(255,255,255,0.3)',
            color: '#fff',
            cursor: input.trim() && !isProcessing ? 'pointer' : 'not-allowed',
            fontFamily: 'Arial, sans-serif',
            textTransform: 'uppercase'
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
};

