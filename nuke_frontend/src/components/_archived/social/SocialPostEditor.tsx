import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface PostDraft {
  text: string;
  images: string[];
  platforms: string[];
  scheduledFor?: Date;
  vehicleId?: string;
}

interface CurationResult {
  curated_text: string;
  thread?: string[];
  selected_image?: string;
  hook_score: number;
  format_score: number;
  hashtags: string[];
  cta?: string;
  reasoning: string;
  estimated_engagement: 'low' | 'medium' | 'high' | 'viral';
}

interface Props {
  userId: string;
  vehicleId?: string;
  initialContent?: string;
  initialImages?: string[];
  onPost?: (result: any) => void;
  onClose?: () => void;
}

const PLATFORMS = [
  { id: 'x', name: 'X', icon: '𝕏', maxLength: 280, connected: true },
  { id: 'instagram', name: 'Instagram', icon: '📸', maxLength: 2200, connected: false },
  { id: 'threads', name: 'Threads', icon: '🧵', maxLength: 500, connected: false },
  { id: 'linkedin', name: 'LinkedIn', icon: '💼', maxLength: 3000, connected: false },
];

const OPTIMAL_TIMES = [
  { label: 'Morning Rush', time: '08:00', engagement: 'high' },
  { label: 'Lunch Break', time: '12:00', engagement: 'high' },
  { label: 'After Work', time: '17:00', engagement: 'very high' },
  { label: 'Evening Wind Down', time: '20:00', engagement: 'medium' },
];

