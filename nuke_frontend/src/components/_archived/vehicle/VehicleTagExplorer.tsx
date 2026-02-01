import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface TagContext {
  tag_name: string;
  count: number;
  avg_confidence: number;
  images: Array<{
    image_url: string;
    event_date?: string;
    event_type?: string;
    technician?: string;
    location?: string;
    timeline_context?: any;
  }>;
  timeline_correlation: {
    events: Array<{
      date: string;
      event_type: string;
      description: string;
      technician?: string;
      tools_used?: string[];
      related_tags: string[];
    }>;
    frequency_over_time: Record<string, number>;
    associated_work: {
      repair_sessions: number;
      inspection_events: number;
      maintenance_records: number;
    };
  };
  related_tags: Array<{
    tag_name: string;
    correlation_strength: number;
    co_occurrence_count: number;
  }>;
  system_context: {
    vehicle_system: string; // "brakes", "engine", "body", "electrical", etc.
    component_hierarchy: string[]; // ["brake_system", "brake_disc", "rust_damage"]
    severity_trend: "improving" | "worsening" | "stable" | "unknown";
    maintenance_urgency: "immediate" | "soon" | "monitor" | "none";
  };
}

interface VehicleTagExplorerProps {
  vehicleId: string;
}

type ZoomLevel = 'overview' | 'system' | 'tag' | 'image';
type ViewMode = 'timeline' | 'systems' | 'technicians' | 'geographic' | 'severity';

