import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Comment {
  id: string;
  user_id: string;
  comment_text: string;
  created_at: string;
  target_type: string;
  target_label: string;
  user_email?: string;
  user_name?: string;
  avatar_url?: string;
}

interface VehicleCommentsProps {
  vehicleId: string;
}

const VehicleComments: React.FC<VehicleCommentsProps> = ({ vehicleId }) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadAllComments();
  }, [vehicleId]);

  const loadAllComments = async () => {
    setLoading(true);
    try {
      // Load comments from all sources for this vehicle without PostgREST joins
      const [vehicleComments, imageComments, eventComments, dataPointComments] = await Promise.all([
        supabase
          .from('vehicle_comments')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false }),

        supabase
          .from('vehicle_image_comments')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false }),

        supabase
          .from('timeline_event_comments')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false }),

        supabase
          .from('data_point_comments')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false })
      ]);

      const allComments: Comment[] = [];

      // Process vehicle comments
      if (vehicleComments.data) {
        allComments.push(...vehicleComments.data.map(c => ({
          ...c,
          target_type: 'vehicle',
          target_label: 'General Comment',
          user_email: undefined,
          user_name: undefined,
          avatar_url: undefined
        })));
      }

      // Process image comments
      if (imageComments.data) {
        allComments.push(...imageComments.data.map(c => ({
          ...c,
          target_type: 'image',
          target_label: 'Vehicle Image',
          user_email: undefined,
          user_name: undefined,
          avatar_url: undefined
        })));
      }

      // Process event comments
      if (eventComments.data) {
        allComments.push(...eventComments.data.map(c => ({
          ...c,
          target_type: 'event',
          target_label: 'Timeline Event',
          user_email: undefined,
          user_name: undefined,
          avatar_url: undefined
        })));
      }

      // Process data point comments
      if (dataPointComments.data) {
        allComments.push(...dataPointComments.data.map(c => ({
          ...c,
          target_type: 'data_point',
          target_label: `${c.data_point_type?.charAt(0).toUpperCase() + c.data_point_type?.slice(1)}: ${c.data_point_value || 'N/A'}`,
          user_email: undefined,
          user_name: undefined,
          avatar_url: undefined
        })));
      }

      // Optionally enrich with usernames/avatars from profiles
      try {
        const uniqueUserIds = Array.from(new Set(allComments.map(c => c.user_id).filter(Boolean)));
        if (uniqueUserIds.length > 0) {
          const { data: profilesData, error: profilesError } = await supabase
            .from('profiles')
            .select('id, username, avatar_url')
            .in('id', uniqueUserIds as string[]);
          if (profilesError) {
            console.warn('Profiles enrichment blocked or unavailable:', profilesError.message);
          }
          const byId: Record<string, { username?: string; avatar_url?: string }> = {};
          (profilesData || []).forEach((p: any) => { byId[p.id] = { username: p.username, avatar_url: p.avatar_url }; });
          allComments.forEach(c => {
            const p = c.user_id ? byId[c.user_id] : undefined;
            if (p) {
              c.user_name = p.username || undefined;
              c.avatar_url = p.avatar_url || c.avatar_url;
            }
          });

          // Fallback: if current auth user is present, inject their username/email for their own comments
          const { data: authData } = await supabase.auth.getUser();
          const authUser = authData?.user;
          if (authUser) {
            const authUsername = (authUser.user_metadata as any)?.username || (authUser.email ? authUser.email.split('@')[0] : undefined);
            allComments.forEach(c => {
              if (c.user_id === authUser.id && !c.user_name) {
                c.user_name = authUsername || c.user_name;
              }
            });
          }
        }
      } catch (e) {
        // Ignore enrichment failure; comments still display
      }

      // Sort all comments by date
      allComments.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      setComments(allComments);
    } catch (error) {
      console.error('Error loading comments:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCommentTypeIcon = (type: string) => {
    switch (type) {
      case 'vehicle': return '🚗';
      case 'image': return '📷';
      case 'event': return '📅';
      case 'data_point': return '📊';
      default: return '💬';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMinutes < 1) {
      return 'Just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
      });
    }
  };

  if (loading) {
    return (
      <div className="vehicle-section">
        <h3 className="section-title">Comments</h3>
        <div className="comments-loading">
          <div className="spinner"></div>
          <p className="text-muted">Loading comments...</p>
        </div>
      </div>
    );
  }

  const submitGeneralComment = async () => {
    if (!newComment.trim()) return;
    
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        console.error('Must be logged in to comment');
        return;
      }

      const { error } = await supabase
        .from('vehicle_comments')
        .insert({
          vehicle_id: vehicleId,
          user_id: session?.user?.id,
          comment_text: newComment.trim()
        });

      if (error) {
        console.error('Error submitting comment:', error);
        return;
      }

      setNewComment('');
      loadAllComments();
    } catch (error) {
      console.error('Error submitting comment:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {/* Compact header only if there are comments */}
      {comments.length > 0 && (
        <div style={{ marginBottom: '12px', fontSize: '14px', fontWeight: 600, color: '#374151' }}>
          Comments ({comments.length})
        </div>
      )}
      
      {/* Comment Box */}
      <div className="comment-form">
        <div className="form-group" style={{ position: 'relative', marginBottom: '12px' }}>
          <textarea
            className="form-input"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder={comments.length === 0 ? "Be the first to comment..." : "Add a comment..."}
            rows={3}
            disabled={submitting}
            style={{ paddingBottom: '40px' }}
          />
          <div className="form-actions" style={{ position: 'absolute', right: '8px', bottom: '8px' }}>
            <button
              className="button button-primary"
              onClick={submitGeneralComment}
              disabled={!newComment.trim() || submitting}
              style={{ padding: '6px 12px', fontSize: '14px' }}
            >
              {submitting ? 'Posting...' : 'Post Comment'}
            </button>
          </div>
        </div>
      </div>

      {/* Comments List */}
      {loading ? (
        <div className="comments-loading" style={{ padding: '20px', textAlign: 'center' }}>
          <div className="spinner"></div>
        </div>
      ) : comments.length > 0 ? (
        <div className="comments-list" style={{ paddingTop: '8px' }}>
          {comments.map((comment) => (
            <div key={`${comment.target_type}-${comment.id}`} className="comment-item">
                  <div className="comment-header" style={{ display: 'flex', alignItems: 'center' }}>
                    {/* Hide visual meta; keep structure optional if needed for analytics */}
                    {/* <div className="comment-meta" style={{ display: 'none' }}></div> */}
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="comment-avatar" style={{ width: 16, height: 16 }}>
                        {comment.avatar_url ? (
                          <img src={comment.avatar_url} alt="Profile" className="avatar-image" style={{ width: 16, height: 16, borderRadius: '50%' }} />
                        ) : (
                          <div className="avatar-placeholder" style={{ width: 16, height: 16, borderRadius: '50%', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {(comment.user_name || comment.user_email || 'U').charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="comment-author" style={{ fontSize: 12, color: '#374151' }}>
                        {comment.user_name || comment.user_email?.split('@')[0] || 'User'}
                      </div>
                      <span className="comment-date" style={{ fontSize: 11, color: '#6b7280' }}>{formatDate(comment.created_at)}</span>
                    </div>
                  </div>
                  <div className="comment-body">
                    <div className="comment-text">{comment.comment_text}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : null
      }
    </div>
  );
};

export default VehicleComments;
