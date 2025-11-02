// Work Order Viewer - "The Research Terminal"
// Tabbed, swipeable, bookmarkable deep-dive into shop work

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';

interface WorkOrderViewerProps {
  event: any; // business_timeline_event
  organizationName: string;
  laborRate?: number;
  onClose: () => void;
}

type Tab = 'overview' | 'parts' | 'labor' | 'photos' | 'shop';

export default function WorkOrderViewer({ event, organizationName, laborRate = 0, onClose }: WorkOrderViewerProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [bookmarkCount, setBookmarkCount] = useState(0);
  const [parts, setParts] = useState<any[]>([]);
  const [laborItems, setLaborItems] = useState<any[]>([]);
  const [collaborators, setCollaborators] = useState<any[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  
  const vehicleName = event.metadata?.vehicle_name || 'Unknown Vehicle';
  const vehicleId = event.metadata?.vehicle_id;
  
  // Aggregate images from event (handles both single events and grouped events)
  let images: string[] = [];
  if (event.image_urls && Array.isArray(event.image_urls)) {
    images = event.image_urls.filter(url => url); // Remove nulls
  } else if (event.image_urls && typeof event.image_urls === 'string') {
    images = [event.image_urls]; // Single string URL
  }
  
  // If this is a grouped event with aggregated_images from parent
  if (event.aggregated_images && Array.isArray(event.aggregated_images)) {
    images = [...images, ...event.aggregated_images].filter(url => url);
  }
  
  const totalImages = images.length;
  
  // Debug logging
  console.log('WorkOrderViewer event:', event);
  console.log('Images array:', images);
  console.log('Total images:', totalImages);
  
  // Parse AI metadata
  let workPerformed: string[] = [];
  let partsIdentified: string[] = [];
  let aiDescription = '';
  let qualityRating = 0;
  
  try {
    if (event.metadata?.work_performed) {
      workPerformed = JSON.parse(event.metadata.work_performed);
    }
  } catch (e) { }
  
  try {
    if (event.metadata?.parts_identified) {
      partsIdentified = JSON.parse(event.metadata.parts_identified);
    }
  } catch (e) { }
  
  if (event.metadata?.description) {
    aiDescription = event.metadata.description;
  }
  
  if (event.metadata?.qualityRating) {
    qualityRating = event.metadata.qualityRating;
  }

  useEffect(() => {
    loadUserData();
    loadParts();
    loadLabor();
    loadCollaborators();
    checkBookmarkStatus();
  }, [event.id]);

  const loadUserData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setCurrentUserId(user.id);
  };

  const loadParts = async () => {
    const { data, error } = await supabase
      .from('work_order_parts')
      .select('*')
      .eq('timeline_event_id', event.id)
      .order('created_at', { ascending: true });
    
    if (data) setParts(data);
  };

  const loadLabor = async () => {
    const { data, error } = await supabase
      .from('work_order_labor')
      .select('*')
      .eq('timeline_event_id', event.id)
      .order('created_at', { ascending: true });
    
    if (data) setLaborItems(data);
  };

  const loadCollaborators = async () => {
    const { data, error } = await supabase
      .from('work_order_collaborators')
      .select(`
        *,
        businesses:organization_id (
          id,
          business_name,
          business_type,
          logo_url
        )
      `)
      .eq('timeline_event_id', event.id)
      .order('created_at', { ascending: true });
    
    if (data) setCollaborators(data);
  };

  const checkBookmarkStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const { data } = await supabase
      .from('user_bookmarks')
      .select('id')
      .eq('user_id', user.id)
      .eq('bookmark_type', 'work_order')
      .eq('reference_id', event.id)
      .single();
    
    setIsBookmarked(!!data);
    
    // Get total bookmark count
    const { count } = await supabase
      .from('user_bookmarks')
      .select('*', { count: 'exact', head: true })
      .eq('bookmark_type', 'work_order')
      .eq('reference_id', event.id);
    
    if (count !== null) setBookmarkCount(count);
  };

  const toggleBookmark = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('Please log in to bookmark');
      return;
    }

    if (isBookmarked) {
      // Remove bookmark
      await supabase
        .from('user_bookmarks')
        .delete()
        .eq('user_id', user.id)
        .eq('bookmark_type', 'work_order')
        .eq('reference_id', event.id);
      
      setIsBookmarked(false);
      setBookmarkCount(prev => Math.max(0, prev - 1));
    } else {
      // Add bookmark
      await supabase
        .from('user_bookmarks')
        .insert({
          user_id: user.id,
          bookmark_type: 'work_order',
          reference_id: event.id,
          title: `${vehicleName} - ${event.title}`,
          thumbnail_url: images[0] || null,
          metadata: {
            vehicle_id: vehicleId,
            organization_name: organizationName,
            event_date: event.event_date
          }
        });
      
      setIsBookmarked(true);
      setBookmarkCount(prev => prev + 1);
    }
  };

  const partsTotal = parts.reduce((sum, p) => sum + (parseFloat(p.total_price) || 0), 0);
  const laborTotal = laborItems.reduce((sum, l) => sum + (parseFloat(l.total_cost) || 0), 0);
  const totalHours = laborItems.reduce((sum, l) => sum + (parseFloat(l.hours) || 0), 0);

  return ReactDOM.createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px',
        overflow: 'auto'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--white)',
          width: '100%',
          maxWidth: '1000px',
          maxHeight: '95vh',
          borderRadius: '8px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* HEADER - Sticky */}
        <div style={{
          padding: '16px',
          borderBottom: '2px solid var(--border)',
          background: 'linear-gradient(to bottom, #f8f9fa, #ffffff)',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                {new Date(event.event_date).toLocaleDateString('en-US', { 
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                })}
              </div>
              <div style={{ fontSize: '8pt', color: 'var(--accent)', marginBottom: '8px' }}>
                {organizationName} {laborRate > 0 && `• $${laborRate}/hr`}
              </div>
              {vehicleId ? (
                <a
                  href={`/vehicle/${vehicleId}`}
                  style={{ fontSize: '13pt', fontWeight: 700, color: 'var(--text)', textDecoration: 'none' }}
                  className="hover:underline"
                >
                  {vehicleName}
                </a>
              ) : (
                <div style={{ fontSize: '13pt', fontWeight: 700, color: 'var(--text)' }}>
                  {vehicleName}
                </div>
              )}
              <div style={{ fontSize: '11pt', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {event.title}
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {/* Bookmark button */}
              <button
                onClick={toggleBookmark}
                style={{
              background: isBookmarked ? 'var(--accent)' : 'transparent',
              border: '2px solid var(--accent)',
              cursor: 'pointer',
              fontSize: '8pt',
              fontWeight: 600,
              padding: '6px 12px',
              borderRadius: '4px',
              color: isBookmarked ? 'white' : 'var(--accent)',
              transition: 'all 0.12s ease'
            }}
            title={isBookmarked ? 'Remove bookmark' : 'Bookmark for later'}
            className="hover:scale-110"
          >
            {isBookmarked ? 'SAVED' : 'SAVE'}
          </button>
              
              {/* Close button */}
              <button
                onClick={onClose}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '24pt',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '0',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ×
              </button>
            </div>
          </div>
          
          {/* Key metrics badges */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {partsTotal > 0 && (
              <div style={{
                fontSize: '8pt',
                padding: '4px 10px',
                borderRadius: '4px',
                background: '#d4edda',
                color: '#155724',
                fontWeight: 600,
                border: '1px solid #c3e6cb'
              }}>
                ${partsTotal.toLocaleString()} parts
              </div>
            )}
            {totalHours > 0 && (
              <div style={{
                fontSize: '8pt',
                padding: '4px 10px',
                borderRadius: '4px',
                background: '#d1ecf1',
                color: '#0c5460',
                fontWeight: 600,
                border: '1px solid #bee5eb'
              }}>
                {totalHours}h labor
              </div>
            )}
            {totalImages > 0 && (
              <div style={{
                fontSize: '8pt',
                padding: '4px 10px',
                borderRadius: '4px',
                background: '#fff3cd',
                color: '#856404',
                fontWeight: 600,
                border: '1px solid #ffeaa7'
              }}>
                {totalImages} {totalImages === 1 ? 'photo' : 'photos'}
              </div>
            )}
            {qualityRating > 0 && (
              <div style={{
                fontSize: '8pt',
                padding: '4px 10px',
                borderRadius: '4px',
                background: qualityRating >= 80 ? '#d4edda' : qualityRating >= 60 ? '#fff3cd' : '#f8d7da',
                color: qualityRating >= 80 ? '#155724' : qualityRating >= 60 ? '#856404' : '#721c24',
                fontWeight: 600,
                border: `1px solid ${qualityRating >= 80 ? '#c3e6cb' : qualityRating >= 60 ? '#ffeaa7' : '#f5c6cb'}`
              }}>
                {qualityRating}/100 quality
              </div>
            )}
            {bookmarkCount > 0 && (
              <div style={{
                fontSize: '8pt',
                padding: '4px 10px',
                borderRadius: '4px',
                background: '#e2e8f0',
                color: '#475569',
                fontWeight: 600
              }}>
                {bookmarkCount} {bookmarkCount === 1 ? 'bookmark' : 'bookmarks'}
              </div>
            )}
          </div>
        </div>

        {/* TABS NAVIGATION */}
        <div style={{
          display: 'flex',
          borderBottom: '2px solid var(--border)',
          background: 'var(--surface)',
          overflowX: 'auto',
          flexShrink: 0
        }}>
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'parts', label: `Parts${partsTotal > 0 ? ` ($${partsTotal.toLocaleString()})` : ''}` },
            { id: 'labor', label: `Labor${totalHours > 0 ? ` (${totalHours}h)` : ''}` },
            { id: 'photos', label: `Photos (${totalImages})` },
            { id: 'shop', label: 'Shop Info' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              style={{
                flex: '1 0 auto',
                padding: '12px 16px',
                border: 'none',
                borderBottom: activeTab === tab.id ? '3px solid var(--accent)' : '3px solid transparent',
                background: activeTab === tab.id ? 'var(--white)' : 'transparent',
                fontSize: '9pt',
                fontWeight: activeTab === tab.id ? 700 : 400,
                cursor: 'pointer',
                color: activeTab === tab.id ? 'var(--accent)' : 'var(--text)',
                transition: 'all 0.12s ease',
                whiteSpace: 'nowrap'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* TAB CONTENT - Scrollable */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '20px',
          WebkitOverflowScrolling: 'touch'
        }}>
          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div>
              {aiDescription && (
                <div style={{
                  padding: '16px',
                  background: '#f8f9fa',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  marginBottom: '20px'
                }}>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text)' }}>
                    Work Summary
                  </div>
                  <div style={{ fontSize: '9pt', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {aiDescription}
                  </div>
                </div>
              )}
              
              {workPerformed.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '10px', color: 'var(--text)' }}>
                    Work Performed
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '24px', fontSize: '9pt', color: 'var(--text-secondary)' }}>
                    {workPerformed.map((work, idx) => (
                      <li key={idx} style={{ marginBottom: '6px', lineHeight: 1.5 }}>{work}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {qualityRating > 0 && event.metadata?.concerns && (
                <div style={{
                  padding: '16px',
                  background: qualityRating >= 80 ? '#d4edda' : '#fff3cd',
                  borderRadius: '6px',
                  border: `1px solid ${qualityRating >= 80 ? '#c3e6cb' : '#ffeaa7'}`,
                  marginBottom: '20px'
                }}>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text)' }}>
                    Quality Rating: {qualityRating}/100
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {event.metadata.concerns}
                  </div>
                </div>
              )}

              {/* Collaborators */}
              {collaborators.length > 0 && (
                <div style={{
                  padding: '16px',
                  background: '#f8f9fa',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  marginBottom: '20px'
                }}>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '12px', color: 'var(--text)' }}>
                    Work Order Attribution
                  </div>
                  {collaborators.map(collab => (
                    <div
                      key={collab.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 0',
                        borderBottom: '1px solid var(--border-light)'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <a
                          href={`/org/${collab.organization_id}`}
                          style={{ fontSize: '9pt', fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}
                          className="hover:underline"
                        >
                          {collab.businesses?.business_name}
                        </a>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '2px' }}>
                          {collab.role === 'originator' ? 'Work Order Originator' : 
                           collab.role === 'location' ? 'Location / Host' :
                           collab.role === 'performer' ? 'Work Performed By' :
                           collab.role}
                        </div>
                      </div>
                      {collab.revenue_attribution > 0 && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '9pt', fontWeight: 700, color: 'var(--accent)' }}>
                            ${parseFloat(collab.revenue_attribution).toLocaleString()}
                          </div>
                          {collab.revenue_percentage && (
                            <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                              {parseFloat(collab.revenue_percentage).toFixed(0)}%
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              {workPerformed.length === 0 && !aiDescription && (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  <div>No detailed work summary available yet.</div>
                  <div style={{ marginTop: '8px', fontSize: '8pt' }}>
                    Shop owners can add notes and details to this work order.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PARTS TAB */}
          {activeTab === 'parts' && (
            <div>
              {parts.length > 0 ? (
                <div>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '16px', color: 'var(--text)' }}>
                    Parts & Materials Used
                    <span style={{ float: 'right', color: 'var(--accent)' }}>
                      Total: ${partsTotal.toLocaleString()}
                    </span>
                  </div>
                  
                  {parts.map(part => (
                    <div
                      key={part.id}
                      style={{
                        padding: '16px',
                        marginBottom: '12px',
                        border: '2px solid var(--border)',
                        borderRadius: '6px',
                        background: 'var(--white)'
                      }}
                    >
                      <div style={{ display: 'flex', gap: '12px' }}>
                        {part.image_url && (
                          <img
                            src={part.image_url}
                            alt={part.part_name}
                            style={{
                              width: '80px',
                              height: '80px',
                              objectFit: 'cover',
                              borderRadius: '4px',
                              border: '1px solid var(--border)'
                            }}
                          />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '4px' }}>
                            {part.part_name}
                            {part.quantity > 1 && (
                              <span style={{ fontSize: '8pt', color: 'var(--text-muted)', marginLeft: '8px' }}>
                                × {part.quantity}
                              </span>
                            )}
                          </div>
                          {part.brand && (
                            <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                              Brand: {part.brand}
                            </div>
                          )}
                          {part.part_number && (
                            <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                              Part #: {part.part_number}
                            </div>
                          )}
                          <div style={{ fontSize: '11pt', fontWeight: 700, color: 'var(--accent)' }}>
                            ${parseFloat(part.total_price || 0).toLocaleString()}
                          </div>
                          {part.buy_url && (
                            <a
                              href={part.buy_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="button button-small button-primary"
                            style={{
                              marginTop: '8px',
                              fontSize: '8pt',
                              display: 'inline-block',
                              textDecoration: 'none'
                            }}
                          >
                            Buy on {part.supplier || 'Supplier'}
                          </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : partsIdentified.length > 0 ? (
                <div>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '16px', color: 'var(--text)' }}>
                    Parts & Materials (AI Identified)
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {partsIdentified.map((part, idx) => (
                      <div
                        key={idx}
                        style={{
                          fontSize: '8pt',
                          padding: '8px 12px',
                          background: '#f3f4f6',
                          border: '1px solid #d1d5db',
                          borderRadius: '4px',
                          color: '#374151'
                        }}
                      >
                        {part}
                      </div>
                    ))}
                  </div>
                  <div style={{
                    marginTop: '20px',
                    padding: '16px',
                    background: '#fff3cd',
                    borderRadius: '6px',
                    border: '1px solid #ffeaa7',
                    fontSize: '8pt',
                    color: '#856404'
                  }}>
                    These parts were identified by AI from work photos. Shop owners can add exact part numbers and buy links.
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  <div>No parts information available yet.</div>
                </div>
              )}
            </div>
          )}

          {/* LABOR TAB */}
          {activeTab === 'labor' && (
            <div>
              {laborItems.length > 0 ? (
                <div>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '16px', color: 'var(--text)' }}>
                    Labor Breakdown
                    <span style={{ float: 'right', color: 'var(--accent)' }}>
                      {totalHours}h × ${laborRate}/hr = ${laborTotal.toLocaleString()}
                    </span>
                  </div>
                  
                  {laborItems.map(labor => (
                    <div
                      key={labor.id}
                      style={{
                        padding: '12px 16px',
                        marginBottom: '8px',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        background: 'var(--white)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '2px' }}>
                          {labor.task_name}
                        </div>
                        {labor.task_category && (
                          <div style={{
                            fontSize: '7pt',
                            color: 'var(--text-muted)',
                            textTransform: 'uppercase',
                            marginBottom: '4px'
                          }}>
                            {labor.task_category}
                          </div>
                        )}
                        {labor.notes && (
                          <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            {labor.notes}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', marginLeft: '16px' }}>
                        <div style={{ fontSize: '10pt', fontWeight: 700 }}>
                          {parseFloat(labor.hours).toFixed(1)}h
                        </div>
                        <div style={{ fontSize: '9pt', color: 'var(--accent)' }}>
                          ${parseFloat(labor.total_cost || 0).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : event.labor_hours > 0 ? (
                <div>
                  <div style={{
                    padding: '16px',
                    background: '#f8f9fa',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    marginBottom: '16px'
                  }}>
                    <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px' }}>
                      Total Labor: {event.labor_hours}h
                    </div>
                    {laborRate > 0 && (
                      <div style={{ fontSize: '9pt', color: 'var(--text-secondary)' }}>
                        Estimated cost: ${(event.labor_hours * laborRate).toLocaleString()} at ${laborRate}/hr
                      </div>
                    )}
                  </div>
                  <div style={{
                    padding: '16px',
                    background: '#fff3cd',
                    borderRadius: '6px',
                    border: '1px solid #ffeaa7',
                    fontSize: '8pt',
                    color: '#856404'
                  }}>
                    Detailed labor breakdown not available. Shop owners can add itemized tasks for transparency.
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  <div>No labor information available yet.</div>
                </div>
              )}
            </div>
          )}

          {/* PHOTOS TAB */}
          {activeTab === 'photos' && (
            <div>
              {images.length > 0 ? (
                <div>
                  {/* Main image viewer */}
                  <div style={{
                    position: 'relative',
                    marginBottom: '16px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: '2px solid var(--border)'
                  }}>
                    <img
                      src={images[currentImageIndex]}
                      alt={`Work photo ${currentImageIndex + 1}`}
                      style={{
                        width: '100%',
                        height: 'auto',
                        maxHeight: '60vh',
                        objectFit: 'contain',
                        background: '#000',
                        cursor: 'zoom-in'
                      }}
                      onClick={() => setZoomedImage(images[currentImageIndex])}
                    />
                    
                    {/* Navigation arrows */}
                    {images.length > 1 && (
                      <>
                        <button
                          onClick={() => setCurrentImageIndex(prev => (prev - 1 + images.length) % images.length)}
                          style={{
                            position: 'absolute',
                            left: '10px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'rgba(0,0,0,0.7)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            width: '40px',
                            height: '40px',
                            fontSize: '20pt',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          ‹
                        </button>
                        <button
                          onClick={() => setCurrentImageIndex(prev => (prev + 1) % images.length)}
                          style={{
                            position: 'absolute',
                            right: '10px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'rgba(0,0,0,0.7)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            width: '40px',
                            height: '40px',
                            fontSize: '20pt',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          ›
                        </button>
                      </>
                    )}
                    
                    {/* Image counter */}
                    <div style={{
                      position: 'absolute',
                      bottom: '10px',
                      right: '10px',
                      background: 'rgba(0,0,0,0.7)',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '20px',
                      fontSize: '8pt',
                      fontWeight: 600
                    }}>
                      {currentImageIndex + 1} / {images.length}
                    </div>
                  </div>
                  
                  {/* Thumbnail strip */}
                  {images.length > 1 && (
                    <div style={{
                      display: 'flex',
                      gap: '8px',
                      overflowX: 'auto',
                      paddingBottom: '8px'
                    }}>
                      {images.map((img, idx) => (
                        <img
                          key={idx}
                          src={img}
                          alt={`Thumbnail ${idx + 1}`}
                          onClick={() => setCurrentImageIndex(idx)}
                          style={{
                            width: '80px',
                            height: '80px',
                            objectFit: 'cover',
                            borderRadius: '4px',
                            border: idx === currentImageIndex ? '3px solid var(--accent)' : '2px solid var(--border)',
                            cursor: 'pointer',
                            flexShrink: 0
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  <div>No photos available for this work order.</div>
                </div>
              )}
            </div>
          )}

          {/* SHOP INFO TAB */}
          {activeTab === 'shop' && (
            <div style={{
              padding: '20px',
              background: '#f8f9fa',
              borderRadius: '8px',
              border: '1px solid var(--border)'
            }}>
              <div style={{ fontSize: '12pt', fontWeight: 700, marginBottom: '16px' }}>
                {organizationName}
              </div>
              
              {laborRate > 0 && (
                <div style={{ fontSize: '9pt', marginBottom: '8px' }}>
                  Labor Rate: <strong>${laborRate}/hr</strong>
                </div>
              )}
              
              <div style={{ marginTop: '20px' }}>
                <a
                  href={`/org/${event.organization_id || event.business_id}`}
                  className="button button-primary"
                  style={{ fontSize: '9pt', textDecoration: 'none', display: 'inline-block' }}
                >
                  View Full Profile
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Zoomed image lightbox */}
      {zoomedImage && ReactDOM.createPortal(
        <div
          onClick={() => setZoomedImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.95)',
            zIndex: 100000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <img
            src={zoomedImage}
            alt="Zoomed"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain'
            }}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setZoomedImage(null)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'rgba(255,255,255,0.2)',
              color: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '50px',
              height: '50px',
              fontSize: '30pt',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>,
        document.body
      )}
    </div>,
    document.body
  );
}
