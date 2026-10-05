import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import VehicleMemePanel from './VehicleMemePanel';
import { FallbackAvatar } from '../common/AsciiAvatar';
import { decodeHtmlEntities } from '../../utils/htmlEntities';
import { useVehicleCommentsUnified } from '../../hooks/useVehicleCommentsUnified';

interface Comment {
  id: string;
  user_id?: string | null;
  comment_text: string;
  created_at: string;
  updated_at?: string; // For detecting edited comments
  posted_at?: string;
  user_name?: string;
  user_avatar?: string;
  author_username?: string; // For external platform comments (BaT, Cars & Bids, etc.)
  comment_type?: string; // 'bid', 'question', 'observation', etc.
  bid_amount?: number;
  is_seller?: boolean;
  source?: 'nzero' | 'auction' | 'bat' | 'facebook' | 'instagram' | 'sbx' | 'pcar' | 'cars_and_bids'; // All comment sources
  auction_platform?: string | null; // Platform name: 'bat', 'cars_and_bids', 'pcarmarket', 'sbx', 'facebook', 'instagram', etc.
  external_identity_id?: string; // For linking to profiles
  source_category?: string; // Native IDs belong to separate source collections
  media_urls?: string[]; // For Instagram images, Facebook photos, etc.
  comment_url?: string; // Direct link to original comment
}

interface VehicleCommentsCardProps {
  vehicleId: string;
  session: any;
  collapsed?: boolean;
  maxVisible?: number;
  disabled?: boolean;
  containerId?: string;
  containerClassName?: string;
  containerStyle?: React.CSSProperties;
}

