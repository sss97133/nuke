/**
 * Profile Comments Tab
 * Displays comments (BaT-style) for user or organization
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import VehicleThumbnail from '../VehicleThumbnail';

interface Comment {
  id: string;
  comment_text?: string;
  comment_timestamp?: string;
  posted_at?: string;
  author_username?: string;
  likes_count?: number;
  bid_amount?: number;
  contains_bid?: boolean;
  listing?: any;  // bat_listings
  auction?: any;  // auction_events
  vehicle?: any;
  platform?: string;
  comment_type?: string;
}

interface ProfileCommentsTabProps {
  comments: Comment[];
  profileType: 'user' | 'organization';
}

export const ProfileCommentsTab: React.FC<ProfileCommentsTabProps> = ({ comments, profileType }) => {
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const toggleExpanded = (commentId: string) => {
    setExpandedComments(prev => {
      const next = new Set(prev);
      if (next.has(commentId)) {
        next.delete(commentId);
      } else {
        next.add(commentId);
      }
      return next;
    });
  };

  const getPlatformBadge = (comment: Comment) => {
    const platform = comment.platform || 
                    (comment.listing ? 'BaT' : '') ||
                    (comment.auction ? 'Auction' : '');
    
    if (!platform) return null;

    const platformColors: Record<string, string> = {
      'bat': 'var(--accent)',
      'cars_and_bids': '#4CAF50',
      'ebay': '#E53238',
      'auction': 'var(--text-muted)',
    };

    const displayName = platform === 'bat' ? 'BaT' : 
                       platform === 'cars_and_bids' ? 'C&B' :
                       platform.toUpperCase();

    return (
      <span style={{
        fontSize: '7pt',
        padding: '2px 6px',
        background: platformColors[platform.toLowerCase()] || 'var(--text-muted)',
        color: 'var(--white)',
        borderRadius: '2px',
        fontWeight: 'bold',
        textTransform: 'uppercase',
      }}>
        {displayName}
      </span>
    );
  };

  if (comments.length === 0) {
    return (
      <div style={{
        padding: 'var(--space-6)',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: '8pt',
      }}>
        No comments yet
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
    }}>
      {comments.map((comment) => {
        // Get vehicle from either listing or auction relationship
        const vehicle = comment.vehicle || 
                       comment.listing?.vehicle || 
                       comment.auction?.vehicle;
        
        const vehicleName = vehicle
          ? `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()
          : comment.listing?.bat_listing_title || 'Unknown Vehicle';

        const commentText = comment.comment_text || '';
        const isLongComment = commentText.length > 200;
        const isExpanded = expandedComments.has(comment.id);
        const displayText = (isLongComment && !isExpanded) 
          ? commentText.substring(0, 200) + '...' 
          : commentText;

        const timestamp = comment.comment_timestamp || comment.posted_at;
        const commentTextLower = String(commentText || '').toLowerCase();
        const type = String(comment.comment_type || '').toLowerCase();
        const looksLikeSold = type === 'sold' || /\bsold\s+for\s+\$?\s*[\d,]+/i.test(commentTextLower);

        const hasBidAmount = comment.bid_amount !== null && comment.bid_amount !== undefined;
        const hasContainsBid = Boolean(comment.contains_bid);
        const isBid = !looksLikeSold && (hasBidAmount || hasContainsBid);
        
        // Skip bids - they should be in the Bids tab
        if (isBid) return null;

        // Get link to original auction/listing
        const externalUrl = comment.listing?.bat_listing_url || 
                           comment.auction?.listing_url ||
                           null;

        return (
          <div
            key={comment.id}
            style={{
              display: 'flex',
              gap: 'var(--space-3)',
              padding: 'var(--space-3)',
              background: 'var(--surface)',
              border: '2px solid var(--border)',
              borderRadius: '4px',
              transition: 'all 0.12s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--surface-hover)';
              e.currentTarget.style.borderColor = 'var(--border-hover)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--surface)';
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {/* Thumbnail */}
            <div style={{ 
              flexShrink: 0, 
              width: '120px', 
              height: '80px',
              overflow: 'hidden',
              borderRadius: '4px',
              border: '2px solid var(--border)',
            }}>
              {vehicle?.id ? (
                <Link 
                  to={`/vehicle/${vehicle.id}`}
                  style={{ 
                    display: 'block', 
                    width: '100%', 
                    height: '100%',
                    position: 'relative'
                  }}
                >
                  <VehicleThumbnail vehicleId={vehicle.id} />
                </Link>
              ) : (
                <div style={{
                  width: '100%',
                  height: '100%',
                  background: 'var(--surface-hover)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '7pt',
                  color: 'var(--text-muted)',
                }}>
                  No Image
                </div>
              )}
            </div>

            {/* Details */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {/* Header: Vehicle name + badges */}
              <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{
                    fontSize: '9pt',
                    fontWeight: 'bold',
                    margin: 0,
                    marginBottom: '4px',
                  }}>
                    {vehicle?.id ? (
                      <Link
                        to={`/vehicle/${vehicle.id}`}
                        style={{ color: 'var(--text)', textDecoration: 'none' }}
                      >
                        {vehicleName}
                      </Link>
                    ) : (
                      externalUrl ? (
                        <a
                          href={externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--text)', textDecoration: 'none' }}
                        >
                          {vehicleName}
                        </a>
                      ) : (
                        vehicleName
                      )
                    )}
                  </h3>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
                  {getPlatformBadge(comment)}
                </div>
              </div>

              {/* Metadata: Date, likes, bid amount */}
              <div style={{ 
                fontSize: '7pt', 
                color: 'var(--text-muted)',
                display: 'flex',
                gap: 'var(--space-2)',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}>
                <span>{formatDate(timestamp)}</span>
                {comment.likes_count && comment.likes_count > 0 && (
                  <>
                    <span style={{ color: 'var(--border)' }}>·</span>
                    <span style={{ color: 'var(--accent)' }}>
                      {comment.likes_count} {comment.likes_count === 1 ? 'like' : 'likes'}
                    </span>
                  </>
                )}
              </div>

              {/* Comment text */}
              {commentText && (
                <div style={{
                  fontSize: '8pt',
                  color: 'var(--text)',
                  lineHeight: '1.5',
                  whiteSpace: 'pre-wrap',
                  wordWrap: 'break-word',
                }}>
                  {displayText}
                  {isLongComment && (
                    <button
                      onClick={() => toggleExpanded(comment.id)}
                      style={{
                        marginLeft: 'var(--space-1)',
                        fontSize: '7pt',
                        color: 'var(--accent)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        padding: 0,
                      }}
                    >
                      {isExpanded ? 'Show less' : 'Read more'}
                    </button>
                  )}
                </div>
              )}

              {/* Link to original auction */}
              {externalUrl && (
                <div style={{ marginTop: 'var(--space-1)' }}>
                  <a
                    href={externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: '7pt',
                      color: 'var(--accent)',
                      textDecoration: 'none',
                    }}
                  >
                    View Original Comment →
                  </a>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

