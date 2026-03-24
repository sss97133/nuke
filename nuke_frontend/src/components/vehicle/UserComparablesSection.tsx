import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

interface UserComparablesSectionProps {
  vehicleId: string;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
}

interface Comparable {
  id: string;
  url: string;
  price: number;
  source: string;
  title: string;
  notes: string;
  validation_score: number;
  community_votes: {
    helpful: number;
    unhelpful: number;
    bullshit: number;
  };
  submitted_at: string;
}

export function UserComparablesSection({ vehicleId, vehicleYear, vehicleMake, vehicleModel }: UserComparablesSectionProps) {
  const { user } = useAuth();
  const [comparables, setComparables] = useState<Comparable[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [submitUrl, setSubmitUrl] = useState('');
  const [submitNotes, setSubmitNotes] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadComparables();
  }, [vehicleId]);

  const loadComparables = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('vehicle_comparables_summary')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading comparables:', error);
        return;
      }

      setComparables(data?.comparables || []);
    } catch (error) {
      console.error('Error in loadComparables:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitComparable = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      setMessage('Please log in to submit comparables');
      return;
    }

    if (!submitUrl.trim()) {
      setMessage('Please enter a valid URL');
      return;
    }

    // Basic URL validation
    try {
      new URL(submitUrl);
    } catch {
      setMessage('Please enter a valid URL (must start with http:// or https://)');
      return;
    }

    setSubmitting(true);
    setMessage('');

    try {
      // Call the database function to submit comparable
      const { data, error } = await supabase.rpc('submit_comparable', {
        p_vehicle_id: vehicleId,
        p_comparable_url: submitUrl.trim(),
        p_notes: submitNotes.trim() || null
      });

      if (error) {
        throw error;
      }

      if (data?.success) {
        setMessage('Comparable submitted successfully! It will be validated and appear if approved.');
        setSubmitUrl('');
        setSubmitNotes('');
        setShowSubmitForm(false);
        
        // Reload comparables after a short delay
        setTimeout(loadComparables, 2000);
      } else {
        setMessage(data?.error || 'Failed to submit comparable');
      }
    } catch (error: any) {
      console.error('Error submitting comparable:', error);
      setMessage(error.message || 'Failed to submit comparable');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVote = async (comparableId: string, voteType: 'helpful' | 'unhelpful' | 'bullshit') => {
    if (!user) {
      setMessage('Please log in to vote');
      return;
    }

    try {
      const { data, error } = await supabase.rpc('vote_on_comparable', {
        p_comparable_id: comparableId,
        p_vote_type: voteType
      });

      if (error) throw error;

      if (data?.success) {
        // Reload comparables to show updated votes
        loadComparables();
      }
    } catch (error: any) {
      console.error('Error voting:', error);
      setMessage(error.message || 'Failed to vote');
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price);
  };

  const getValidationColor = (score: number) => {
    if (score >= 80) return 'var(--success)'; // Green
    if (score >= 60) return 'var(--warning)'; // Yellow
    return 'var(--error)'; // Red
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: '20px' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
          Loading comparables...
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: '20px' }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 4px 0' }}>
            User-Submitted Comparables
          </h3>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0 }}>
            Community-sourced comparable vehicles with bullshit detection
          </p>
        </div>
        
        {user && (
          <button
            onClick={() => setShowSubmitForm(!showSubmitForm)}
            className="button button-primary"
            style={{ fontSize: '14px' }}
          >
            {showSubmitForm ? 'Cancel' : 'Add Comparable'}
          </button>
        )}
      </div>

      {/* Submit Form */}
      {showSubmitForm && (
        <div style={{ 
          border: '1px solid var(--border)', padding: '16px',
          marginBottom: '20px',
          backgroundColor: 'var(--bg)'
        }}>
          <h4 style={{ fontSize: '16px', fontWeight: '600', margin: '0 0 12px 0' }}>
            Submit a Comparable Vehicle
          </h4>
          
          <div style={{ 
            backgroundColor: 'var(--warning-dim)',
            border: '1px solid var(--warning)', padding: '12px',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--warning)', marginBottom: '4px' }}>
              ⚠️ Bullshit Detection Active
            </div>
            <div style={{ fontSize: '13px', color: 'var(--warning)' }}>
              Icon builds, custom shop builds, and obvious outliers will be automatically flagged.
              Submit realistic comparables for {vehicleYear} {vehicleMake} {vehicleModel} or similar body styles.
            </div>
          </div>

          <form onSubmit={handleSubmitComparable}>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ 
                fontSize: '14px', 
                fontWeight: '500', 
                display: 'block', 
                marginBottom: '4px' 
              }}>
                Comparable URL *
              </label>
              <input
                type="url"
                value={submitUrl}
                onChange={(e) => setSubmitUrl(e.target.value)}
                placeholder="https://bringatrailer.com/listing/..."
                className="form-input"
                style={{ width: '100%' }}
                required
              />
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Supported: BAT, Hemmings, Classic.com, Cars.com, AutoTrader, Craigslist
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ 
                fontSize: '14px', 
                fontWeight: '500', 
                display: 'block', 
                marginBottom: '4px' 
              }}>
                Notes (Optional)
              </label>
              <textarea
                value={submitNotes}
                onChange={(e) => setSubmitNotes(e.target.value)}
                placeholder="Why is this a good comparable? Condition, mods, etc..."
                className="form-input"
                style={{ width: '100%', minHeight: '60px' }}
                rows={3}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="submit"
                disabled={submitting}
                className="button button-primary"
                style={{ fontSize: '14px' }}
              >
                {submitting ? 'Validating...' : 'Submit Comparable'}
              </button>
              
              <button
                type="button"
                onClick={() => setShowSubmitForm(false)}
                className="button button-secondary"
                style={{ fontSize: '14px' }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Message */}
      {message && (
        <div style={{
          padding: '12px', marginBottom: '16px',
          backgroundColor: message.includes('success') ? 'var(--success-dim)' : 'var(--error-dim)',
          border: `1px solid ${message.includes('success') ? 'var(--success)' : 'var(--error)'}`,
          color: message.includes('success') ? 'var(--success)' : 'var(--error)',
          fontSize: '14px'
        }}>
          {message}
        </div>
      )}

      {/* Comparables List */}
      {comparables.length === 0 ? (
        <div style={{ 
          textAlign: 'center', 
          color: 'var(--text-secondary)',
          padding: '40px 0'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔍</div>
          <p style={{ fontSize: '16px', fontWeight: '500', margin: '0 0 4px 0' }}>
            No comparables yet
          </p>
          <p style={{ fontSize: '14px', margin: 0 }}>
            Be the first to submit a comparable vehicle for this {vehicleYear} {vehicleMake} {vehicleModel}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {comparables.map((comparable) => (
            <div
              key={comparable.id}
              style={{
                border: '1px solid var(--border)', padding: '16px'
              }}
            >
              {/* Comparable Header */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '12px'
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ 
                    fontSize: '16px', 
                    fontWeight: '600',
                    marginBottom: '4px'
                  }}>
                    {comparable.title || 'Vehicle Listing'}
                  </div>
                  
                  <div style={{ 
                    fontSize: '14px', 
                    color: 'var(--text-secondary)',
                    marginBottom: '4px'
                  }}>
                    {comparable.source} • {formatPrice(comparable.price)}
                  </div>
                  
                  <a
                    href={comparable.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: '12px',
                      color: 'var(--accent)',
                      textDecoration: 'none'
                    }}
                  >
                    View Original Listing →
                  </a>
                </div>

                {/* Validation Score */}
                <div style={{ 
                  textAlign: 'center',
                  minWidth: '80px'
                }}>
                  <div style={{
                    fontSize: '18px',
                    fontWeight: 'bold',
                    color: getValidationColor(comparable.validation_score)
                  }}>
                    {comparable.validation_score}%
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Validation
                  </div>
                </div>
              </div>

              {/* Notes */}
              {comparable.notes && (
                <div style={{
                  fontSize: '14px',
                  color: 'var(--text)',
                  marginBottom: '12px',
                  padding: '8px',
                  backgroundColor: 'var(--bg)'
                }}>
                  "{comparable.notes}"
                </div>
              )}

              {/* Community Voting */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div style={{ 
                  display: 'flex', 
                  gap: '12px',
                  alignItems: 'center'
                }}>
                  <button
                    onClick={() => handleVote(comparable.id, 'helpful')}
                    className="button button-small"
                    style={{ 
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    disabled={!user}
                  >
                    👍 {comparable.community_votes.helpful}
                  </button>
                  
                  <button
                    onClick={() => handleVote(comparable.id, 'unhelpful')}
                    className="button button-small"
                    style={{ 
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    disabled={!user}
                  >
                    👎 {comparable.community_votes.unhelpful}
                  </button>
                  
                  <button
                    onClick={() => handleVote(comparable.id, 'bullshit')}
                    className="button button-small"
                    style={{ 
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      backgroundColor: 'var(--error-dim)',
                      color: 'var(--error)'
                    }}
                    disabled={!user}
                  >
                    🚩 {comparable.community_votes.bullshit}
                  </button>
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {new Date(comparable.submitted_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Login Prompt */}
      {!user && (
        <div style={{
          textAlign: 'center',
          padding: '20px',
          backgroundColor: 'var(--bg)', marginTop: '16px'
        }}>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0 }}>
            <a href="/login" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
              Log in
            </a> to submit comparables and vote on submissions
          </p>
        </div>
      )}
    </div>
  );
}