export const VehicleCommentsCard: React.FC<VehicleCommentsCardProps> = ({
  vehicleId,
  session,
  collapsed = true,
  maxVisible = 2,
  disabled = false,
  containerId,
  containerClassName,
  containerStyle,
}) => {
  const navigate = useNavigate();
  const { data: rawRows, isLoading: rawLoading, isError: readError, refetch } = useVehicleCommentsUnified(vehicleId);
  const [processed, setProcessed] = useState<{ vehicleId: string; comments: Comment[] } | null>(null);
  const [processingFailure, setProcessingFailure] = useState<string | null>(null);
  const processingError = processingFailure === vehicleId;
  const comments = !readError && !processingError && processed?.vehicleId === vehicleId ? processed.comments : [];
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(!collapsed);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [memePickerOpen, setMemePickerOpen] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [updating, setUpdating] = useState(false);

  // Realtime subscription to refresh on changes
  useEffect(() => {
    const channel = supabase
      .channel(`vehicle-comments-${vehicleId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'auction_comments',
        filter: `vehicle_id=eq.${vehicleId}`
      }, () => { refetch(); })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_comments',
        filter: `vehicle_id=eq.${vehicleId}`
      }, () => { refetch(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [vehicleId, refetch]);

  // Process raw rows into Comment objects when data changes
  useEffect(() => {
    let current = true;
    if (rawRows && !readError) processRows(rawRows, () => current);
    return () => { current = false; };
  }, [rawRows, vehicleId, readError]);

  const processRows = async (allRows: any[], isCurrent: () => boolean) => {
    try {
      setLoading(true);
      setProcessingFailure(null);

      const normalizeExternalPlatform = (raw: any): string | null => {
        if (!raw) return null;
        const s = String(raw);
        if (s === 'bringatrailer') return 'bat';
        if (s === 'carsandbids') return 'cars_and_bids';
        return s;
      };

      const isGarbageCarsAndBidsComment = (text: string): boolean => {
        const t = String(text || '').trim();
        if (!t) return true;
        const lower = t.toLowerCase();
        return lower.includes('comments & bids') || lower.includes('most upvoted') ||
          lower.includes('newest') || lower.includes('add a comment') ||
          lower.includes('bid history') || lower.includes('you just commented') ||
          lower.startsWith('comments ');
      };

      // Resolve auction_event platforms in batch
      const auctionEventIds = [...new Set(allRows.map(c => c.auction_event_id).filter(Boolean))];
      const auctionEventPlatformMap = new Map<string, string>();
      if (auctionEventIds.length > 0) {
        try {
          const { data: evRows } = await supabase.from('auction_events').select('id, source').in('id', auctionEventIds);
          (evRows || []).forEach((r: any) => {
            const mapped = normalizeExternalPlatform(r?.source);
            if (r?.id && mapped) auctionEventPlatformMap.set(String(r.id), mapped);
          });
        } catch { /* ignore */ }
      }

      // A source-qualified native identity key takes precedence over mutable handles.
      const identityPlatform = (c: any): string | null => {
        const platforms = [normalizeExternalPlatform(c.platform),
          normalizeExternalPlatform(auctionEventPlatformMap.get(String(c.auction_event_id))),
          c.source_category === 'observation' ? normalizeExternalPlatform(c.source_slug) : null]
          .filter((p): p is string => !!p && ['bat', 'cars_and_bids', 'pcarmarket', 'sbx', 'facebook', 'instagram'].includes(p));
        return new Set(platforms).size === 1 ? platforms[0] : null;
      };
      const externalIdentityById = new Map<string, any>();
      const nativeIds = [...new Set(allRows.filter(c => c.source_category !== 'user' && c.external_identity_id != null)
        .map(c => c.external_identity_id))];
      for (let start = 0; start < nativeIds.length; start += 100) {
        const ids = nativeIds.slice(start, start + 100);
        const { data } = await supabase.from('external_identities')
          .select('id, platform, handle, claimed_by_user_id').in('id', ids);
        (data || []).forEach((e: any) => { if (ids.includes(e?.id)) externalIdentityById.set(e.id, e); });
      }

      // Historical NULL-key fallback requires an established platform and one match.
      const platformHandles = new Map<string, Set<string>>();
      for (const c of allRows) {
        if (c.source_category === 'user' || c.external_identity_id != null || !c.author_username) continue;
        const p = identityPlatform(c);
        if (!p) continue;
        const set = platformHandles.get(p) || new Set<string>();
        set.add(c.author_username);
        platformHandles.set(p, set);
      }

      const externalIdentityByKey = new Map<string, any>();
      for (const [platform, handlesSet] of platformHandles.entries()) {
        const handles = Array.from(handlesSet);
        if (handles.length === 0) continue;
        const { data: externalIds } = await supabase
          .from('external_identities')
          .select('id, platform, handle, claimed_by_user_id')
          .eq('platform', platform)
          .in('handle', handles);
        (externalIds || []).forEach((e: any) => {
          if (e?.id && handlesSet.has(e.handle) && normalizeExternalPlatform(e.platform) === platform) {
            const key = `${platform}:${e.handle}`;
            externalIdentityByKey.set(key, externalIdentityByKey.has(key) ? null : e);
          }
        });
      }

      // Resolve Nuke user profiles
      const nukeUserIds = [...new Set(allRows.filter(c => c.source_category === 'user' && c.user_id).map(c => c.user_id))];
      const profilesMap = new Map<string, any>();
      if (nukeUserIds.length > 0) {
        const { data: profilesData } = await supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', nukeUserIds);
        (profilesData || []).forEach(p => profilesMap.set(p.id, p));
      }

      // Map unified rows to Comment objects
      const allComments: Comment[] = [];

      for (const c of allRows) {
        const resolvedPlatform = normalizeExternalPlatform(c.platform) ||
          normalizeExternalPlatform(auctionEventPlatformMap.get(String(c.auction_event_id))) ||
          (c.source_category === 'observation' ? normalizeExternalPlatform(c.source_slug) : null);

        // Filter garbage C&B comments
        if (resolvedPlatform === 'cars_and_bids' && isGarbageCarsAndBidsComment(c.comment_text)) continue;

        if (c.source_category === 'user') {
          // First-party Nuke user comment
          const profile = c.user_id ? profilesMap.get(c.user_id) : null;
          allComments.push({
            id: c.comment_id,
            source_category: c.source_category,
            user_id: c.user_id,
            comment_text: c.comment_text,
            created_at: c.observed_at,
            updated_at: c.observed_at,
            user_name: profile?.full_name || profile?.username || 'User',
            user_avatar: profile?.avatar_url,
            source: 'nzero'
          });
        } else {
          // Auction / observation comment
          const platform = identityPlatform(c);
          const candidate = c.external_identity_id != null
            ? externalIdentityById.get(c.external_identity_id)
            : (platform && c.author_username ? externalIdentityByKey.get(`${platform}:${c.author_username}`) : null);
          const identity = platform && candidate && normalizeExternalPlatform(candidate.platform) === platform ? candidate : null;

          let bidAmount: number | undefined;
          if (c.bid_amount != null) {
            const num = typeof c.bid_amount === 'number' ? c.bid_amount : Number(c.bid_amount);
            if (!isNaN(num) && num > 0) bidAmount = num;
          }

          let commentSource: Comment['source'] = 'auction';
          if (resolvedPlatform === 'bat') commentSource = 'bat';
          else if (resolvedPlatform === 'cars_and_bids') commentSource = 'cars_and_bids';
          else if (resolvedPlatform === 'pcarmarket' || resolvedPlatform === 'pcar') commentSource = 'pcar';
          else if (resolvedPlatform === 'sbx' || resolvedPlatform === 'sbxcars') commentSource = 'sbx';
          else if (resolvedPlatform === 'facebook') commentSource = 'facebook';
          else if (resolvedPlatform === 'instagram') commentSource = 'instagram';

          allComments.push({
            id: c.comment_id,
            source_category: c.source_category,
            user_id: identity?.claimed_by_user_id || null,
            author_username: c.author_username,
            comment_text: c.comment_text,
            created_at: c.observed_at,
            posted_at: c.observed_at,
            user_name: c.author_username,
            comment_type: c.comment_type || (bidAmount ? 'bid' : undefined),
            bid_amount: bidAmount,
            is_seller: c.is_seller,
            source: commentSource,
            auction_platform: resolvedPlatform,
            external_identity_id: identity?.id,
            media_urls: Array.isArray(c.media_urls) ? c.media_urls : undefined,
            comment_url: c.comment_url || undefined
          });
        }
      }

      if (isCurrent()) setProcessed({ vehicleId, comments: allComments });
    } catch {
      if (isCurrent()) setProcessingFailure(vehicleId);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const handlePostComment = async () => {
    if (!session?.user?.id || !newComment.trim()) return;

    setPosting(true);
    try {
      const { error } = await supabase
        .from('user_comments')
        .insert({
          vehicle_id: vehicleId,
          user_id: session.user.id,
          target_type: 'vehicle',
          comment_text: newComment.trim(),
          created_at: new Date().toISOString()
        });

      if (!error) {
        setNewComment('');
        setMemePickerOpen(false);
        refetch();
      }
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setPosting(false);
    }
  };

  const handleStartEdit = (comment: Comment) => {
    setEditingCommentId(comment.id);
    setEditingText(comment.comment_text);
  };

  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditingText('');
  };

  const handleUpdateComment = async (commentId: string) => {
    if (!session?.user?.id || !editingText.trim()) return;

    setUpdating(true);
    try {
      const { error } = await supabase
        .from('user_comments')
        .update({
          comment_text: editingText.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', commentId)
        .eq('user_id', session.user.id); // Ensure user owns the comment

      if (!error) {
        setEditingCommentId(null);
        setEditingText('');
        refetch();
      } else {
        console.error('Failed to update comment:', error);
      }
    } catch (err) {
      console.error('Failed to update comment:', err);
    } finally {
      setUpdating(false);
    }
  };

  const handleMemeSelect = (memeUrl: string, memeTitle: string) => {
    // Insert meme reference into comment
    const memeRef = `[meme:${memeTitle}](${memeUrl})`;
    setNewComment(prev => prev ? `${prev}\n${memeRef}` : memeRef);
    setMemePickerOpen(false);
  };

  // Keyboard shortcut: Ctrl+M or Cmd+M to open meme picker
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
        e.preventDefault();
        setMemePickerOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
  };

  const renderCommentText = (text: string | null | undefined) => {
    // Defensive: accept null/undefined/non-string (prod crashed here 2026-05-24 with
    // "Cannot read properties of null (reading 'length')" inside an Array.map at
    // VehicleCommentsCard. Some comment rows arrive with null/non-string comment_text.
    if (text == null) return null;
    // BaT comment text is stored HTML-escaped as served ("Don&#039;t"); decode for display
    const safeText = decodeHtmlEntities(typeof text === 'string' ? text : String(text ?? ''));
    if (!safeText) return null;
    // Parse markdown-style meme references: [meme:Title](url)
    const memeRegex = /\[meme:([^\]]+)\]\(([^)]+)\)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = memeRegex.exec(safeText)) !== null) {
      // Add text before the meme
      if (match.index > lastIndex) {
        parts.push(safeText.substring(lastIndex, match.index));
      }
      
      // Add the meme image
      const title = match[1];
      const url = match[2];
      parts.push(
        <img
          key={match.index}
          src={url}
          alt={title}
          title={title}
          style={{
            maxWidth: '200px',
            maxHeight: '150px',
            display: 'block',
            marginTop: '4px',
            marginBottom: '4px',
            border: '1px solid var(--border)',
          }}
        />
      );
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < safeText.length) {
      parts.push(safeText.substring(lastIndex));
    }

    return parts.length > 0 ? parts : safeText;
  };

  const handleUsernameClick = (comment: Comment) => {
    // External claim/profile links have already been resolved by the qualified key.
    if (comment.user_id) {
      navigate(`/profile/${comment.user_id}`);
    } else if (comment.external_identity_id) {
      navigate(`/profile/external/${comment.external_identity_id}`);
    }
  };

  const visibleComments = expanded ? comments : comments.slice(0, maxVisible);
  const hasMore = comments.length > maxVisible;

  return (
    <div
      id={containerId}
      className={['card', containerClassName].filter(Boolean).join(' ')}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        ...(containerStyle || {}),
      }}
    >
      <div
        className="card-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div>Comments &amp; Bids {readError || processingError || rawLoading || loading || processed?.vehicleId !== vehicleId ? '(—)' : `(${comments.length})`}</div>
        {hasMore && !expanded && (
          <button
            className="btn-utility"
            style={{ fontSize: '8px', padding: '2px 6px' }}
            onClick={() => setExpanded(true)}
          >
            Show all
          </button>
        )}
      </div>
      <div 
        className="card-body comments-scroll-container"
        style={{ 
          flex: '1 1 auto', 
          minHeight: 0, 
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {readError || processingError ? (
          <div role="status" style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '12px' }}>
            Comments could not be loaded completely. Their absence has not been established.
            {' '}<button type="button" className="btn-utility" onClick={() => refetch()}>Retry comments</button>
          </div>
        ) : rawLoading || loading || processed?.vehicleId !== vehicleId ? (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px' }}>
            Loading comments...
          </div>
        ) : comments.length === 0 ? (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px' }}>
            No comments yet. Be the first to comment!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {visibleComments.map((comment) => {
              if (!comment) return null;
              const displayDate = comment.posted_at || comment.created_at;
              // Check if this is a bid - either comment_type is 'bid' OR bid_amount is set
              const type = String(comment.comment_type || '').toLowerCase();
              const isSoldComment = type === 'sold';
              const hasBidAmount = comment.bid_amount != null && (typeof comment.bid_amount === 'number' ? comment.bid_amount > 0 : Number(comment.bid_amount) > 0);
              const isBid = type === 'bid' || (!isSoldComment && hasBidAmount);
              const isBaT = comment.source === 'bat';
              const isAuction = comment.source === 'auction';
              const auctionPlatform = (comment as any).auction_platform ? String((comment as any).auction_platform) : null;
              
              // Amount (bid or sold) for display
              const amount = hasBidAmount ? (typeof comment.bid_amount === 'number' ? comment.bid_amount : Number(comment.bid_amount)) : null;
              
              return (
                <div key={`${comment.source_category}:${comment.id}`} style={{
                  paddingBottom: '12px', 
                  borderBottom: '1px solid var(--border)',
                  paddingLeft: isBaT ? '8px' : '0',
                  borderLeft: isBaT ? '3px solid var(--grey-300)' : 'none'
                }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <FallbackAvatar
                      src={comment.user_avatar}
                      seed={comment.author_username || comment.user_name || comment.id || 'user'}
                      platform={comment.source === 'bat' || comment.source === 'facebook' || comment.source === 'instagram' ? comment.source : undefined}
                      size={24}
                      alt={comment.author_username || comment.user_name || 'User'}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => handleUsernameClick(comment)}
                          disabled={!comment.user_id && !comment.external_identity_id}
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: comment.user_id || comment.external_identity_id ? 'pointer' : 'default',
                            color: 'var(--text)',
                            textDecoration: comment.user_id || comment.external_identity_id ? 'underline' : 'none'
                          }}
                        >
                          {comment.user_name || comment.author_username || 'Unknown author'}
                        </button>
                        {/* Platform badges for all external sources */}
                        {comment.source === 'bat' && (
                          <span style={{ fontSize: '9px', color: 'var(--accent)', fontWeight: 600 }}>
                            BaT
                          </span>
                        )}
                        {comment.source === 'auction' && auctionPlatform && (
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            {auctionPlatform === 'cars_and_bids' ? 'Cars & Bids' :
                             auctionPlatform === 'pcarmarket' ? 'PCar Market' :
                             auctionPlatform === 'sbx' ? 'SBX Cars' :
                             auctionPlatform === 'bringatrailer' ? 'BaT' :
                             auctionPlatform}
                          </span>
                        )}
                        {comment.source === 'facebook' && (
                          <span style={{ fontSize: '9px', color: '#1877f2', fontWeight: 600 }}>
                            Facebook
                          </span>
                        )}
                        {comment.source === 'instagram' && (
                          <span style={{ fontSize: '9px', color: '#e4405f', fontWeight: 600 }}>
                            Instagram
                          </span>
                        )}
                        {comment.source === 'sbx' && (
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            SBX Cars
                          </span>
                        )}
                        {comment.source === 'pcar' && (
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            PCar Market
                          </span>
                        )}
                        {comment.source === 'cars_and_bids' && (
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            Cars & Bids
                          </span>
                        )}
                        {isSoldComment && (
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: 'var(--success)',
                            backgroundColor: 'var(--success-dim)',
                            padding: '2px 6px', marginLeft: '4px'
                          }}>
                            {amount && amount > 0 ? `$${amount.toLocaleString()} SOLD` : 'SOLD'}
                          </span>
                        )}
                        {isBid && amount && amount > 0 && (
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: 'var(--success)',
                            backgroundColor: 'var(--success-dim)',
                            padding: '2px 6px', marginLeft: '4px'
                          }}>
                            ${amount.toLocaleString()} BID
                          </span>
                        )}
                        {comment.is_seller && (
                          <span style={{
                            fontSize: '9px',
                            fontWeight: 600,
                            color: 'var(--error)',
                            backgroundColor: 'var(--error-dim)',
                            padding: '2px 6px'}}>
                            SELLER
                          </span>
                        )}
                        <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                          {formatTimeAgo(displayDate)}
                          {comment.updated_at && comment.updated_at !== comment.created_at && (
                            <span style={{ marginLeft: '4px' }}>(edited)</span>
                          )}
                        </span>
                        {/* Edit button - only for user's own Nuke comments */}
                        {comment.source === 'nzero' && comment.user_id === session?.user?.id && !editingCommentId && (
                          <button
                            onClick={() => handleStartEdit(comment)}
                            style={{
                              fontSize: '9px',
                              background: 'none',
                              border: 'none',
                              padding: '2px 6px',
                              cursor: 'pointer',
                              color: 'var(--text-muted)',
                              textDecoration: 'underline',
                              marginLeft: '8px'
                            }}
                            title="Edit comment"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', lineHeight: 1.4 }}>
                        {editingCommentId === comment.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <textarea
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              rows={3}
                              disabled={updating}
                              style={{
                                width: '100%',
                                fontSize: '11px',
                                padding: '6px',
                                border: '1px solid var(--border)',
                                resize: 'vertical',
                                fontFamily: 'inherit'
                              }}
                            />
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => handleUpdateComment(comment.id)}
                                disabled={updating || !editingText.trim()}
                                className="button button-primary"
                                style={{ fontSize: '11px', padding: '4px 12px' }}
                              >
                                {updating ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                onClick={handleCancelEdit}
                                disabled={updating}
                                className="button button-secondary"
                                style={{ fontSize: '11px', padding: '4px 12px' }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {renderCommentText(comment.comment_text ?? '')}
                            {/* Show media URLs for Instagram/Facebook comments — guard against
                                non-array media_urls (some rows have string/null instead of array). */}
                            {Array.isArray(comment.media_urls) && comment.media_urls.length > 0 && (
                              <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {comment.media_urls.slice(0, 3).map((url, idx) => (
                                  <img
                                    key={idx}
                                    src={url}
                                    alt={`Media ${idx + 1}`}
                                    style={{
                                      maxWidth: '100px',
                                      maxHeight: '100px',
                                      objectFit: 'cover', border: '1px solid var(--border)',
                                      cursor: 'pointer'
                                    }}
                                    onClick={() => window.open(url, '_blank')}
                                  />
                                ))}
                                {comment.media_urls.length > 3 && (
                                  <span style={{ fontSize: '9px', color: 'var(--text-muted)', alignSelf: 'center' }}>
                                    +{comment.media_urls.length - 3} more
                                  </span>
                                )}
                              </div>
                            )}
                            {/* Link to original comment if available (a URL captured from a dev server, e.g. localhost, is dead
                                for every visitor: 2026-09-30, a K5 comment linked to localhost:5174) */}
                            {comment.comment_url && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(comment.comment_url) && (
                              <div style={{ marginTop: '4px' }}>
                                <a
                                  href={comment.comment_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    fontSize: '9px',
                                    color: 'var(--text-muted)',
                                    textDecoration: 'underline'
                                  }}
                                >
                                  View original →
                                </a>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add comment input (kept outside scroll area so it's always accessible) */}
      {session?.user?.id && (
        <div
          className="card-footer"
          style={{
            position: 'relative',
            flexShrink: 0,
          }}
        >
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment... (Ctrl+M for memes)"
            rows={2}
            disabled={posting}
            style={{
              width: '100%',
              fontSize: '11px',
              padding: '6px',
              border: '1px solid var(--border)',
              resize: 'vertical',
              fontFamily: 'inherit',
              marginBottom: '6px'
            }}
          />
          
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
            <button
              className="button button-secondary"
              style={{ fontSize: '11px', padding: '4px 12px' }}
              onClick={() => setMemePickerOpen(!memePickerOpen)}
              title="Meme picker (Ctrl+M)"
            >
              Memes
            </button>
            <button
              className="button button-primary"
              style={{ fontSize: '11px', padding: '4px 12px' }}
              onClick={handlePostComment}
              disabled={posting || !newComment.trim()}
            >
              {posting ? 'Posting...' : 'Post'}
            </button>
          </div>

          {/* Meme Picker Popup */}
          {memePickerOpen && (
            <div style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              right: 0,
              marginBottom: '4px',
              background: 'var(--surface)',
              border: '1px solid var(--border)', zIndex: 1000,
              maxHeight: '240px',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{
                padding: '4px 6px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'var(--grey-100)',
              }}>
                <span style={{ fontSize: '11px', fontWeight: 600 }}>Select Meme</span>
                <button
                  onClick={() => setMemePickerOpen(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '11px',
                    padding: '2px 4px',
                  }}
                >
                  X
                </button>
              </div>
              <div style={{
                padding: '4px',
                overflowY: 'auto',
                flex: 1,
              }}>
                <VehicleMemePanel 
                  vehicleId={vehicleId} 
                  disabled={disabled}
                  onMemeSelect={handleMemeSelect}
                  pickerMode
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VehicleCommentsCard;
