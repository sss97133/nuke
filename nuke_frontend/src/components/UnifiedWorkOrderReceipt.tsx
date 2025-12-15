/**
 * UNIFIED WORK ORDER RECEIPT
 * 
 * Combines:
 * - Work Order details (performer, cost, items)
 * - Evidence Set (photos with date navigation)
 * - Comments with thumbnails
 * - Receipt breakdown (new forensic cost tracking)
 * 
 * Replaces:
 * ❌ TimelineEventReceipt.tsx (old, redundant)
 * ❌ Separate evidence set card
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { CommentService, Comment } from '../services/CommentService';

interface UnifiedWorkOrderReceiptProps {
  eventId: string;
  onClose: () => void;
}

interface WorkOrder {
  id: string;
  title: string;
  description?: string;
  event_date: string;
  event_type: string;
  mileage_at_event?: number;
  cost_amount?: number;
  duration_hours?: number;
  service_provider_name?: string;
  performer_name?: string;
  metadata?: any;
  user_id?: string;
  vehicle_id?: string;
}

interface Evidence {
  id: string;
  image_url: string;
  category?: string;
  taken_at?: string;
  file_name?: string;
}

interface ReceiptItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  category: 'parts' | 'labor' | 'materials' | 'other';
}

export const UnifiedWorkOrderReceipt: React.FC<UnifiedWorkOrderReceiptProps> = ({ eventId, onClose }) => {
  // State
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  
  // Date navigation
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [availableDates, setAvailableDates] = useState<Date[]>([]);

  useEffect(() => {
    loadData();
  }, [eventId]);

  const loadData = async () => {
    setLoading(true);
    
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
      
      // Get work order
      const { data: event } = await supabase
        .from('vehicle_timeline_events')
        .select('*')
        .eq('id', eventId)
        .single();
      
      if (event) {
        setWorkOrder(event);
        setSelectedDate(new Date(event.event_date));
        
        // Get evidence (photos from this work order)
        const { data: images } = await supabase
          .from('vehicle_images')
          .select('*')
          .eq('vehicle_id', event.vehicle_id)
          .gte('taken_at', new Date(event.event_date).toISOString().split('T')[0])
          .lte('taken_at', new Date(new Date(event.event_date).getTime() + 24*60*60*1000).toISOString().split('T')[0])
          .order('taken_at', { ascending: true });
        
        setEvidence(images || []);
        
        // Get receipt items (if this is a cost event)
        if (event.cost_amount && event.cost_amount > 0) {
          const { data: items } = await supabase
            .from('receipt_line_items')
            .select('*')
            .eq('timeline_event_id', eventId);
          
          setReceiptItems(items || []);
        }
        
        // Get available dates for navigation
        if (event.vehicle_id) {
          const { data: dates } = await supabase
            .from('vehicle_timeline_events')
            .select('event_date')
            .eq('vehicle_id', event.vehicle_id)
            .order('event_date', { ascending: false });
          
          if (dates) {
            setAvailableDates(dates.map(d => new Date(d.event_date)));
          }
        }
      }
      
      // Get comments
      const commentsResult = await CommentService.getEventComments(eventId);
      if (commentsResult.success && commentsResult.data) {
        setComments(commentsResult.data);
      }
      
    } catch (error) {
      console.error('Error loading work order:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || submittingComment || !currentUser) return;
    
    setSubmittingComment(true);
    
    try {
      // Add comment with image context if available
      const options: any = {};
      if (evidence.length > 0) {
        options.imageId = evidence[0].id;
        options.thumbnailUrl = evidence[0].image_url;
      }
      
      const result = await CommentService.addComment(eventId, newComment, currentUser.id, options);
      
      if (result.success) {
        setNewComment('');
        
        // Reload comments
        const commentsResult = await CommentService.getEventComments(eventId);
        if (commentsResult.success && commentsResult.data) {
          setComments(commentsResult.data);
        }
      } else {
        alert(result.error || 'Failed to add comment');
      }
    } catch (error: any) {
      console.error('Error adding comment:', error);
      alert(error.message);
    } finally {
      setSubmittingComment(false);
    }
  };

  const navigateDate = (direction: 'prev' | 'next') => {
    if (!selectedDate) return;
    
    const currentIndex = availableDates.findIndex(d => 
      d.toDateString() === selectedDate.toDateString()
    );
    
    if (currentIndex === -1) return;
    
    const newIndex = direction === 'prev' ? currentIndex + 1 : currentIndex - 1;
    if (newIndex >= 0 && newIndex < availableDates.length) {
      setSelectedDate(availableDates[newIndex]);
      // TODO: Load new event for this date
    }
  };

  const calculateTotals = () => {
    if (receiptItems.length > 0) {
      const parts = receiptItems.filter(i => i.category === 'parts').reduce((sum, i) => sum + i.total, 0);
      const labor = receiptItems.filter(i => i.category === 'labor').reduce((sum, i) => sum + i.total, 0);
      const materials = receiptItems.filter(i => i.category === 'materials').reduce((sum, i) => sum + i.total, 0);
      const other = receiptItems.filter(i => i.category === 'other').reduce((sum, i) => sum + i.total, 0);
      return { parts, labor, materials, other, total: parts + labor + materials + other };
    }
    return { 
      parts: 0, 
      labor: workOrder?.duration_hours ? workOrder.duration_hours * 40 : 0, 
      materials: 0, 
      other: 0,
      total: workOrder?.cost_amount || 0 
    };
  };

  const totals = calculateTotals();

  if (loading) {
    return createPortal(
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}>
        <div style={{ color: '#fff', fontSize: '14pt' }}>Loading...</div>
      </div>,
      document.body
    );
  }

  if (!workOrder) {
    return null;
  }

  return createPortal(
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div 
        style={{
          background: 'var(--surface)',
          width: '100%',
          maxWidth: '800px',
          maxHeight: '90vh',
          overflow: 'auto',
          border: '2px solid #000',
          fontFamily: 'Arial, sans-serif'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Date Navigation */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px',
          borderBottom: '2px solid #000',
          backgroundColor: '#f5f5f5'
        }}>
          <button
            onClick={() => navigateDate('prev')}
            style={{
              padding: '4px 12px',
              fontSize: '7pt',
              fontWeight: 'bold',
              border: '2px solid #000',
              background: 'var(--surface)',
              cursor: 'pointer',
              textTransform: 'uppercase'
            }}
          >
            ← PREV DAY
          </button>
          
          <div style={{ fontSize: '9pt', fontWeight: 'bold', letterSpacing: '0.5px' }}>
            {selectedDate?.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}
          </div>
          
          <button
            onClick={() => navigateDate('next')}
            style={{
              padding: '4px 12px',
              fontSize: '7pt',
              fontWeight: 'bold',
              border: '2px solid #000',
              background: 'var(--surface)',
              cursor: 'pointer',
              textTransform: 'uppercase'
            }}
          >
            NEXT DAY →
          </button>
        </div>

        {/* Work Order Header */}
        <div style={{ padding: '16px', borderBottom: '1px solid #e0e0e0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: '7pt', color: '#666', marginBottom: '4px' }}>WORK ORDER</div>
              <div style={{ fontSize: '11pt', fontWeight: 'bold' }}>#{workOrder.id.substring(0, 8).toUpperCase()}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '7pt', color: '#666' }}>PERFORMED BY</div>
              <div style={{ fontSize: '9pt', fontWeight: 'bold' }}>
                {workOrder.service_provider_name || workOrder.performer_name || workOrder.metadata?.performer_name || 'Unknown'}
              </div>
            </div>
          </div>
        </div>

        {/* Evidence Set */}
        {evidence.length > 0 && (
          <div style={{ padding: '16px', borderBottom: '1px solid #e0e0e0', backgroundColor: '#fafafa' }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '12px'
            }}>
              <div style={{ fontSize: '7pt', fontWeight: 'bold', textTransform: 'uppercase' }}>
                Evidence Set ({evidence.length} photos)
              </div>
              <div style={{ fontSize: '7pt', color: '#666' }}>
                {workOrder.metadata?.ai_analysis_status === 'pending' ? 'AI analysis pending' : 'Analyzed'}
              </div>
            </div>
            
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
              gap: '8px'
            }}>
              {evidence.map((img) => (
                <div 
                  key={img.id}
                  style={{
                    position: 'relative',
                    aspectRatio: '1',
                    border: '1px solid #ccc',
                    overflow: 'hidden',
                    cursor: 'pointer'
                  }}
                >
                  <img 
                    src={img.image_url} 
                    alt={img.file_name || 'Evidence'} 
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Work Performed */}
        <div style={{ padding: '16px', borderBottom: '1px solid #e0e0e0' }}>
          <div style={{ fontSize: '7pt', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase' }}>
            Work Performed
          </div>
          <div style={{ fontSize: '8pt', lineHeight: '1.5' }}>
            {workOrder.title || workOrder.description || `${evidence.length} photos from ${new Date(workOrder.event_date).toLocaleDateString()}`}
          </div>
        </div>

        {/* Receipt Breakdown */}
        {totals.total > 0 && (
          <div style={{ padding: '16px', borderBottom: '1px solid #e0e0e0', backgroundColor: '#fafafa' }}>
            <div style={{ fontSize: '7pt', fontWeight: 'bold', marginBottom: '12px', textTransform: 'uppercase' }}>
              Cost Breakdown
            </div>
            
            {receiptItems.length > 0 ? (
              <table style={{ width: '100%', fontSize: '7pt', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #ccc' }}>
                    <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 'bold' }}>Item</th>
                    <th style={{ textAlign: 'center', padding: '4px 0', fontWeight: 'bold' }}>Qty</th>
                    <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 'bold' }}>Unit</th>
                    <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 'bold' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {receiptItems.map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '4px 0' }}>{item.description}</td>
                      <td style={{ textAlign: 'center', padding: '4px 0' }}>{item.quantity}</td>
                      <td style={{ textAlign: 'right', padding: '4px 0' }}>${item.unit_price.toFixed(2)}</td>
                      <td style={{ textAlign: 'right', padding: '4px 0' }}>${item.total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ fontSize: '7pt' }}>
                {totals.labor > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>Labor ({workOrder.duration_hours} hrs @ $40/hr)</span>
                    <span>${totals.labor.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}
            
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              marginTop: '12px', 
              paddingTop: '12px', 
              borderTop: '2px solid #000',
              fontSize: '9pt',
              fontWeight: 'bold'
            }}>
              <span>TOTAL</span>
              <span>${totals.total.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Comments Section */}
        <div style={{ padding: '16px', borderBottom: '1px solid #e0e0e0' }}>
          <div style={{ fontSize: '7pt', fontWeight: 'bold', marginBottom: '12px', textTransform: 'uppercase' }}>
            Comments ({comments.length})
          </div>
          
          {comments.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              {comments.map((comment) => (
                <div key={comment.id} style={{ 
                  marginBottom: '12px', 
                  padding: '8px', 
                  backgroundColor: '#fafafa',
                  border: '1px solid #e0e0e0',
                  display: 'flex',
                  gap: '8px'
                }}>
                  {/* Thumbnail */}
                  {comment.thumbnail_url && (
                    <div style={{ flexShrink: 0 }}>
                      <img 
                        src={comment.thumbnail_url} 
                        alt="Context" 
                        style={{ 
                          width: '40px', 
                          height: '40px', 
                          objectFit: 'cover',
                          border: '1px solid #ccc'
                        }} 
                      />
                    </div>
                  )}
                  
                  {/* Content */}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '6pt', color: '#666', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 'bold' }}>
                        {comment.user_profile?.username || 'User'}
                      </span>
                      {comment.context_type && (
                        <span style={{ 
                          marginLeft: '6px', 
                          padding: '1px 4px', 
                          backgroundColor: '#e0e0e0',
                          textTransform: 'uppercase'
                        }}>
                          {comment.context_type}
                        </span>
                      )}
                      <span style={{ marginLeft: '6px' }}>
                        {new Date(comment.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ fontSize: '7pt', lineHeight: '1.4' }}>
                      {comment.comment_text}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {/* Add Comment */}
          {currentUser && (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-start' }}>
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAddComment();
                  }
                }}
                placeholder="Add a comment or note..."
                disabled={submittingComment}
                style={{
                  flex: 1,
                  fontSize: '7pt',
                  padding: '6px',
                  border: '1px solid #ccc',
                  resize: 'none',
                  minHeight: '40px',
                  fontFamily: 'inherit'
                }}
                rows={2}
              />
              <button
                onClick={handleAddComment}
                disabled={!newComment.trim() || submittingComment}
                style={{
                  padding: '6px 12px',
                  fontSize: '7pt',
                  fontWeight: 'bold',
                  backgroundColor: newComment.trim() && !submittingComment ? '#fff' : '#e0e0e0',
                  border: '2px solid #000',
                  color: newComment.trim() && !submittingComment ? '#000' : '#999',
                  cursor: newComment.trim() && !submittingComment ? 'pointer' : 'not-allowed',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap'
                }}
              >
                {submittingComment ? 'POSTING...' : 'POST'}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ 
          padding: '12px', 
          display: 'flex', 
          justifyContent: 'flex-end',
          backgroundColor: '#f5f5f5',
          gap: '8px'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 16px',
              fontSize: '7pt',
              fontWeight: 'bold',
              backgroundColor: 'var(--surface)',
              border: '2px solid #000',
              cursor: 'pointer',
              textTransform: 'uppercase'
            }}
          >
            ESC TO CLOSE
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

