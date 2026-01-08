import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { handleExpectedError, shouldLogError, getErrorKey } from '../../utils/errorCache';

interface ConfirmationQuestion {
  question_id: string;
  vehicle_id: string;
  vehicle_name: string;
  question_type: string;
  question_text: string;
  evidence_details: any;
}

interface VehicleConfirmationQuestionsProps {
  userId: string;
  onUpdate?: () => void;
}

const VehicleConfirmationQuestions: React.FC<VehicleConfirmationQuestionsProps> = ({
  userId,
  onUpdate
}) => {
  const [questions, setQuestions] = useState<ConfirmationQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [responding, setResponding] = useState<Set<string>>(new Set());
  const hasAttemptedLoad = useRef(false);

  useEffect(() => {
    // Prevent duplicate loads from React Strict Mode
    if (hasAttemptedLoad.current) return;
    hasAttemptedLoad.current = true;
    loadQuestions();
  }, [userId]);

  const loadQuestions = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .rpc('generate_vehicle_confirmation_questions', { p_user_id: userId });

      if (error) {
        // Silently handle missing RPC function (feature not implemented)
        if (handleExpectedError(error, 'Vehicle Confirmation Questions')) {
          setQuestions([]);
          return;
        }
        // Only log unexpected errors
        if (shouldLogError(getErrorKey(error, 'VehicleConfirmationQuestions'))) {
          console.error('Error loading questions:', error);
        }
        return;
      }

      setQuestions(data || []);
    } catch (error) {
      if (shouldLogError(getErrorKey(error, 'VehicleConfirmationQuestions'))) {
        console.error('Error loading questions:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResponse = async (questionId: string, response: boolean) => {
    try {
      setResponding(prev => new Set(prev).add(questionId));
      
      const { data, error } = await supabase
        .rpc('respond_to_vehicle_question', {
          p_question_id: questionId,
          p_user_id: userId,
          p_response: response
        });

      if (error) {
        console.error('Error responding to question:', error);
        alert('Failed to save response');
        return;
      }

      // Remove answered question from list
      setQuestions(prev => prev.filter(q => q.question_id !== questionId));
      
      if (onUpdate) onUpdate();
    } catch (error) {
      console.error('Error responding to question:', error);
      alert('Failed to save response');
    } finally {
      setResponding(prev => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '12px', fontSize: '8pt', color: 'var(--text-muted)' }}>
        Loading questions...
      </div>
    );
  }

  if (questions.length === 0) {
    return null; // Don't show anything if no questions
  }

  return (
    <div style={{
      marginBottom: '16px',
      border: '2px solid var(--accent)',
      borderRadius: '4px',
      background: 'var(--surface)'
    }}>
      <div style={{
        padding: '12px',
        background: 'var(--accent)',
        color: 'white',
        fontSize: '9pt',
        fontWeight: 700
      }}>
        {questions.length} Vehicle{questions.length !== 1 ? 's' : ''} Need Your Confirmation
      </div>

      <div style={{ padding: '12px' }}>
        {questions.map((question) => (
          <div
            key={question.question_id}
            style={{
              padding: '12px',
              marginBottom: '12px',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              background: '#fef3c7'
            }}
          >
            <div style={{
              fontSize: '8pt',
              fontWeight: 600,
              marginBottom: '8px',
              color: 'var(--text)'
            }}>
              {question.vehicle_name}
            </div>

            <div style={{
              fontSize: '8pt',
              color: 'var(--text-muted)',
              marginBottom: '12px'
            }}>
              {question.question_text}
            </div>

            {question.evidence_details && (
              <div style={{
                fontSize: '7pt',
                color: 'var(--text-muted)',
                marginBottom: '12px',
                padding: '6px',
                background: 'var(--surface)',
                borderRadius: '3px'
              }}>
                {question.question_type === 'org_link_move' && (
                  <>Linked to: {question.evidence_details.organization_name}</>
                )}
                {question.question_type === 'title_ownership_override' && (
                  <>Title owner: {question.evidence_details.title_owner_name}</>
                )}
                {question.question_type === 'inactive_hide' && (
                  <>Last activity: {question.evidence_details.last_activity ? new Date(question.evidence_details.last_activity).toLocaleDateString() : 'Unknown'}</>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => handleResponse(question.question_id, true)}
                disabled={responding.has(question.question_id)}
                style={{
                  padding: '6px 16px',
                  fontSize: '8pt',
                  fontWeight: 600,
                  border: '1px solid #059669',
                  background: '#059669',
                  color: 'white',
                  cursor: responding.has(question.question_id) ? 'wait' : 'pointer',
                  borderRadius: '4px',
                  opacity: responding.has(question.question_id) ? 0.5 : 1
                }}
              >
                {responding.has(question.question_id) ? 'Saving...' : 'YES'}
              </button>

              <button
                onClick={() => handleResponse(question.question_id, false)}
                disabled={responding.has(question.question_id)}
                style={{
                  padding: '6px 16px',
                  fontSize: '8pt',
                  fontWeight: 600,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text-muted)',
                  cursor: responding.has(question.question_id) ? 'wait' : 'pointer',
                  borderRadius: '4px',
                  opacity: responding.has(question.question_id) ? 0.5 : 1
                }}
              >
                {responding.has(question.question_id) ? 'Saving...' : 'NO'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VehicleConfirmationQuestions;