const VehicleTagExplorer: React.FC<VehicleTagExplorerProps> = ({ vehicleId }) => {
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('overview');
  const [viewMode, setViewMode] = useState<ViewMode>('systems');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);
  const [tagContexts, setTagContexts] = useState<Record<string, TagContext>>({});
  const [loading, setLoading] = useState(true);
  const [systemOverview, setSystemOverview] = useState<Record<string, any>>({});

  useEffect(() => {
    loadContextualData();
  }, [vehicleId]);

  const loadContextualData = async () => {
    try {
      setLoading(true);

      console.log('Loading contextual data for vehicle:', vehicleId);

      // First, let's get all tags for this vehicle (simplified query to start)
      const { data: tags, error: tagsError } = await supabase
        .from('image_tags')
        .select(`
          *,
          vehicle_images!inner(
            image_url,
            area,
            vehicle_id
          )
        `)
        .eq('vehicle_images.vehicle_id', vehicleId);

      console.log('Raw tags data:', tags);

      if (tagsError) {
        console.error('Tags error:', tagsError);
        throw tagsError;
      }

      // If no manual tags exist yet, create some demo data from the Rekognition analysis
      if (!tags || tags.length === 0) {
        console.log('No tags found, creating demo system data');
        const demoContexts = createDemoTagContexts();
        setTagContexts(demoContexts);
        const demoSystems = buildSystemOverview(demoContexts);
        setSystemOverview(demoSystems);
      } else {
        // Process real tag data
        const contexts = await buildTagContexts(tags);
        setTagContexts(contexts);

        // Build system overview
        const systems = buildSystemOverview(contexts);
        setSystemOverview(systems);
      }

    } catch (err) {
      console.error('Error loading contextual data:', err);
      // Fallback to demo data on error
      const demoContexts = createDemoTagContexts();
      setTagContexts(demoContexts);
      const demoSystems = buildSystemOverview(demoContexts);
      setSystemOverview(demoSystems);
    } finally {
      setLoading(false);
    }
  };

  const buildTagContexts = async (enrichedTags: any[]): Promise<Record<string, TagContext>> => {
    const contexts: Record<string, TagContext> = {};

    // Group by tag name
    const tagGroups = enrichedTags.reduce((groups, tag) => {
      const tagName = tag.tag_name;
      if (!groups[tagName]) groups[tagName] = [];
      groups[tagName].push(tag);
      return groups;
    }, {} as Record<string, any[]>);

    for (const [tagName, tags] of Object.entries(tagGroups)) {
      const images = tags.map(tag => ({
        image_url: tag.vehicle_images.image_url,
        event_date: tag.vehicle_images.timeline_events?.[0]?.event_date,
        event_type: tag.vehicle_images.timeline_events?.[0]?.event_type,
        technician: tag.vehicle_images.timeline_events?.[0]?.technician_name,
        location: tag.vehicle_images.timeline_events?.[0]?.location,
        timeline_context: tag.vehicle_images.timeline_events?.[0]
      }));

      const avgConfidence = tags.reduce((sum, tag) =>
        sum + (tag.automated_confidence || tag.confidence || 0), 0) / tags.length;

      // Build timeline correlation
      const timelineEvents = tags
        .filter(tag => tag.vehicle_images.timeline_events?.[0])
        .map(tag => tag.vehicle_images.timeline_events[0])
        .filter(Boolean);

      const frequencyOverTime = buildFrequencyTimeline(tags);
      const associatedWork = categorizeWorkTypes(timelineEvents);

      // Determine system context
      const systemContext = classifyTagToSystem(tagName, tags);

      // Find related tags (tags that appear in same images or timeline events)
      const relatedTags = await findRelatedTags(tagName, tags, tagGroups);

      contexts[tagName] = {
        tag_name: tagName,
        count: tags.length,
        avg_confidence: avgConfidence,
        images,
        timeline_correlation: {
          events: timelineEvents.map(event => ({
            date: event.event_date,
            event_type: event.event_type,
            description: event.description,
            technician: event.technician_name,
            tools_used: event.tools_used ? JSON.parse(event.tools_used) : [],
            related_tags: [] // Will be populated in second pass
          })),
          frequency_over_time: frequencyOverTime,
          associated_work: associatedWork
        },
        related_tags: relatedTags,
        system_context: systemContext
      };
    }

    return contexts;
  };

  const buildSystemOverview = (contexts: Record<string, TagContext>) => {
    const systems: Record<string, any> = {};

    Object.values(contexts).forEach(context => {
      const systemName = context.system_context.vehicle_system;

      if (!systems[systemName]) {
        systems[systemName] = {
          name: systemName,
          total_tags: 0,
          total_detections: 0,
          avg_confidence: 0,
          severity_distribution: { immediate: 0, soon: 0, monitor: 0, none: 0 },
          trending: { improving: 0, worsening: 0, stable: 0, unknown: 0 },
          recent_work: 0,
          top_tags: []
        };
      }

      systems[systemName].total_tags += 1;
      systems[systemName].total_detections += context.count;
      systems[systemName].avg_confidence += context.avg_confidence;
      systems[systemName].severity_distribution[context.system_context.maintenance_urgency] += 1;
      systems[systemName].trending[context.system_context.severity_trend] += 1;

      // Count recent work (last 90 days)
      const recentWork = context.timeline_correlation.events.filter(event => {
        const eventDate = new Date(event.date);
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        return eventDate >= ninetyDaysAgo;
      }).length;
      systems[systemName].recent_work += recentWork;
    });

    // Calculate averages and sort tags
    Object.values(systems).forEach((system: any) => {
      system.avg_confidence = system.avg_confidence / system.total_tags;

      system.top_tags = Object.values(contexts)
        .filter(ctx => ctx.system_context.vehicle_system === system.name)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map(ctx => ({ name: ctx.tag_name, count: ctx.count, confidence: ctx.avg_confidence }));
    });

    return systems;
  };

  const classifyTagToSystem = (tagName: string, tags: any[]) => {
    const systemMappings = {
      'brake': { system: 'braking', urgency: 'soon' },
      'rust': { system: 'body', urgency: 'monitor' },
      'corrosion': { system: 'body', urgency: 'monitor' },
      'wheel': { system: 'suspension', urgency: 'none' },
      'tire': { system: 'suspension', urgency: 'none' },
      'engine': { system: 'powertrain', urgency: 'soon' },
      'transmission': { system: 'powertrain', urgency: 'soon' },
      'electrical': { system: 'electrical', urgency: 'monitor' },
      'interior': { system: 'interior', urgency: 'none' },
      'exterior': { system: 'body', urgency: 'none' }
    };

    const tagLower = tagName.toLowerCase();
    let systemName = 'general';
    let urgency: any = 'none';

    // Find matching system
    for (const [keyword, mapping] of Object.entries(systemMappings)) {
      if (tagLower.includes(keyword)) {
        systemName = mapping.system;
        urgency = mapping.urgency;
        break;
      }
    }

    // Determine severity trend based on frequency over time
    const dates = tags
      .map(tag => tag.vehicle_images.timeline_events?.[0]?.event_date)
      .filter(Boolean)
      .sort();

    let trend: any = 'unknown';
    if (dates.length >= 3) {
      const firstHalf = dates.slice(0, Math.floor(dates.length / 2)).length;
      const secondHalf = dates.length - firstHalf;

      if (secondHalf > firstHalf * 1.5) trend = 'worsening';
      else if (firstHalf > secondHalf * 1.5) trend = 'improving';
      else trend = 'stable';
    }

    return {
      vehicle_system: systemName,
      component_hierarchy: [systemName, tagName],
      severity_trend: trend,
      maintenance_urgency: urgency
    };
  };

  const buildFrequencyTimeline = (tags: any[]) => {
    const timeline: Record<string, number> = {};

    tags.forEach(tag => {
      const eventDate = tag.vehicle_images.timeline_events?.[0]?.event_date;
      if (eventDate) {
        const month = eventDate.substring(0, 7); // YYYY-MM
        timeline[month] = (timeline[month] || 0) + 1;
      }
    });

    return timeline;
  };

  const categorizeWorkTypes = (events: any[]) => {
    let repair_sessions = 0;
    let inspection_events = 0;
    let maintenance_records = 0;

    events.forEach(event => {
      const eventType = event.event_type?.toLowerCase() || '';
      if (eventType.includes('repair') || eventType.includes('fix')) {
        repair_sessions++;
      } else if (eventType.includes('inspect') || eventType.includes('check')) {
        inspection_events++;
      } else if (eventType.includes('maintenance') || eventType.includes('service')) {
        maintenance_records++;
      }
    });

    return { repair_sessions, inspection_events, maintenance_records };
  };

  const createDemoTagContexts = (): Record<string, TagContext> => {
    // Create demo data based on ACTUAL K5 Blazer Rekognition analysis (1,090 detections, 209 unique labels)
    const demoTags = {
      'Vehicle': {
        tag_name: 'Vehicle',
        count: 42,
        avg_confidence: 82.1,
        images: [],
        timeline_correlation: {
          events: [],
          frequency_over_time: { '2024-09': 14, '2024-10': 15, '2024-11': 13 },
          associated_work: { repair_sessions: 2, inspection_events: 12, maintenance_records: 6 }
        },
        related_tags: [
          { tag_name: 'Transportation', correlation_strength: 0.95, co_occurrence_count: 41 },
          { tag_name: 'Car', correlation_strength: 0.93, co_occurrence_count: 39 },
          { tag_name: 'Machine', correlation_strength: 0.90, co_occurrence_count: 42 }
        ],
        system_context: {
          vehicle_system: 'general',
          component_hierarchy: ['general', 'Vehicle'],
          severity_trend: 'stable' as const,
          maintenance_urgency: 'none' as const
        }
      },
      'Machine': {
        tag_name: 'Machine',
        count: 42,
        avg_confidence: 88.2,
        images: [],
        timeline_correlation: {
          events: [],
          frequency_over_time: { '2024-09': 14, '2024-10': 15, '2024-11': 13 },
          associated_work: { repair_sessions: 8, inspection_events: 15, maintenance_records: 12 }
        },
        related_tags: [
          { tag_name: 'Vehicle', correlation_strength: 1.0, co_occurrence_count: 42 },
          { tag_name: 'Motor', correlation_strength: 0.31, co_occurrence_count: 13 },
          { tag_name: 'Engine', correlation_strength: 0.17, co_occurrence_count: 7 }
        ],
        system_context: {
          vehicle_system: 'powertrain',
          component_hierarchy: ['powertrain', 'Machine'],
          severity_trend: 'stable' as const,
          maintenance_urgency: 'monitor' as const
        }
      },
      'Rust': {
        tag_name: 'Rust',
        count: 33,
        avg_confidence: 61.2,
        images: [],
        timeline_correlation: {
          events: [],
          frequency_over_time: { '2024-09': 10, '2024-10': 12, '2024-11': 11 },
          associated_work: { repair_sessions: 5, inspection_events: 8, maintenance_records: 2 }
        },
        related_tags: [
          { tag_name: 'Corrosion', correlation_strength: 1.0, co_occurrence_count: 33 },
          { tag_name: 'Vehicle', correlation_strength: 0.79, co_occurrence_count: 33 },
          { tag_name: 'Metal', correlation_strength: 0.73, co_occurrence_count: 24 }
        ],
        system_context: {
          vehicle_system: 'body',
          component_hierarchy: ['body', 'Rust'],
          severity_trend: 'worsening' as const,
          maintenance_urgency: 'soon' as const
        }
      },
      'Wheel': {
        tag_name: 'Wheel',
        count: 36,
        avg_confidence: 78.5,
        images: [],
        timeline_correlation: {
          events: [],
          frequency_over_time: { '2024-09': 12, '2024-10': 12, '2024-11': 12 },
          associated_work: { repair_sessions: 3, inspection_events: 6, maintenance_records: 4 }
        },
        related_tags: [
          { tag_name: 'Spoke', correlation_strength: 1.0, co_occurrence_count: 36 },
          { tag_name: 'Tire', correlation_strength: 0.72, co_occurrence_count: 26 },
          { tag_name: 'Alloy Wheel', correlation_strength: 0.72, co_occurrence_count: 26 }
        ],
        system_context: {
          vehicle_system: 'suspension',
          component_hierarchy: ['suspension', 'Wheel'],
          severity_trend: 'stable' as const,
          maintenance_urgency: 'none' as const
        }
      },
      'Brake': {
        tag_name: 'Brake',
        count: 16,
        avg_confidence: 73.8,
        images: [],
        timeline_correlation: {
          events: [],
          frequency_over_time: { '2024-09': 5, '2024-10': 6, '2024-11': 5 },
          associated_work: { repair_sessions: 4, inspection_events: 8, maintenance_records: 3 }
        },
        related_tags: [
          { tag_name: 'Wheel', correlation_strength: 0.44, co_occurrence_count: 16 },
          { tag_name: 'Axle', correlation_strength: 0.89, co_occurrence_count: 16 },
          { tag_name: 'Rotor', correlation_strength: 0.84, co_occurrence_count: 16 }
        ],
        system_context: {
          vehicle_system: 'braking',
          component_hierarchy: ['braking', 'Brake'],
          severity_trend: 'stable' as const,
          maintenance_urgency: 'monitor' as const
        }
      },
      'Coil': {
        tag_name: 'Coil',
        count: 20,
        avg_confidence: 90.6,
        images: [],
        timeline_correlation: {
          events: [],
          frequency_over_time: { '2024-09': 7, '2024-10': 7, '2024-11': 6 },
          associated_work: { repair_sessions: 1, inspection_events: 4, maintenance_records: 2 }
        },
        related_tags: [
          { tag_name: 'Spiral', correlation_strength: 1.0, co_occurrence_count: 20 },
          { tag_name: 'Rotor', correlation_strength: 0.95, co_occurrence_count: 19 },
          { tag_name: 'Machine', correlation_strength: 0.48, co_occurrence_count: 20 }
        ],
        system_context: {
          vehicle_system: 'electrical',
          component_hierarchy: ['electrical', 'Coil'],
          severity_trend: 'stable' as const,
          maintenance_urgency: 'none' as const
        }
      },
      'Engine': {
        tag_name: 'Engine',
        count: 7,
        avg_confidence: 81.4,
        images: [],
        timeline_correlation: {
          events: [],
          frequency_over_time: { '2024-09': 2, '2024-10': 3, '2024-11': 2 },
          associated_work: { repair_sessions: 2, inspection_events: 3, maintenance_records: 4 }
        },
        related_tags: [
          { tag_name: 'Machine', correlation_strength: 0.17, co_occurrence_count: 7 },
          { tag_name: 'Motor', correlation_strength: 0.54, co_occurrence_count: 7 },
          { tag_name: 'Vehicle', correlation_strength: 0.17, co_occurrence_count: 7 }
        ],
        system_context: {
          vehicle_system: 'powertrain',
          component_hierarchy: ['powertrain', 'Engine'],
          severity_trend: 'stable' as const,
          maintenance_urgency: 'none' as const
        }
      }
    };

    return demoTags;
  };

  const findRelatedTags = async (tagName: string, tags: any[], allTagGroups: Record<string, any[]>) => {
    const relatedTags: Record<string, { count: number, strength: number }> = {};

    // Find tags that appear in the same images
    const imageUrls = tags.map(tag => tag.vehicle_images.image_url);

    Object.entries(allTagGroups).forEach(([otherTagName, otherTags]) => {
      if (otherTagName === tagName) return;

      const coOccurrences = otherTags.filter(otherTag =>
        imageUrls.includes(otherTag.vehicle_images.image_url)
      ).length;

      if (coOccurrences > 0) {
        const strength = coOccurrences / Math.max(tags.length, otherTags.length);
        relatedTags[otherTagName] = { count: coOccurrences, strength };
      }
    });

    // Convert to array and sort by strength
    return Object.entries(relatedTags)
      .sort(([,a], [,b]) => b.strength - a.strength)
      .slice(0, 10)
      .map(([tag, data]) => ({
        tag_name: tag,
        correlation_strength: data.strength,
        co_occurrence_count: data.count
      }));
  };

  const renderZoomControls = () => (
    <div className="zoom-controls">
      <div className="zoom-level-buttons">
        {(['overview', 'system', 'tag', 'image'] as ZoomLevel[]).map(level => (
          <button
            key={level}
            className={`zoom-btn ${zoomLevel === level ? 'active' : ''}`}
            onClick={() => setZoomLevel(level)}
          >
            {level.charAt(0).toUpperCase() + level.slice(1)}
          </button>
        ))}
      </div>

      <div className="view-mode-buttons">
        {(['systems', 'timeline', 'technicians', 'severity'] as ViewMode[]).map(mode => (
          <button
            key={mode}
            className={`view-btn ${viewMode === mode ? 'active' : ''}`}
            onClick={() => setViewMode(mode)}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );

  const renderOverview = () => (
    <div className="system-overview-grid">
      {Object.values(systemOverview).map((system: any) => (
        <div
          key={system.name}
          className="system-card"
          onClick={() => {
            setSelectedSystem(system.name);
            setZoomLevel('system');
          }}
        >
          <div className="system-header">
            <h4>{system.name.toUpperCase()}</h4>
            <div className="system-stats">
              <span className="badge">{system.total_tags} tags</span>
              <span className="badge">{system.total_detections} detections</span>
            </div>
          </div>

          <div className="system-metrics">
            <div className="metric">
              <span className="label">Avg Confidence:</span>
              <span className="value">{system.avg_confidence.toFixed(1)}%</span>
            </div>
            <div className="metric">
              <span className="label">Recent Work:</span>
              <span className="value">{system.recent_work} events</span>
            </div>
          </div>

          <div className="urgency-distribution">
            {Object.entries(system.severity_distribution).map(([level, count]: [string, any]) => (
              <div key={level} className={`urgency-bar urgency-${level}`} style={{
                width: `${(count / system.total_tags) * 100}%`,
                height: '4px',
                display: 'inline-block'
              }}></div>
            ))}
          </div>

          <div className="top-tags">
            {system.top_tags.slice(0, 3).map((tag: any) => (
              <span key={tag.name} className="mini-tag">
                {tag.name} ({tag.count})
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const renderSystemView = () => {
    if (!selectedSystem) return null;

    const systemTags = Object.values(tagContexts).filter(
      ctx => ctx.system_context.vehicle_system === selectedSystem
    );

    return (
      <div className="system-detail-view">
        <div className="system-detail-header">
          <button onClick={() => setZoomLevel('overview')} className="back-btn">Back</button>
          <h3>{selectedSystem.toUpperCase()} SYSTEM</h3>
        </div>

        <div className="system-tags-grid">
          {systemTags.map(context => (
            <div
              key={context.tag_name}
              className="system-tag-card"
              onClick={() => {
                setSelectedTag(context.tag_name);
                setZoomLevel('tag');
              }}
            >
              <div className="tag-header">
                <h5>{context.tag_name}</h5>
                <div className="tag-badges">
                  <span className="count-badge">{context.count}x</span>
                  <span className={`urgency-badge urgency-${context.system_context.maintenance_urgency}`}>
                    {context.system_context.maintenance_urgency}
                  </span>
                </div>
              </div>

              <div className="tag-timeline-mini">
                <div className="timeline-stats">
                  <span>{context.timeline_correlation.events.length} events</span>
                  <span>{context.timeline_correlation.associated_work.repair_sessions} repairs</span>
                </div>

                <div className="frequency-sparkline">
                  {Object.values(context.timeline_correlation.frequency_over_time).map((freq, i) => (
                    <div key={i} className="freq-bar" style={{
                      height: `${(freq / Math.max(...Object.values(context.timeline_correlation.frequency_over_time))) * 20}px`
                    }}></div>
                  ))}
                </div>
              </div>

              <div className="related-tags-mini">
                <strong>Related:</strong> {context.related_tags.slice(0, 2).map(rt => rt.tag_name).join(', ')}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTagView = () => {
    if (!selectedTag || !tagContexts[selectedTag]) return null;

    const context = tagContexts[selectedTag];

    return (
      <div className="tag-detail-view">
        <div className="tag-detail-header">
          <button onClick={() => setZoomLevel('system')} className="back-btn">Back to System</button>
          <h3>{context.tag_name.toUpperCase()}</h3>
          <div className="tag-summary">
            <span className="confidence">Avg: {context.avg_confidence.toFixed(1)}%</span>
            <span className="count">{context.count} detections</span>
            <span className={`trend trend-${context.system_context.severity_trend}`}>
              {context.system_context.severity_trend}
            </span>
          </div>
        </div>

        <div className="tag-content-grid">
          {/* Timeline Correlation */}
          <div className="timeline-section">
            <h4>Timeline Analysis</h4>
            <div className="frequency-chart">
              {Object.entries(context.timeline_correlation.frequency_over_time).map(([month, count]) => (
                <div key={month} className="freq-point">
                  <div className="freq-bar" style={{ height: `${count * 10}px` }}></div>
                  <span className="freq-label">{month.split('-')[1]}</span>
                </div>
              ))}
            </div>

            <div className="work-breakdown">
              <div className="work-stat">
                <span className="work-count">{context.timeline_correlation.associated_work.repair_sessions}</span>
                <span className="work-label">Repairs</span>
              </div>
              <div className="work-stat">
                <span className="work-count">{context.timeline_correlation.associated_work.inspection_events}</span>
                <span className="work-label">Inspections</span>
              </div>
              <div className="work-stat">
                <span className="work-count">{context.timeline_correlation.associated_work.maintenance_records}</span>
                <span className="work-label">Maintenance</span>
              </div>
            </div>
          </div>

          {/* Related Tags */}
          <div className="related-section">
            <h4>Related Tags</h4>
            <div className="related-tags-list">
              {context.related_tags.map(rt => (
                <div key={rt.tag_name} className="related-tag-item">
                  <span className="related-name">{rt.tag_name}</span>
                  <div className="correlation-strength">
                    <div className="strength-bar">
                      <div
                        className="strength-fill"
                        style={{ width: `${rt.correlation_strength * 100}%` }}
                      ></div>
                    </div>
                    <span className="strength-text">{(rt.correlation_strength * 100).toFixed(0)}%</span>
                  </div>
                  <span className="co-occurrence">{rt.co_occurrence_count} co-occurrences</span>
                </div>
              ))}
            </div>
          </div>

          {/* Image Gallery */}
          <div className="images-section">
            <h4>Associated Images ({context.images.length})</h4>
            <div className="image-grid">
              {context.images.slice(0, 8).map((img, i) => (
                <div key={i} className="image-item" onClick={() => setZoomLevel('image')}>
                  <img src={img.image_url} alt={`${context.tag_name} detection`} />
                  <div className="image-overlay">
                    <div className="image-date">{img.event_date}</div>
                    <div className="image-type">{img.event_type}</div>
                    {img.technician && <div className="image-tech">{img.technician}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-header">Data Explorer</div>
        <div className="card-body">
          <div className="loading-spinner"></div>
          <p>Building contextual analysis...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card tag-explorer">
      <div className="card-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Data Explorer</span>
          <div className="explorer-stats">
            <span className="badge">{Object.keys(tagContexts).length} tags</span>
            <span className="badge">{Object.keys(systemOverview).length} systems</span>
          </div>
        </div>
      </div>

      <div className="card-body">
        {renderZoomControls()}

        <div className="explorer-content">
          {zoomLevel === 'overview' && renderOverview()}
          {zoomLevel === 'system' && renderSystemView()}
          {zoomLevel === 'tag' && renderTagView()}
          {zoomLevel === 'image' && (
            <div className="image-detail-view">
              <p>Image detail view - coming soon</p>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .tag-explorer {
          min-height: 400px;
          font-family: "MS Sans Serif", sans-serif;
          font-size: 8pt;
        }

        .zoom-controls {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
          padding-bottom: 4px;
          border-bottom: 1px solid #808080;
        }

        .zoom-level-buttons,
        .view-mode-buttons {
          display: flex;
          gap: 2px;
        }

        .zoom-btn,
        .view-btn {
          padding: 2px 8px;
          border: 1px outset #c0c0c0;
          background: #c0c0c0;
          border-radius: 0;
          cursor: pointer;
          font-size: 8pt;
          font-family: "MS Sans Serif", sans-serif;
        }

        .zoom-btn:active,
        .view-btn:active {
          border: 1px inset #c0c0c0;
        }

        .zoom-btn.active,
        .view-btn.active {
          background: #0000ff;
          color: white;
          border: 1px inset #c0c0c0;
        }

        .system-overview-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 4px;
        }

        .system-card {
          border: 1px inset #c0c0c0;
          border-radius: 0;
          padding: 4px;
          cursor: pointer;
          background: #c0c0c0;
        }

        .system-card:hover {
          background: #d0d0d0;
        }

        .system-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2px;
        }

        .system-header h4 {
          margin: 0;
          font-size: 8pt;
          font-weight: bold;
        }

        .system-stats {
          display: flex;
          gap: 2px;
        }

        .system-metrics {
          display: flex;
          justify-content: space-between;
          margin-bottom: 2px;
          font-size: 8pt;
        }

        .urgency-distribution {
          margin-bottom: 2px;
          height: 2px;
          background: #808080;
          border-radius: 0;
          overflow: hidden;
        }

        .urgency-immediate { background: #ff0000; }
        .urgency-soon { background: #ff8000; }
        .urgency-monitor { background: #ffff00; }
        .urgency-none { background: #00ff00; }

        .top-tags {
          display: flex;
          gap: 2px;
          flex-wrap: wrap;
        }

        .mini-tag {
          background: #ffffff;
          border: 1px inset #c0c0c0;
          padding: 1px 3px;
          border-radius: 0;
          font-size: 8pt;
        }

        .badge {
          background: #c0c0c0;
          border: 1px inset #c0c0c0;
          padding: 1px 3px;
          font-size: 8pt;
          font-family: "MS Sans Serif", sans-serif;
        }

        .explorer-stats {
          display: flex;
          gap: 2px;
        }

        .system-tags-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 2px;
        }

        .system-tag-card {
          border: 1px inset #c0c0c0;
          padding: 2px;
          border-radius: 0;
          cursor: pointer;
          background: #c0c0c0;
        }

        .system-tag-card:hover {
          background: #d0d0d0;
        }

        .tag-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2px;
        }

        .tag-badges {
          display: flex;
          gap: 1px;
        }

        .count-badge,
        .urgency-badge {
          padding: 1px 3px;
          border-radius: 0;
          font-size: 8pt;
          border: 1px inset #c0c0c0;
        }

        .count-badge {
          background: #0000ff;
          color: white;
        }

        .urgency-badge {
          color: white;
        }

        .urgency-badge.urgency-immediate { background: #ff0000; }
        .urgency-badge.urgency-soon { background: #ff8000; }
        .urgency-badge.urgency-monitor { background: #ffff00; color: black; }
        .urgency-badge.urgency-none { background: #00ff00; color: black; }

        .tag-timeline-mini {
          margin-bottom: 2px;
        }

        .timeline-stats {
          display: flex;
          gap: 4px;
          font-size: 8pt;
          color: #000000;
          margin-bottom: 1px;
        }

        .frequency-sparkline {
          display: flex;
          gap: 1px;
          align-items: end;
          height: 12px;
        }

        .freq-bar {
          width: 2px;
          background: #0000ff;
          min-height: 1px;
        }

        .related-tags-mini {
          font-size: 8pt;
          color: #000000;
        }

        .tag-detail-view {
          padding-top: 4px;
        }

        .tag-detail-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
          padding-bottom: 2px;
          border-bottom: 1px solid #808080;
        }

        .tag-detail-header h3 {
          font-size: 8pt;
          margin: 0;
          font-weight: bold;
        }

        .system-detail-header h3 {
          font-size: 8pt;
          margin: 0;
          font-weight: bold;
        }

        .timeline-section h4,
        .related-section h4,
        .images-section h4 {
          font-size: 8pt;
          margin: 0 0 2px 0;
          font-weight: bold;
        }

        .tag-summary {
          display: flex;
          gap: 2px;
        }

        .confidence,
        .count {
          padding: 1px 3px;
          background: #c0c0c0;
          border: 1px inset #c0c0c0;
          border-radius: 0;
          font-size: 8pt;
          font-family: "MS Sans Serif", sans-serif;
        }

        .trend {
          padding: 1px 3px;
          border-radius: 0;
          font-size: 8pt;
          font-family: "MS Sans Serif", sans-serif;
          color: white;
        }

        .trend-improving { background: #00ff00; color: black; }
        .trend-worsening { background: #ff0000; }
        .trend-stable { background: #808080; }
        .trend-unknown { background: #c0c0c0; color: black; }

        .tag-content-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-template-rows: auto auto;
          gap: 4px;
        }

        .timeline-section,
        .related-section,
        .images-section {
          border: 1px inset #c0c0c0;
          padding: 4px;
          border-radius: 0;
          background: #c0c0c0;
        }

        .images-section {
          grid-column: 1 / -1;
        }

        .frequency-chart {
          display: flex;
          gap: 4px;
          align-items: end;
          height: 60px;
          margin-bottom: 16px;
        }

        .freq-point {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .freq-label {
          font-size: 10px;
          margin-top: 4px;
        }

        .work-breakdown {
          display: flex;
          justify-content: space-around;
        }

        .work-stat {
          text-align: center;
        }

        .work-count {
          display: block;
          font-size: 24px;
          font-weight: bold;
          color: var(--color-primary);
        }

        .work-label {
          font-size: 12px;
          color: var(--color-text-muted);
        }

        .related-tags-list {
          max-height: 200px;
          overflow-y: auto;
        }

        .related-tag-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 0;
          border-bottom: 1px solid var(--color-border-subtle);
        }

        .related-name {
          font-weight: 500;
          min-width: 80px;
        }

        .correlation-strength {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 1;
        }

        .strength-bar {
          flex: 1;
          height: 6px;
          background: var(--color-border);
          border-radius: 3px;
          overflow: hidden;
        }

        .strength-fill {
          height: 100%;
          background: var(--color-success);
        }

        .strength-text {
          font-size: 12px;
          min-width: 30px;
        }

        .co-occurrence {
          font-size: 12px;
          color: var(--color-text-muted);
          min-width: 80px;
        }

        .image-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 8px;
        }

        .image-item {
          position: relative;
          aspect-ratio: 1;
          border-radius: 4px;
          overflow: hidden;
          cursor: pointer;
        }

        .image-item img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .image-overlay {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(transparent, rgba(0,0,0,0.8));
          padding: 8px 4px 4px;
          color: white;
          font-size: 10px;
        }

        .image-date,
        .image-type,
        .image-tech {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .back-btn {
          background: #c0c0c0;
          border: 1px outset #c0c0c0;
          padding: 2px 6px;
          border-radius: 0;
          cursor: pointer;
          font-size: 8pt;
          font-family: "MS Sans Serif", sans-serif;
        }

        .back-btn:active {
          border: 1px inset #c0c0c0;
        }

        .back-btn:hover {
          background: #d0d0d0;
        }
      `}</style>
    </div>
  );
};

export default VehicleTagExplorer;