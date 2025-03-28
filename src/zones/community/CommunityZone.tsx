import React, { useEffect, useState } from 'react';
import { ZoneLayout } from '../shared/ZoneLayout';
import { supabase } from '../../lib/supabaseClient';
import '../styles/community-zone.css';

interface CommunityZoneProps {
  vehicleId: string;
  className?: string;
}

interface Owner {
  id: string;
  user_id: string;
  name: string;
  ownership_percentage: number;
  ownership_start_date: string;
  ownership_end_date: string | null;
  avatar_url: string | null;
}

interface Comment {
  id: string;
  user_id: string;
  user_name: string;
  user_avatar: string | null;
  text: string;
  created_at: string;
  likes: number;
}

/**
 * Community Zone Component
 * 
 * Displays the community and ownership aspects of a vehicle:
 * - Current and past owners
 * - Fractional ownership visualization
 * - Community comments and engagement
 * - Social proof and interaction metrics
 */
export const CommunityZone: React.FC<CommunityZoneProps> = ({
  vehicleId,
  className = ''
}) => {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');

  useEffect(() => {
    async function fetchCommunityData() {
      try {
        setLoading(true);
        
        // Fetch current owners data
        const { data: ownersData, error: ownersError } = await supabase
          .from('vehicle_owners')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('ownership_percentage', { ascending: false });
          
        if (ownersError) throw ownersError;
        
        // Fetch community comments
        const { data: commentsData, error: commentsError } = await supabase
          .from('vehicle_comments')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false })
          .limit(10);
          
        if (commentsError) throw commentsError;
        
        setOwners(ownersData || []);
        setComments(commentsData || []);
      } catch (err: any) {
        console.error('Error fetching community data:', err);
        setError(err.message || 'Failed to load community data');
      } finally {
        setLoading(false);
      }
    }
    
    if (vehicleId) {
      fetchCommunityData();
    }
  }, [vehicleId]);

  // Format date for display
  const formatDate = (dateString: string) => {
    const options: Intl.DateTimeFormatOptions = { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };
  
  // Format relative time for comments
  const formatRelativeTime = (dateString: string) => {
    const now = new Date();
    const commentDate = new Date(dateString);
    const diffMs = now.getTime() - commentDate.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return formatDate(dateString);
  };

  // Submit new comment
  const submitComment = async () => {
    if (!commentText.trim()) return;
    
    try {
      // In a real application, you'd get the current user information
      const currentUser = {
        id: 'current-user-id',
        name: 'Current User',
        avatar: null
      };
      
      const newComment = {
        vehicle_id: vehicleId,
        user_id: currentUser.id,
        user_name: currentUser.name,
        user_avatar: currentUser.avatar,
        text: commentText,
        created_at: new Date().toISOString(),
        likes: 0
      };
      
      // Insert the comment into the database
      const { data, error } = await supabase
        .from('vehicle_comments')
        .insert([newComment])
        .select();
        
      if (error) throw error;
      
      // Update the local state with the new comment
      setComments([data[0], ...comments]);
      setCommentText('');
    } catch (err: any) {
      console.error('Error submitting comment:', err);
      alert('Failed to submit comment. Please try again.');
    }
  };

  return (
    <ZoneLayout 
      title="Community & Ownership" 
      className={`community-zone ${className}`}
    >
      {loading ? (
        <div className="community-loading">
          <div className="community-loading-spinner"></div>
          <p>Loading community data...</p>
        </div>
      ) : error ? (
        <div className="community-error">
          <p>Error: {error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      ) : (
        <div className="community-content">
          {/* Ownership Section */}
          <div className="ownership-section">
            <h3 className="section-title">Ownership Distribution</h3>
            
            {owners.length > 0 ? (
              <>
                <div className="ownership-chart">
                  <div className="ownership-bars">
                    {owners.map((owner) => (
                      <div 
                        key={owner.id}
                        className="ownership-bar"
                        style={{ 
                          width: `${owner.ownership_percentage}%`,
                          backgroundColor: `hsl(${210 + owners.indexOf(owner) * 30}, 80%, 55%)`
                        }}
                        title={`${owner.name}: ${owner.ownership_percentage}%`}
                      ></div>
                    ))}
                  </div>
                </div>
                
                <div className="owners-list">
                  {owners.map((owner) => (
                    <div key={owner.id} className="owner-item">
                      <div className="owner-avatar">
                        {owner.avatar_url ? (
                          <img src={owner.avatar_url} alt={owner.name} />
                        ) : (
                          <div className="owner-avatar-placeholder">
                            {owner.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      
                      <div className="owner-details">
                        <div className="owner-name">{owner.name}</div>
                        <div className="owner-meta">
                          <span className="owner-percentage">{owner.ownership_percentage}%</span>
                          <span className="owner-since">
                            Since {formatDate(owner.ownership_start_date)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="ownership-actions">
                  <button className="ownership-action-btn primary">
                    Acquire Stake
                  </button>
                  <button className="ownership-action-btn secondary">
                    View All Transactions
                  </button>
                </div>
              </>
            ) : (
              <div className="ownership-empty">
                <p>No ownership information available for this vehicle.</p>
                <button className="ownership-action-btn primary">
                  Become First Owner
                </button>
              </div>
            )}
          </div>
          
          {/* Community Comments Section */}
          <div className="comments-section">
            <h3 className="section-title">Community Discussion</h3>
            
            <div className="comment-form">
              <textarea
                className="comment-input"
                placeholder="Add your comment..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
              ></textarea>
              <button 
                className="comment-submit-btn"
                onClick={submitComment}
                disabled={!commentText.trim()}
              >
                Post
              </button>
            </div>
            
            {comments.length > 0 ? (
              <div className="comments-list">
                {comments.map((comment) => (
                  <div key={comment.id} className="comment-item">
                    <div className="comment-avatar">
                      {comment.user_avatar ? (
                        <img src={comment.user_avatar} alt={comment.user_name} />
                      ) : (
                        <div className="comment-avatar-placeholder">
                          {comment.user_name.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    
                    <div className="comment-content">
                      <div className="comment-header">
                        <span className="comment-author">{comment.user_name}</span>
                        <span className="comment-time">{formatRelativeTime(comment.created_at)}</span>
                      </div>
                      
                      <div className="comment-text">{comment.text}</div>
                      
                      <div className="comment-actions">
                        <button className="comment-action-btn">
                          <span className="like-icon">♥</span> {comment.likes}
                        </button>
                        <button className="comment-action-btn">Reply</button>
                      </div>
                    </div>
                  </div>
                ))}
                
                {comments.length >= 10 && (
                  <button className="load-more-btn">
                    View More Comments
                  </button>
                )}
              </div>
            ) : (
              <div className="comments-empty">
                <p>No comments yet. Be the first to start the conversation!</p>
              </div>
            )}
          </div>
        </div>
      )}
    </ZoneLayout>
  );
};

export default CommunityZone;
