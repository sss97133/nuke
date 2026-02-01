import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface VehicleActivityTimelineProps {
  userId: string;
  limit?: number;
}

interface TimelineEvent {
  id: string;
  vehicle_id: string;
  user_id: string | null;
  event_type: string;
  event_date: string;
  title: string;
  description?: string | null;
  metadata?: any;
  vehicle?: {
    id: string;
    year?: number;
    make?: string;
    model?: string;
  };
}

type SortField = 'event_date' | 'event_type' | 'title' | 'vehicle_id';
type SortDirection = 'asc' | 'desc';

const VehicleActivityTimeline: React.FC<VehicleActivityTimelineProps> = ({ userId, limit = 100 }) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('event_date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterEventType, setFilterEventType] = useState<string>('');
  const [filterVehicle, setFilterVehicle] = useState<string>('');
  const navigate = useNavigate();

  useEffect(() => {
    loadEvents();
  }, [userId, limit]);

  const loadEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      // Get vehicle_images table data which has the actual EXIF data
      const { data: images, error: imgError } = await supabase
        .from('vehicle_images')
        .select(`
          id, vehicle_id, user_id, image_url, caption, category, 
          created_at, exif_data,
          vehicle:vehicles!vehicle_id (id, year, make, model)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (imgError) {
        console.error('Failed to load images:', imgError);
        // Continue anyway to show non-image events
      }

      // Transform vehicle_images to timeline events using EXIF dates
      const imageEvents = (images || []).map((img: any) => {
        let photoDate = img.created_at; // fallback
        
        if (img.exif_data) {
          try {
            const exif = typeof img.exif_data === 'string' ? JSON.parse(img.exif_data) : img.exif_data;
            
            // Look for date in EXIF data
            const exifDateStr = exif.DateTimeOriginal || 
                               exif.DateTime || 
                               exif.DateTimeDigitized ||
                               exif.CreateDate;
            
            if (exifDateStr) {
              // Convert EXIF format "2024:03:15 14:30:45" to ISO
              photoDate = exifDateStr
                .replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
                .replace(' ', 'T') + 'Z';
            }
          } catch (e) {
            console.error('Failed to parse EXIF:', e);
          }
        }

        return {
          id: `img-${img.id}`,
          vehicle_id: img.vehicle_id,
          user_id: img.user_id,
          event_type: 'image_upload',
          event_date: photoDate,
          title: img.caption || `Photo: ${img.category || 'General'}`,
          description: img.category,
          metadata: img.exif_data,
          vehicle: img.vehicle || null
        };
      });

      // Also get non-image timeline events
      const { data: events, error } = await supabase
        .from('vehicle_timeline_events')
        .select(`
          id, vehicle_id, user_id, event_type, event_date, title, description, metadata,
          vehicle:vehicles!vehicle_id (id, year, make, model)
        `)
        .eq('user_id', userId)
        .neq('event_type', 'image_upload')
        .order('event_date', { ascending: false })
        .limit(limit);

      if (error) throw error;

      // Combine both sources
      const allEvents = [
        ...imageEvents,
        ...(events || []).map((e: any) => ({ ...e, vehicle: e.vehicle || null }))
      ];

      // Sort by date (using EXIF dates for photos)
      allEvents.sort((a, b) => {
        const dateA = new Date(a.event_date).getTime();
        const dateB = new Date(b.event_date).getTime();
        return dateB - dateA;
      });

      // Take only limit
      const finalEvents = allEvents.slice(0, limit);
      setEvents(finalEvents as TimelineEvent[]);
    } catch (e: any) {
      setError(e?.message || 'Failed to load timeline');
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortedAndFilteredEvents = () => {
    let filtered = events;
    
    if (filterEventType) {
      filtered = filtered.filter(e => e.event_type.includes(filterEventType));
    }
    
    if (filterVehicle) {
      filtered = filtered.filter(e => e.vehicle_id.includes(filterVehicle));
    }

    return filtered.sort((a, b) => {
      let aVal: any, bVal: any;
      
      switch (sortField) {
        case 'event_date':
          aVal = new Date(a.event_date).getTime();
          bVal = new Date(b.event_date).getTime();
          break;
        case 'event_type':
          aVal = a.event_type;
          bVal = b.event_type;
          break;
        case 'title':
          aVal = a.title;
          bVal = b.title;
          break;
        case 'vehicle_id':
          aVal = a.vehicle_id;
          bVal = b.vehicle_id;
          break;
        default:
          return 0;
      }

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      if (sortDirection === 'asc') {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    // Check if date is valid
    if (isNaN(date.getTime())) {
      return dateString.split('T')[0] || dateString;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    // Check if date is valid
    if (isNaN(date.getTime())) {
      const timePart = dateString.split('T')[1] || dateString.split(' ')[1];
      return timePart ? timePart.substring(0, 5) : '';
    }
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const getWorkType = (eventType: string, title: string, description?: string) => {
    // Check title and description for specific work types
    const combined = `${title} ${description || ''}`.toLowerCase();
    
    if (combined.includes('engine')) return 'Engine Work';
    if (combined.includes('suspension')) return 'Suspension';
    if (combined.includes('exhaust')) return 'Exhaust';
    if (combined.includes('interior')) return 'Interior';
    if (combined.includes('exterior')) return 'Exterior';
    if (combined.includes('wheel') || combined.includes('tire')) return 'Wheels/Tires';
    if (combined.includes('brake')) return 'Brakes';
    if (combined.includes('oil')) return 'Oil Change';
    if (combined.includes('detail')) return 'Detailing';
    if (combined.includes('wash') || combined.includes('clean')) return 'Cleaning';
    if (combined.includes('repair')) return 'Repair';
    if (combined.includes('maintenance')) return 'Maintenance';
    if (combined.includes('modification') || combined.includes('mod')) return 'Modification';
    if (combined.includes('upgrade')) return 'Upgrade';
    if (combined.includes('install')) return 'Installation';
    
    // Event type based fallbacks
    if (eventType.includes('image')) return 'Documentation';
    if (eventType.includes('purchase')) return 'Purchase';
    if (eventType.includes('sale')) return 'Sale';
    
    return 'Work Session';
  };

  const formatVehicle = (event: TimelineEvent) => {
    if (event.vehicle) {
      const { year, make, model } = event.vehicle;
      return `${year || ''} ${make || ''} ${model || ''}`.trim() || 'Unknown Vehicle';
    }
    return 'Unknown Vehicle';
  };

  const getEventTypeBadgeClass = (eventType: string) => {
    if (eventType.includes('image')) return 'badge-primary';
    if (eventType.includes('vehicle')) return 'badge-success';
    if (eventType.includes('edit')) return 'badge-warning';
    return 'badge-secondary';
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return '';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body text-center">
          <div className="text-small text-muted">Loading activity...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="card-body text-center">
          <div className="text-small" style={{ color: 'var(--danger)' }}>{error}</div>
        </div>
      </div>
    );
  }

  const sortedEvents = getSortedAndFilteredEvents();

  if (sortedEvents.length === 0) {
    return (
      <div className="card">
        <div className="card-body text-center">
          <div className="text-small text-muted">No activity found</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="text font-bold">Vehicle Activity Timeline</h3>
      </div>

      {/* Filters */}
      <div className="card-body" style={{ padding: 'var(--space-2)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <div>
            <label className="text-small" style={{ color: 'var(--text-muted)', marginRight: 'var(--space-1)' }}>
              Event Type:
            </label>
            <input
              type="text"
              className="form-input text-small"
              style={{ width: '120px' }}
              placeholder="Filter..."
              value={filterEventType}
              onChange={(e) => setFilterEventType(e.target.value)}
            />
          </div>
          <div>
            <label className="text-small" style={{ color: 'var(--text-muted)', marginRight: 'var(--space-1)' }}>
              Vehicle:
            </label>
            <input
              type="text"
              className="form-input text-small"
              style={{ width: '120px' }}
              placeholder="Filter..."
              value={filterVehicle}
              onChange={(e) => setFilterVehicle(e.target.value)}
            />
          </div>
          <div className="text-small" style={{ color: 'var(--text-muted)' }}>
            {sortedEvents.length} events
          </div>
        </div>
      </div>

      {/* Excel-style Timeline Table */}
      <div style={{ 
        overflowX: 'auto',
        border: '1px solid var(--border-dark)',
        borderTop: 'none'
      }}>
        <table style={{ 
          width: '100%', 
          borderCollapse: 'collapse',
          fontSize: '11px',
          fontFamily: 'var(--font-mono)'
        }}>
          <thead style={{ 
            background: 'var(--grey-300)', 
            borderBottom: '2px solid var(--border-dark)',
            position: 'sticky',
            top: 0,
            zIndex: 10
          }}>
            <tr>
              <th style={{ 
                  padding: '6px 8px',
                  textAlign: 'left',
                  fontWeight: 'bold',
                  borderRight: '1px solid var(--border-medium)',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
                onClick={() => handleSort('event_date')}
              >
                DATE{getSortIcon('event_date')}
              </th>
              <th style={{ 
                  padding: '6px 8px',
                  textAlign: 'left',
                  fontWeight: 'bold',
                  borderRight: '1px solid var(--border-medium)',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
                onClick={() => handleSort('event_date')}
              >
                TIME
              </th>
              <th style={{ 
                  padding: '6px 8px',
                  textAlign: 'left',
                  fontWeight: 'bold',
                  borderRight: '1px solid var(--border-medium)',
                  userSelect: 'none'
                }}
              >
                TYPE
              </th>
              <th style={{ 
                  padding: '6px 8px',
                  textAlign: 'left',
                  fontWeight: 'bold',
                  borderRight: '1px solid var(--border-medium)',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
                onClick={() => handleSort('title')}
              >
                DESCRIPTION{getSortIcon('title')}
              </th>
              <th style={{ 
                  padding: '6px 8px',
                  textAlign: 'left',
                  fontWeight: 'bold',
                  userSelect: 'none'
                }}
              >
                VEHICLE
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedEvents.map((event) => (
              <tr 
                key={event.id}
                onClick={() => navigate(`/vehicle/${event.vehicle_id}`)}
                style={{ 
                  borderBottom: '1px solid var(--border-light)', 
                  cursor: 'pointer',
                  background: 'var(--white)'
                }}
                onMouseEnter={(el) => el.currentTarget.style.backgroundColor = '#e3f2fd'}
                onMouseLeave={(el) => el.currentTarget.style.backgroundColor = 'var(--white)'}
              >
                <td style={{ 
                  padding: '4px 8px',
                  borderRight: '1px solid var(--border-light)'
                }}>
                  {formatDate(event.event_date)}
                </td>
                <td style={{ 
                  padding: '4px 8px',
                  borderRight: '1px solid var(--border-light)'
                }}>
                  {formatTime(event.event_date)}
                </td>
                <td style={{ 
                  padding: '4px 8px',
                  borderRight: '1px solid var(--border-light)'
                }}>
                  {getWorkType(event.event_type, event.title, event.description || undefined)}
                </td>
                <td style={{ 
                  padding: '4px 8px',
                  borderRight: '1px solid var(--border-light)',
                  maxWidth: '300px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {event.title}
                </td>
                <td style={{ 
                  padding: '4px 8px'
                }}>
                  {formatVehicle(event)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default VehicleActivityTimeline;
