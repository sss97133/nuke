import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * URL Drop Box (Robinhood × Cursor style)
 * Paste any URL → AI extracts data → Get credit + points
 */

interface Props {
  session: any;
  onSuccess?: (result: any) => void;
}

export default function URLDropBox({ session, onSuccess }: Props) {
  const [url, setUrl] = useState('');
  const [opinion, setOpinion] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDrop = async () => {
    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    if (!session?.user) {
      setError('Please sign in to drop URLs');
      return;
    }

    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      // Call Edge Function to process URL
      const { data, error: functionError } = await supabase.functions.invoke('process-url-drop', {
        body: {
          url: url.trim(),
          userId: session.user.id,
          opinion: opinion.trim() || null,
          rating: rating
        }
      });

      if (functionError) throw functionError;

      setResult(data);
      setUrl('');
      setOpinion('');
      setRating(null);

      // Call success callback
      onSuccess?.(data);

      // Show success for 5 seconds
      setTimeout(() => setResult(null), 5000);

    } catch (err: any) {
      console.error('URL drop error:', err);
      setError(err.message || 'Failed to process URL');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="rh-card" style={{ margin: '16px' }}>
      <div className="rh-card-content">
        {/* Header */}
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ 
            fontSize: '15px', 
            fontWeight: 600, 
            color: 'var(--rh-text-primary)', 
            marginBottom: '4px' 
          }}>
            Drop a URL
          </h3>
          <p style={{ 
            fontSize: '13px', 
            color: 'var(--rh-text-secondary)', 
            margin: 0 
          }}>
            Paste any vehicle or organization link. We'll extract the data, you get credit + points.
          </p>
        </div>

        {/* URL Input */}
        <input
          type="text"
          placeholder="https://bringatrailer.com/listing/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleDrop()}
          disabled={processing}
          style={{
            width: '100%',
            padding: '12px',
            fontSize: '15px',
            fontFamily: 'var(--rh-font-mono)',
            background: 'var(--rh-surface-elevated)',
            border: '1px solid var(--rh-border)',
            borderRadius: '8px',
            color: 'var(--rh-text-primary)',
            marginBottom: '12px',
            transition: 'border-color 0.15s ease'
          }}
          onFocus={(e) => e.target.style.borderColor = 'var(--rh-accent)'}
          onBlur={(e) => e.target.style.borderColor = 'var(--rh-border)'}
        />

        {/* Opinion (Optional) */}
        <textarea
          placeholder="Your opinion (optional)"
          value={opinion}
          onChange={(e) => setOpinion(e.target.value)}
          disabled={processing}
          rows={3}
          style={{
            width: '100%',
            padding: '12px',
            fontSize: '14px',
            background: 'var(--rh-surface-elevated)',
            border: '1px solid var(--rh-border)',
            borderRadius: '8px',
            color: 'var(--rh-text-primary)',
            marginBottom: '12px',
            resize: 'vertical',
            fontFamily: 'inherit'
          }}
        />

        {/* Rating (Optional) */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ 
            fontSize: '13px', 
            color: 'var(--rh-text-secondary)', 
            marginBottom: '8px' 
          }}>
            Rating (optional)
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setRating(star)}
                disabled={processing}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  padding: 0,
                  color: rating && star <= rating ? '#ffc107' : 'var(--rh-border)',
                  transition: 'color 0.15s ease'
                }}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        {/* Submit Button */}
        <button
          onClick={handleDrop}
          disabled={processing || !url.trim()}
          className="rh-btn-primary"
          style={{
            width: '100%',
            opacity: processing || !url.trim() ? 0.5 : 1,
            cursor: processing || !url.trim() ? 'not-allowed' : 'pointer'
          }}
        >
          {processing ? 'Processing...' : 'Drop URL'}
        </button>

        {/* Success Message */}
        {result && (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            background: 'rgba(0, 200, 5, 0.1)',
            border: '1px solid var(--rh-green)',
            borderRadius: '8px'
          }}>
            <div style={{ 
              fontSize: '14px', 
              color: 'var(--rh-green)', 
              fontWeight: 600,
              marginBottom: '4px'
            }}>
              {result.message}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--rh-text-secondary)' }}>
              {result.isOriginalDiscoverer ? (
                <>🎉 You're the first contributor! You discovered this {result.entityType}.</>
              ) : (
                <>👏 You're contributor #{result.contributorRank}. Every contribution helps!</>
              )}
            </div>
            <a
              href={`/${result.entityType}/${result.entityId}`}
              style={{
                display: 'inline-block',
                marginTop: '8px',
                fontSize: '13px',
                color: 'var(--rh-accent)',
                textDecoration: 'none'
              }}
            >
              View {result.entityType} →
            </a>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            background: 'rgba(255, 80, 80, 0.1)',
            border: '1px solid var(--rh-red)',
            borderRadius: '8px',
            fontSize: '14px',
            color: 'var(--rh-red)'
          }}>
            {error}
          </div>
        )}

        {/* Info Footer */}
        <div style={{
          marginTop: '16px',
          paddingTop: '16px',
          borderTop: '1px solid var(--rh-border)',
          fontSize: '12px',
          color: 'var(--rh-text-tertiary)'
        }}>
          <div style={{ marginBottom: '4px' }}>
            <strong style={{ color: 'var(--rh-text-secondary)' }}>Supported URLs:</strong>
          </div>
          <div>• Bring a Trailer listings</div>
          <div>• n-zero.dev profiles (vehicle/org)</div>
          <div>• Instagram posts (coming soon)</div>
          <div>• Any vehicle website (AI extraction)</div>
        </div>
      </div>
    </div>
  );
}