export default function SocialPostEditor({
  userId,
  vehicleId,
  initialContent = '',
  initialImages = [],
  onPost,
  onClose
}: Props) {
  const [draft, setDraft] = useState<PostDraft>({
    text: initialContent,
    images: initialImages,
    platforms: ['x'],
    vehicleId
  });

  const [curation, setCuration] = useState<CurationResult | null>(null);
  const [isCurating, setIsCurating] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<any>(null);
  const [availableImages, setAvailableImages] = useState<string[]>([]);

  // Load vehicle data if vehicleId provided
  useEffect(() => {
    if (vehicleId) {
      loadVehicleData();
    }
  }, [vehicleId]);

  const loadVehicleData = async () => {
    const { data: vehicleData } = await supabase
      .from('vehicles')
      .select('id, year, make, model, primary_image_url, description')
      .eq('id', vehicleId)
      .single();

    if (vehicleData) {
      setVehicle(vehicleData);
    }

    // Load vehicle images
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('image_url, category, is_primary')
      .eq('vehicle_id', vehicleId)
      .eq('is_approved', true)
      .order('is_primary', { ascending: false })
      .limit(20);

    if (images) {
      setAvailableImages(images.map(i => i.image_url));
    }
  };

  const handleCurate = async () => {
    if (!draft.text.trim()) {
      setError('Enter some content to curate');
      return;
    }

    setIsCurating(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/curate-for-x`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            content: draft.text,
            content_type: vehicle ? 'build_update' : 'general',
            context: {
              vehicle: vehicle ? {
                year: vehicle.year,
                make: vehicle.make,
                model: vehicle.model
              } : undefined,
              images: draft.images.length > 0 ? draft.images : availableImages.slice(0, 5),
              tone: 'enthusiast',
              audience: 'car_community'
            },
            include_hashtags: true,
            include_cta: true
          })
        }
      );

      const result = await response.json();

      if (result.error) {
        throw new Error(result.error);
      }

      setCuration(result);

    } catch (err: any) {
      setError(err.message || 'Curation failed');
    } finally {
      setIsCurating(false);
    }
  };

  const applyCuration = () => {
    if (curation) {
      setDraft(prev => ({
        ...prev,
        text: curation.curated_text,
        images: curation.selected_image
          ? [curation.selected_image, ...prev.images.filter(i => i !== curation.selected_image)]
          : prev.images
      }));
    }
  };

  const handlePost = async () => {
    if (!draft.text.trim()) {
      setError('Enter some content to post');
      return;
    }

    setIsPosting(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/x-post`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: userId,
            text: draft.text,
            image_urls: draft.images.slice(0, 4) // X allows max 4 images
          })
        }
      );

      const result = await response.json();

      if (result.error) {
        throw new Error(result.error);
      }

      setSuccess(`Posted! ${result.url}`);
      onPost?.(result);

    } catch (err: any) {
      setError(err.message || 'Post failed');
    } finally {
      setIsPosting(false);
    }
  };

  const getCharacterCount = () => {
    const platform = PLATFORMS.find(p => draft.platforms.includes(p.id));
    const max = platform?.maxLength || 280;
    const current = draft.text.length;
    return { current, max, remaining: max - current };
  };

  const charCount = getCharacterCount();

  const getEngagementColor = (level: string) => {
    switch (level) {
      case 'viral': return '#22c55e';
      case 'high': return '#84cc16';
      case 'medium': return '#eab308';
      case 'low': return '#ef4444';
      default: return '#6b7280';
    }
  };

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: '8px',
      border: '1px solid var(--border)',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface-hover)'
      }}>
        <h3 style={{ margin: 0, fontSize: '10pt', fontWeight: 600 }}>
          Create Post
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14pt',
              color: 'var(--text-muted)'
            }}
          >
            ×
          </button>
        )}
      </div>

      <div style={{ padding: '16px' }}>
        {/* Platform Selection */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '8pt', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
            Post to:
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {PLATFORMS.map(platform => (
              <button
                key={platform.id}
                onClick={() => {
                  if (platform.connected) {
                    setDraft(prev => ({
                      ...prev,
                      platforms: prev.platforms.includes(platform.id)
                        ? prev.platforms.filter(p => p !== platform.id)
                        : [...prev.platforms, platform.id]
                    }));
                  }
                }}
                disabled={!platform.connected}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '6px 12px',
                  borderRadius: '20px',
                  border: draft.platforms.includes(platform.id)
                    ? '2px solid var(--primary)'
                    : '1px solid var(--border)',
                  background: draft.platforms.includes(platform.id)
                    ? 'var(--primary-light)'
                    : 'var(--surface)',
                  cursor: platform.connected ? 'pointer' : 'not-allowed',
                  opacity: platform.connected ? 1 : 0.5,
                  fontSize: '8pt'
                }}
              >
                <span>{platform.icon}</span>
                <span>{platform.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content Editor */}
        <div style={{ marginBottom: '12px' }}>
          <textarea
            value={draft.text}
            onChange={(e) => setDraft(prev => ({ ...prev, text: e.target.value }))}
            placeholder="What's happening? Share your build progress, insights, or thoughts..."
            style={{
              width: '100%',
              minHeight: '120px',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontSize: '10pt',
              lineHeight: '1.5',
              resize: 'vertical',
              fontFamily: 'inherit'
            }}
          />
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '4px',
            fontSize: '7pt',
            color: charCount.remaining < 0 ? '#ef4444' : 'var(--text-muted)'
          }}>
            <span>
              {charCount.current} / {charCount.max}
              {charCount.remaining < 0 && ` (${Math.abs(charCount.remaining)} over)`}
            </span>
            <span>{charCount.remaining} remaining</span>
          </div>
        </div>

        {/* Image Selection */}
        {(draft.images.length > 0 || availableImages.length > 0) && (
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '8pt', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
              Images ({draft.images.length}/4 selected):
            </label>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))',
              gap: '8px'
            }}>
              {[...draft.images, ...availableImages.filter(i => !draft.images.includes(i))].slice(0, 12).map((url, idx) => (
                <div
                  key={url}
                  onClick={() => {
                    if (draft.images.includes(url)) {
                      setDraft(prev => ({ ...prev, images: prev.images.filter(i => i !== url) }));
                    } else if (draft.images.length < 4) {
                      setDraft(prev => ({ ...prev, images: [...prev.images, url] }));
                    }
                  }}
                  style={{
                    position: 'relative',
                    aspectRatio: '1',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    border: draft.images.includes(url) ? '2px solid var(--primary)' : '1px solid var(--border)'
                  }}
                >
                  <img
                    src={url}
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                  />
                  {draft.images.includes(url) && (
                    <div style={{
                      position: 'absolute',
                      top: '2px',
                      right: '2px',
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      background: 'var(--primary)',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '8pt',
                      fontWeight: 600
                    }}>
                      {draft.images.indexOf(url) + 1}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Curation */}
        <div style={{
          marginBottom: '12px',
          padding: '12px',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          borderRadius: '8px',
          border: '1px solid #2d3561'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: curation ? '12px' : 0
          }}>
            <div>
              <div style={{ fontSize: '9pt', fontWeight: 600, color: '#e2e8f0' }}>
                AI Curation
              </div>
              <div style={{ fontSize: '7pt', color: '#94a3b8' }}>
                Optimize for engagement
              </div>
            </div>
            <button
              onClick={handleCurate}
              disabled={isCurating || !draft.text.trim()}
              style={{
                padding: '6px 16px',
                borderRadius: '20px',
                border: 'none',
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                color: 'white',
                fontSize: '8pt',
                fontWeight: 600,
                cursor: isCurating ? 'wait' : 'pointer',
                opacity: isCurating || !draft.text.trim() ? 0.6 : 1
              }}
            >
              {isCurating ? 'Curating...' : 'Curate'}
            </button>
          </div>

          {curation && (
            <div style={{ color: '#e2e8f0' }}>
              {/* Scores */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                marginBottom: '12px'
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '16pt', fontWeight: 600 }}>{curation.hook_score}/10</div>
                  <div style={{ fontSize: '7pt', color: '#94a3b8' }}>Hook</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '16pt', fontWeight: 600 }}>{curation.format_score}/10</div>
                  <div style={{ fontSize: '7pt', color: '#94a3b8' }}>Format</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    fontSize: '10pt',
                    fontWeight: 600,
                    color: getEngagementColor(curation.estimated_engagement),
                    textTransform: 'uppercase'
                  }}>
                    {curation.estimated_engagement}
                  </div>
                  <div style={{ fontSize: '7pt', color: '#94a3b8' }}>Engagement</div>
                </div>
              </div>

              {/* Curated Preview */}
              <div style={{
                padding: '12px',
                background: 'rgba(255,255,255,0.05)',
                borderRadius: '6px',
                marginBottom: '12px'
              }}>
                <div style={{ fontSize: '9pt', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {curation.curated_text}
                </div>
                {curation.hashtags.length > 0 && (
                  <div style={{ marginTop: '8px', color: '#60a5fa', fontSize: '8pt' }}>
                    {curation.hashtags.map(t => `#${t}`).join(' ')}
                  </div>
                )}
              </div>

              {/* Reasoning */}
              <div style={{ fontSize: '7pt', color: '#94a3b8', marginBottom: '12px' }}>
                {curation.reasoning}
              </div>

              <button
                onClick={applyCuration}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid #6366f1',
                  background: 'transparent',
                  color: '#a5b4fc',
                  fontSize: '8pt',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Apply This Version
              </button>
            </div>
          )}
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div style={{
            padding: '10px 12px',
            marginBottom: '12px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '6px',
            color: '#dc2626',
            fontSize: '8pt'
          }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{
            padding: '10px 12px',
            marginBottom: '12px',
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '6px',
            color: '#16a34a',
            fontSize: '8pt'
          }}>
            {success}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setShowScheduler(!showScheduler)}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '9pt',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <span>📅</span>
            Schedule
          </button>

          <button
            onClick={handlePost}
            disabled={isPosting || !draft.text.trim() || charCount.remaining < 0}
            style={{
              flex: 2,
              padding: '10px',
              borderRadius: '6px',
              border: 'none',
              background: isPosting || !draft.text.trim() || charCount.remaining < 0
                ? 'var(--text-muted)'
                : 'var(--primary)',
              color: 'white',
              fontSize: '9pt',
              fontWeight: 600,
              cursor: isPosting || !draft.text.trim() || charCount.remaining < 0 ? 'not-allowed' : 'pointer'
            }}
          >
            {isPosting ? 'Posting...' : 'Post Now'}
          </button>
        </div>

        {/* Scheduler */}
        {showScheduler && (
          <div style={{
            marginTop: '12px',
            padding: '12px',
            background: 'var(--surface-hover)',
            borderRadius: '6px'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Optimal posting times (your timezone):
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {OPTIMAL_TIMES.map(slot => (
                <button
                  key={slot.time}
                  onClick={() => {
                    const [hours, mins] = slot.time.split(':');
                    const scheduled = new Date();
                    scheduled.setHours(parseInt(hours), parseInt(mins), 0);
                    if (scheduled < new Date()) {
                      scheduled.setDate(scheduled.getDate() + 1);
                    }
                    setDraft(prev => ({ ...prev, scheduledFor: scheduled }));
                  }}
                  style={{
                    padding: '8px',
                    borderRadius: '6px',
                    border: draft.scheduledFor?.getHours() === parseInt(slot.time.split(':')[0])
                      ? '2px solid var(--primary)'
                      : '1px solid var(--border)',
                    background: 'var(--surface)',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <div style={{ fontSize: '9pt', fontWeight: 600 }}>{slot.label}</div>
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                    {slot.time} • {slot.engagement} engagement
                  </div>
                </button>
              ))}
            </div>
            {draft.scheduledFor && (
              <div style={{ marginTop: '8px', fontSize: '8pt', color: 'var(--primary)' }}>
                Scheduled for: {draft.scheduledFor.toLocaleString()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
