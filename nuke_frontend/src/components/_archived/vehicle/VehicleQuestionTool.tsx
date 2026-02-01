/**
 * Vehicle Question Tool
 * AI assistant with data moat guardrails - ONLY answers within vehicle's bounded context
 */

import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface VehicleQuestionToolProps {
  vehicleId: string;
  vehicle: any;
}

export const VehicleQuestionTool: React.FC<VehicleQuestionToolProps> = ({ vehicleId, vehicle }) => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<any>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askQuestion = async () => {
    if (!question.trim()) return;

    setAsking(true);
    setError(null);

    try {
      const { data, error: funcError } = await supabase.functions.invoke('ask-vehicle-question', {
        body: {
          vehicle_id: vehicleId,
          vehicle: {
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
            vin: vehicle.vin
          },
          question: question.trim()
        }
      });

      if (funcError) throw funcError;

      setAnswer(data);
    } catch (err) {
      console.error('Question failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to get answer');
    } finally {
      setAsking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      askQuestion();
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Ask about this vehicle</span>
        <span style={styles.subtitle}>
          Answers bounded to: manuals, receipts, timeline, compatible parts, technicians
        </span>
      </div>

      <div style={styles.inputContainer}>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What oil filter fits?"
          disabled={asking}
          style={styles.input}
        />
        <button
          onClick={askQuestion}
          disabled={asking || !question.trim()}
          style={styles.button}
        >
          {asking ? 'WAIT' : 'AI'}
        </button>
      </div>

      {error && (
        <div style={styles.error}>{error}</div>
      )}

      {answer && (
        <div style={styles.answer}>
          <div style={styles.answerText}>{answer.response}</div>
          
          {answer.sources && answer.sources.length > 0 && (
            <div style={styles.sources}>
              <div style={styles.sourcesTitle}>Sources:</div>
              {answer.sources.map((source: any, idx: number) => (
                <div key={idx} style={styles.source}>
                  {getSourceIcon(source.type)} {source.ref}
                </div>
              ))}
            </div>
          )}

          {answer.moat_used && (
            <div style={styles.moatInfo}>
              Searched: {answer.moat_used.manuals} manuals, {answer.moat_used.receipts} receipts, 
              {answer.moat_used.timeline_events} events, {answer.moat_used.parts} parts, 
              {answer.moat_used.technicians} technicians
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const getSourceIcon = (type: string) => {
  switch (type) {
    case 'manual': return '📄';
    case 'receipt': return '🧾';
    case 'timeline': return '📅';
    case 'part': return '🔧';
    case 'technician': return '👨‍🔧';
    case 'market': return '📊';
    default: return '📖';
  }
};

const styles = {
  container: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '12px',
    marginBottom: '16px'
  },
  header: {
    marginBottom: '8px'
  },
  title: {
    fontSize: '11px',
    fontWeight: 'bold' as const,
    color: 'var(--text)',
    display: 'block'
  },
  subtitle: {
    fontSize: '8px',
    color: 'var(--text-secondary)',
    display: 'block',
    marginTop: '2px'
  },
  inputContainer: {
    display: 'flex',
    gap: '8px'
  },
  input: {
    flex: 1,
    height: '32px',
    padding: '0 10px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '3px',
    fontSize: '11px',
    color: 'var(--text)',
    fontFamily: 'inherit'
  },
  button: {
    width: '32px',
    height: '32px',
    background: 'var(--accent)',
    border: '1px solid var(--border)',
    borderRadius: '3px',
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  error: {
    marginTop: '8px',
    padding: '6px',
    background: 'rgba(244, 135, 113, 0.1)',
    border: '1px solid var(--error)',
    borderRadius: '3px',
    fontSize: '10px',
    color: 'var(--error)'
  },
  answer: {
    marginTop: '12px',
    padding: '10px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '3px'
  },
  answerText: {
    fontSize: '10px',
    color: 'var(--text)',
    lineHeight: 1.4,
    marginBottom: '8px'
  },
  sources: {
    marginTop: '8px',
    paddingTop: '8px',
    borderTop: '1px solid var(--border)'
  },
  sourcesTitle: {
    fontSize: '8px',
    fontWeight: 'bold' as const,
    color: 'var(--text-secondary)',
    marginBottom: '4px'
  },
  source: {
    fontSize: '8px',
    color: 'var(--text-secondary)',
    padding: '3px 0'
  },
  moatInfo: {
    fontSize: '6px',
    color: 'var(--text-disabled)',
    marginTop: '6px',
    paddingTop: '6px',
    borderTop: '1px solid var(--border)'
  }
};

