import React, { useMemo, useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import type { UserContribution } from '../../types/profile';

interface ContributionTimelineProps {
  contributions: UserContribution[];
  onTotalCalculated?: (total: number) => void;
}

const ContributionTimeline: React.FC<ContributionTimelineProps> = ({ contributions, onTotalCalculated }) => {
  const [selectedDayContributions, setSelectedDayContributions] = useState<UserContribution[]>([]);
  const [showDayPopup, setShowDayPopup] = useState(false);
  const [vehicleDetails, setVehicleDetails] = useState<Map<string, any>>(new Map());
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
  const year = new Date().getFullYear();
  
  // Quiet heavy debug logging in production; keep component lightweight for mobile

  // Early return if no contributions - show an empty state quickly
  if (!contributions || contributions.length === 0) {
    return (
      <div className="card">
        <div className="card-header">
          <h3 className="text font-bold">0 contributions in {year}</h3>
        </div>
        <div className="card-body">
          <div className="text-small text-muted">No contributions yet this year.</div>
          {/* Keep empty state minimal; avoid noisy debug details */}
        </div>
      </div>
    );
  }

  // Render with given data

  // Helper: normalize any date-ish value to YYYY-MM-DD without timezone shifting
  const toDateOnly = (raw: any): string => {
    if (!raw) return new Date().toISOString().split('T')[0];
    try {
      const s = String(raw);
      if (s.includes('T')) return s.split('T')[0];
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    } catch {}
    return new Date().toISOString().split('T')[0];
  };

  // Generate last 365 days ending today (GitHub-style)
  const generateDateRange = () => {
    const dates: string[] = [];
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 364); // 365 days total including today
    
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      dates.push(new Date(d).toISOString().split('T')[0]);
    }
    return dates;
  };

  const dateRange = useMemo(() => generateDateRange(), []);
  
  // Create per-day intensity (hours) using EXACT same logic as VehicleTimeline
  // This ensures user's contribution heatmap matches what appears on vehicle timelines
  // VehicleTimeline logic:
  // - images: hours += min(9, images/20) + 0.25 baseline
  // - every contribution adds 0.25
  // - cap at 12 hours max
  const daily = useMemo(() => {
    const map = new Map<string, { count: number; hours: number; types: Set<string> }>();
    for (const c of contributions) {
      const date = toDateOnly(c.contribution_date);
      const entry = map.get(date) || { count: 0, hours: 0, types: new Set() };
      entry.types.add(c.contribution_type);
      entry.count += c.contribution_count;
      if (c.contribution_type === 'image_upload') {
        entry.hours += Math.min(9, c.contribution_count / 20);
        entry.hours += 0.25;
      } else if (c.contribution_type === 'vehicle_data') {
        entry.hours += 0.25 * c.contribution_count;
      } else if (c.contribution_type === 'verification') {
        entry.hours += 0.5 * c.contribution_count;
      } else {
        entry.hours += 0.25 * c.contribution_count;
      }
      entry.hours = Math.min(12, entry.hours);
      map.set(date, entry);
    }
    return map;
  }, [contributions]);

  // Build list of years for navigation - show broader range like VehicleTimeline
  // Include years from contributions plus a reasonable range around current year
  const contributionYears = contributions.length > 0 
    ? Array.from(new Set(contributions.map(c => new Date(c.contribution_date).getFullYear())))
    : [];
  
  const currentYear = new Date().getFullYear();
  const minYear = contributionYears.length > 0 ? Math.min(...contributionYears, currentYear - 2) : currentYear - 2;
  const maxYear = contributionYears.length > 0 ? Math.max(...contributionYears, currentYear) : currentYear;
  
  // Generate year range from minYear to maxYear
  const yearIndex: number[] = [];
  for (let y = maxYear; y >= minYear; y--) {
    yearIndex.push(y);
  }
  
  const [selectedYear, setSelectedYear] = useState<number | null>(yearIndex[0] || year);
  
  const selectYear = (y: number) => {
    setSelectedYear(y);
  };

  const handleDayClick = async (date: Date) => {
    const dayYmd = date.toISOString().slice(0, 10);
    const dayContributions = contributions.filter(c => 
      toDateOnly(c.contribution_date) === dayYmd
    );
    
    if (dayContributions.length > 0) {
      setSelectedDayContributions(dayContributions);
      setShowDayPopup(true);
      
      // Fetch vehicle details for these contributions
      const vehicleIds = [...new Set(dayContributions.map(c => c.related_vehicle_id).filter((id): id is string => !!id))];
      const newDetails = new Map(vehicleDetails);
      
      for (const vehicleId of vehicleIds) {
        if (!newDetails.has(vehicleId)) {
          const { data } = await supabase
            .from('vehicles')
            .select('id, year, make, model')
            .eq('id', vehicleId)
            .single();
          
          if (data) {
            // Also get lead image
            const { data: images } = await supabase
              .from('vehicle_images')
              .select('image_url')
              .eq('vehicle_id', vehicleId)
              .order('created_at', { ascending: true })
              .limit(1);
            
            newDetails.set(vehicleId, {
              ...data,
              image_url: images?.[0]?.image_url
            });
          }
        }
      }
      
      setVehicleDetails(newDetails);
    }
  };

  // Calculate streaks
  const calculateMaxStreak = (): number => {
    let maxStreak = 0;
    let currentStreak = 0;

    dateRange.forEach(date => {
      const count = daily.get(date)?.count || 0;
      if (count > 0) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    });

    return maxStreak;
  };

  const calculateCurrentStreak = (): number => {
    let streak = 0;
    const today = new Date().toISOString().split('T')[0];

    for (let i = dateRange.length - 1; i >= 0; i--) {
      const date = dateRange[i];
      const count = daily.get(date)?.count || 0;

      if (date <= today && count > 0) {
        streak++;
      } else if (date <= today) {
        break;
      }
    }

    return streak;
  };

  // Use same thresholds/colors as VehicleTimeline heat shading
  const colorForHours = (h: number) => {
    if (h <= 0) return '#ebedf0';
    if (h < 1) return '#d9f99d';
    if (h < 3) return '#a7f3d0';
    if (h < 6) return '#34d399';
    return '#059669';
  };

  const maxStreak = calculateMaxStreak();
  const currentStreak = calculateCurrentStreak();
  const totalContributions = contributions.reduce((sum, contrib) => sum + contrib.contribution_count, 0);
  const currentTopYear = yearIndex[0];
  const targetYear = selectedYear ?? currentTopYear;

  // Calculate accurate totals based on actual data
  const totalHours = Array.from(daily.values()).reduce((sum, d) => sum + d.hours, 0);
  const activeDays = daily.size;
  const contributionTypes = [...new Set(contributions.map(c => c.contribution_type))];

  return (
    <div className="card">
      <div className="card-body" style={{ padding: 'var(--space-2)' }}>
        {/* Compact stats row */}
        <div className="text-small" style={{ 
          display: 'flex', 
          gap: 'var(--space-4)', 
          marginBottom: 'var(--space-2)'
        }}>
          <span>Hours: <strong>{totalHours.toFixed(1)}</strong></span>
          <span>Active days: <strong>{activeDays}</strong></span>
          {maxStreak > 0 && <span>Streak: <strong>{maxStreak}d</strong></span>}
          <span>Types: <strong>{contributionTypes.join(', ')}</strong></span>
        </div>

        {/* Timeline Container with VehicleTimeline Layout */}
        <div className="timeline-container" style={{ position: 'relative' }}>
          <div>
            {/* Year-based timeline grid - render only selected year */}
            {(() => {
              if (!targetYear) return null;
              
              return (
                <div key={targetYear} id={`year-${targetYear}`} className="bg-white rounded-lg p-2">
                  {/* Months header positioned above everything */}
                  <div style={{ marginLeft: '30px', marginBottom: '2px' }}>
                    <div 
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(53, 12px)',
                        gap: '2px',
                        justifyContent: 'start'
                      }}
                    >
                      {/* Month labels - each month gets ~4.4 columns (53 weeks / 12 months) */}
                      {Array.from({ length: 12 }, (_, monthIndex) => {
                        const startWeek = Math.floor((monthIndex * 53) / 12);
                        const endWeek = Math.floor(((monthIndex + 1) * 53) / 12);
                        const monthWidth = endWeek - startWeek;
                        
                        return (
                          <div 
                            key={monthIndex}
                            style={{
                              gridColumn: `${startWeek + 1} / span ${monthWidth}`,
                              textAlign: 'center',
                              fontSize: '8pt',
                              color: '#888888',
                              lineHeight: '8px'
                            }}
                          >
                            {monthIndex + 1}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  
                  {/* Timeline Grid and Years in columns */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--space-3)' }}>
                    {/* Timeline grid column */}
                    <div>
                      {/* Vertical Day Grid: 7 days horizontal × 53 weeks vertical */}
                      {(() => {
                        const jan1 = new Date(targetYear, 0, 1);
                        const gridStart = new Date(jan1);
                        gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // Sunday on/before Jan 1
                        const totalWeeks = 53;

                        return (
                          <div>
                            {/* Timeline grid */}
                            <div>
                              <div 
                                className="timeline-grid"
                                style={{ 
                                  display: 'grid',
                                  gridTemplateRows: 'repeat(7, 12px)',
                                  gridTemplateColumns: `repeat(${Math.min(53, totalWeeks)}, 12px)`,
                                  gap: '2px',
                                  justifyContent: 'start'
                                }}
                              >
                              {/* Day boxes: fill column-first (vertically down, then next column) */}
                              {Array.from({ length: totalWeeks * 7 }, (_, idx) => {
                                // Calculate column-first position
                                const weekIdx = Math.floor(idx / 7);
                                const dayIdx = idx % 7;
                                
                                const date = new Date(gridStart);
                                date.setDate(date.getDate() + weekIdx * 7 + dayIdx);
                                const inYear = date.getFullYear() === targetYear;
                                const dayYmd = date.toISOString().slice(0,10);
                                const entry = inYear ? daily.get(dayYmd) : undefined;
                                const hours = entry?.hours || 0;
                                const clickable = (entry?.count || 0) > 0;

                                return (
                                  <div
                                    key={idx}
                                    title={`${date.toLocaleDateString()}: ${clickable ? `${entry?.count || 0} contributions • ~${hours.toFixed(1)} hrs${entry?.types ? ` • ${Array.from(entry.types).join(', ')}` : ''}` : 'No contributions'}`}
                                    className={clickable ? 'hover:ring-2 hover:ring-blue-300 transition-all cursor-pointer' : ''}
                                    onClick={() => {
                                      if (clickable) {
                                        handleDayClick(date);
                                      }
                                    }}
                                    style={{
                                      gridRow: dayIdx + 1,
                                      gridColumn: weekIdx + 1,
                                      width: '12px',
                                      height: '12px',
                                      backgroundColor: inYear ? colorForHours(hours) : '#f5f5f5',
                                      borderRadius: '2px',
                                      border: clickable ? '1px solid rgba(0,0,0,0.1)' : 'none',
                                      opacity: inYear ? 1 : 0.3
                                    }}
                                  />
                                );
                              })}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    
                    {/* Years in columns on the right */}
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(3, auto)', 
                      gap: 'var(--space-2)',
                      paddingLeft: 'var(--space-2)'
                    }}>
                      {yearIndex.map((y, index) => (
                        <button
                          key={y}
                          className={`text-small ${selectedYear === y ? 'font-bold' : 'text-muted'}`}
                          style={{ 
                            padding: 'var(--space-1) var(--space-2)', 
                            fontSize: '8pt', 
                            background: selectedYear === y ? 'var(--grey-200)' : 'transparent',
                            border: selectedYear === y ? '1px inset var(--border-medium)' : 'none',
                            borderRadius: '2px',
                            cursor: 'pointer',
                            minWidth: '45px',
                            textAlign: 'center'
                          }}
                          onClick={() => selectYear(y)}
                        >
                          {y}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 4,
          marginTop: 'var(--space-2)',
          fontSize: 'var(--font-size-small)',
          color: 'var(--text-muted)'
        }}>
          <span className="text-small">Less</span>
          {[0, 0.5, 2, 4.5, 8].map(level => (
            <div
              key={level}
              style={{
                width: 11,
                height: 11,
                backgroundColor: colorForHours(level),
                border: '1px solid var(--border-light)',
                borderRadius: 2
              }}
            />
          ))}
          <span className="text-small">More</span>
        </div>

        {/* Day Contributions Popup */}
        {showDayPopup && selectedDayContributions.length > 0 && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center"
            style={{ zIndex: 1001 }}
            onClick={() => setShowDayPopup(false)}
          >
            <div
            className="card"
            style={{ maxWidth: '800px', width: '90%', maxHeight: '80vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <button 
                    className="button button-secondary button-small"
                    onClick={() => {
                      const currentDate = new Date(selectedDayContributions[0].contribution_date);
                      currentDate.setDate(currentDate.getDate() - 1);
                      handleDayClick(currentDate);
                    }}
                  >
                    ← Prev Day
                  </button>
                  <h4 className="text font-bold">
                    {new Date(selectedDayContributions[0].contribution_date).toLocaleDateString()}
                  </h4>
                  <button 
                    className="button button-secondary button-small"
                    onClick={() => {
                      const currentDate = new Date(selectedDayContributions[0].contribution_date);
                      currentDate.setDate(currentDate.getDate() + 1);
                      handleDayClick(currentDate);
                    }}
                  >
                    Next Day →
                  </button>
                </div>
                <button 
                  className="button button-secondary button-small" 
                  onClick={() => setShowDayPopup(false)}
                >
                  ×
                </button>
              </div>
              
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '8pt' }}>
                {selectedDayContributions.map((contribution, index) => {
                  const vehicle = contribution.related_vehicle_id ? vehicleDetails.get(contribution.related_vehicle_id) : null;
                  const metadata = contribution.metadata || {};
                  const photoCount = metadata.photo_count || contribution.contribution_count;
                  const duration = metadata.duration_minutes;
                  const cost = metadata.cost_amount;
                  
                  // Debug: Log when vehicle data is missing
                  if (contribution.related_vehicle_id && !vehicle) {
                    console.log('Missing vehicle data for:', contribution.related_vehicle_id, contribution);
                  }
                  
                  return (
                    <div key={`${contribution.id}-${index}`} style={{ 
                      border: '1px solid var(--border-light)', 
                      padding: 'var(--space-2)',
                      background: 'var(--white)'
                    }}>
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        {/* Vehicle Image - Thumbnail with click to enlarge */}
                        {vehicle?.image_url && (
                          <img 
                            src={`${vehicle.image_url}${vehicle.image_url.includes('supabase') ? '?width=160&height=160' : ''}`}
                            alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                            style={{ 
                              width: '80px', 
                              height: '80px', 
                              objectFit: 'cover',
                              cursor: 'pointer',
                              border: '1px solid var(--border-medium)'
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEnlargedImage(vehicle.image_url);
                            }}
                            loading="lazy"
                          />
                        )}
                        
                        <div style={{ flex: 1 }}>
                          {/* Vehicle Name */}
                          {vehicle ? (
                            <a 
                              href={`/vehicle/${contribution.related_vehicle_id}`}
                              className="text font-bold"
                              style={{ display: 'block', marginBottom: 'var(--space-1)' }}
                            >
                              {vehicle.year} {vehicle.make} {vehicle.model}
                            </a>
                          ) : contribution.related_vehicle_id ? (
                            <div className="text text-muted" style={{ marginBottom: 'var(--space-1)' }}>
                              Vehicle ID: {contribution.related_vehicle_id.substring(0, 8)}...
                            </div>
                          ) : null}
                          
                          {/* Event Title/Description */}
                          <div className="text" style={{ marginBottom: 'var(--space-1)' }}>
                            {metadata.title || metadata.event_type?.replace('_', ' ') || contribution.contribution_type.replace('_', ' ')}
                            {metadata.description && (
                              <div className="text text-muted">{metadata.description}</div>
                            )}
                          </div>
                          
                          {/* Stats Row */}
                          <div className="text" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            {photoCount > 0 && (
                              <span>{photoCount} photo{photoCount > 1 ? 's' : ''}</span>
                            )}
                            {duration && (
                              <span>{duration} min</span>
                            )}
                            {cost && (
                              <span>${cost.toLocaleString()}</span>
                            )}
                            <span style={{ marginLeft: 'auto' }}>
                              {new Date(contribution.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div className="card-footer" style={{ textAlign: 'center' }}>
                <div className="text">
                  Total: {selectedDayContributions.reduce((sum, c) => sum + c.contribution_count, 0)} contributions
                </div>
                <div className="text text-muted">
                  Types: {[...new Set(selectedDayContributions.map(c => c.contribution_type))].join(', ')}
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Image Enlargement Modal */}
        {enlargedImage && (
          <div
            className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center"
            style={{ zIndex: 1002 }}
            onClick={() => setEnlargedImage(null)}
          >
            <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
              <button
                className="button button-secondary"
                style={{ position: 'absolute', top: '-40px', right: '0', color: 'white' }}
                onClick={() => setEnlargedImage(null)}
              >
                Close
              </button>
              <img
                src={enlargedImage}
                alt="Enlarged view"
                style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain' }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ContributionTimeline;
