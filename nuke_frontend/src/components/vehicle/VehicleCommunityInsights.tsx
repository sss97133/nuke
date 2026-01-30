import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { PartsListingCard } from '../parts/PartsListingCard';
import {
  trackAndOpenAffiliateLink,
  getSourceColor
} from '../../services/affiliateTrackingService';

interface VehicleCommunityInsightsProps {
  vehicleId: string;
  make?: string;
  model?: string;
  year?: number;
  userId?: string;
}

interface CommonIssue {
  id: string;
  pattern: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  frequency: number;
  affectedYears?: string;
}

interface PartResult {
  id: string;
  name: string;
  category: string;
  oemPartNumber?: string;
  laborEstimate: {
    hoursMin: number;
    hoursMax: number;
    difficulty: string;
    diyPossible: boolean;
  };
  pricing: {
    minPrice: number | null;
    maxPrice: number | null;
    avgPrice: number | null;
    newAvg: number | null;
    usedAvg: number | null;
    remanAvg: number | null;
    sourceCount: number;
  };
  sources: Array<{
    name: string;
    price: number | null;
    condition: string;
    url: string;
    affiliateUrl: string;
    inStock: boolean;
    shippingCost: number | null;
    freeShipping: boolean;
  }>;
  urgency: string;
  failureRisk: string;
}

interface SponsoredPlacement {
  id: string;
  sponsorName: string;
  sponsorLogoUrl: string | null;
  headline: string;
  description: string | null;
  ctaText: string;
  destinationUrl: string;
}

interface LaborEstimate {
  hoursMin: number;
  hoursMax: number;
  difficulty: string;
  costMin: number;
  costMax: number;
  shopRate: number;
}

interface PartsLookupResponse {
  success: boolean;
  parts: PartResult[];
  sponsored: SponsoredPlacement[];
  laborEstimate: LaborEstimate | null;
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; icon: string }> = {
  critical: { bg: '#fef2f2', text: '#991b1b', border: '#fecaca', icon: '!!' },
  high: { bg: '#fff7ed', text: '#9a3412', border: '#fed7aa', icon: '!' },
  medium: { bg: '#fefce8', text: '#854d0e', border: '#fef08a', icon: '*' },
  low: { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0', icon: 'i' }
};

// Common issues database (would typically come from backend)
const COMMON_ISSUES: Record<string, CommonIssue[]> = {
  'porsche_911': [
    { id: '1', pattern: 'IMS bearing', description: 'Intermediate shaft bearing prone to failure', severity: 'critical', frequency: 85, affectedYears: '1997-2008' },
    { id: '2', pattern: 'air oil separator', description: 'AOS failure causes oil consumption and smoke', severity: 'high', frequency: 65, affectedYears: '1999-2012' },
    { id: '3', pattern: 'rear main seal', description: 'RMS leak at transmission bell housing', severity: 'medium', frequency: 55 },
  ],
  'porsche_boxster': [
    { id: '1', pattern: 'IMS bearing', description: 'Intermediate shaft bearing prone to failure', severity: 'critical', frequency: 85, affectedYears: '1997-2008' },
    { id: '2', pattern: 'coolant leak', description: 'Coolant pipe failures in engine bay', severity: 'high', frequency: 70 },
    { id: '3', pattern: 'air oil separator', description: 'AOS failure causes oil consumption', severity: 'medium', frequency: 60 },
  ],
  'porsche_cayman': [
    { id: '1', pattern: 'IMS bearing', description: 'Intermediate shaft bearing prone to failure', severity: 'critical', frequency: 80, affectedYears: '2006-2008' },
    { id: '2', pattern: 'air oil separator', description: 'AOS failure causes oil consumption', severity: 'medium', frequency: 55 },
  ],
  'default': [
    { id: '1', pattern: 'power steering', description: 'Power steering pump or rack issues', severity: 'medium', frequency: 40 },
    { id: '2', pattern: 'coolant leak', description: 'Cooling system leaks and failures', severity: 'high', frequency: 45 },
    { id: '3', pattern: 'brake squeal', description: 'Brake pad wear or rotor issues', severity: 'low', frequency: 35 },
  ]
};

export const VehicleCommunityInsights: React.FC<VehicleCommunityInsightsProps> = ({
  vehicleId,
  make,
  model,
  year,
  userId
}) => {
  const [issues, setIssues] = useState<CommonIssue[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<CommonIssue | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ top: number; left: number } | null>(null);
  const [partsData, setPartsData] = useState<PartsLookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const issueRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Load common issues for this vehicle
  useEffect(() => {
    if (make && model) {
      const key = `${make.toLowerCase()}_${model.toLowerCase()}`;
      const vehicleIssues = COMMON_ISSUES[key] || COMMON_ISSUES['default'];

      // Filter by year if applicable
      const filteredIssues = vehicleIssues.filter(issue => {
        if (!issue.affectedYears || !year) return true;
        const [startYear, endYear] = issue.affectedYears.split('-').map(Number);
        return year >= startYear && year <= endYear;
      });

      setIssues(filteredIssues);
    } else {
      setIssues(COMMON_ISSUES['default']);
    }
  }, [make, model, year]);

  // Close popup on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        closePopup();
      }
    };

    if (selectedIssue) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [selectedIssue]);

  // Close popup on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePopup();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const openPopup = async (issue: CommonIssue, buttonElement: HTMLButtonElement) => {
    setSelectedIssue(issue);

    // Calculate popup position
    const rect = buttonElement.getBoundingClientRect();
    const popupWidth = 400;
    const popupHeight = 500;

    let left = rect.right + 10;
    let top = rect.top;

    // Adjust if popup would go off screen
    if (left + popupWidth > window.innerWidth) {
      left = rect.left - popupWidth - 10;
    }
    if (top + popupHeight > window.innerHeight) {
      top = window.innerHeight - popupHeight - 20;
    }

    setPopupPosition({ top, left });

    // Fetch parts data
    await fetchPartsData(issue.pattern);
  };

  const closePopup = () => {
    setSelectedIssue(null);
    setPopupPosition(null);
    setPartsData(null);
  };

  const fetchPartsData = async (issuePattern: string) => {
    setLoading(true);

    try {
      const response = await supabase.functions.invoke('parts-lookup', {
        body: {
          issue_pattern: issuePattern,
          vehicle_id: vehicleId,
          make,
          model,
          year
        }
      });

      if (response.error) {
        console.error('Parts lookup error:', response.error);
        setPartsData({ success: false, parts: [], sponsored: [], laborEstimate: null });
      } else {
        setPartsData(response.data);
      }
    } catch (error) {
      console.error('Error fetching parts:', error);
      setPartsData({ success: false, parts: [], sponsored: [], laborEstimate: null });
    } finally {
      setLoading(false);
    }
  };

  const handleSponsoredClick = async (placement: SponsoredPlacement) => {
    await trackAndOpenAffiliateLink({
      sourceName: placement.sponsorName,
      destinationUrl: placement.destinationUrl,
      affiliateUrl: placement.destinationUrl,
      userId,
      vehicleId,
      issuePattern: selectedIssue?.pattern,
      sponsoredPlacementId: placement.id
    });
  };

  if (issues.length === 0) {
    return null;
  }

  const visibleIssues = expanded ? issues : issues.slice(0, 3);

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div
        className="card-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px'
        }}
      >
        <span style={{ fontSize: '10pt', fontWeight: 700 }}>
          Known Issues & Parts
        </span>
        <span
          style={{
            fontSize: '7pt',
            padding: '2px 6px',
            background: '#fef3c7',
            color: '#92400e',
            borderRadius: '3px'
          }}
        >
          {issues.length} known issue{issues.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="card-body" style={{ padding: '12px' }}>
        <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '10px' }}>
          Common issues reported for {year} {make} {model}. Click for parts & pricing.
        </div>

        {/* Issue chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {visibleIssues.map((issue) => {
            const style = SEVERITY_STYLES[issue.severity] || SEVERITY_STYLES.medium;

            return (
              <button
                key={issue.id}
                ref={(el) => {
                  if (el) issueRefs.current.set(issue.id, el);
                }}
                onClick={(e) => openPopup(issue, e.currentTarget)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  fontSize: '8pt',
                  fontWeight: 500,
                  background: style.bg,
                  color: style.text,
                  border: `1px solid ${style.border}`,
                  borderRadius: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                title={issue.description}
              >
                <span
                  style={{
                    width: '14px',
                    height: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: style.border,
                    borderRadius: '50%',
                    fontSize: '7pt',
                    fontWeight: 700
                  }}
                >
                  {style.icon}
                </span>
                {issue.pattern}
                {issue.affectedYears && (
                  <span style={{ fontSize: '7pt', opacity: 0.7 }}>
                    ({issue.affectedYears})
                  </span>
                )}
              </button>
            );
          })}

          {issues.length > 3 && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                padding: '4px 10px',
                fontSize: '8pt',
                background: 'var(--bg-secondary)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                cursor: 'pointer'
              }}
            >
              {expanded ? 'Show Less' : `+${issues.length - 3} more`}
            </button>
          )}
        </div>
      </div>

      {/* Issue Popup */}
      {selectedIssue && popupPosition && (
        <div
          ref={popupRef}
          style={{
            position: 'fixed',
            top: popupPosition.top,
            left: popupPosition.left,
            width: '400px',
            maxHeight: '80vh',
            background: 'white',
            borderRadius: '8px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            zIndex: 1000,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* Popup Header */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: SEVERITY_STYLES[selectedIssue.severity]?.bg || '#f9fafb'
            }}
          >
            <div>
              <div style={{ fontSize: '11pt', fontWeight: 700 }}>{selectedIssue.pattern}</div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                {selectedIssue.description}
              </div>
            </div>
            <button
              onClick={closePopup}
              style={{
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                fontSize: '14pt',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                borderRadius: '4px'
              }}
            >
              x
            </button>
          </div>

          {/* Popup Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
            {loading ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 20px',
                  color: 'var(--text-muted)'
                }}
              >
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    border: '2px solid var(--border)',
                    borderTopColor: '#3b82f6',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                    marginBottom: '12px'
                  }}
                />
                <div style={{ fontSize: '9pt' }}>Finding parts & pricing...</div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            ) : !partsData?.success || partsData.parts.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
                  No parts data available. Search retailers directly:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
                  {['eBay', 'FCP Euro', 'RockAuto', 'Amazon'].map((source) => (
                    <a
                      key={source}
                      href={`https://www.google.com/search?q=${encodeURIComponent(
                        `${selectedIssue.pattern} ${make || ''} ${model || ''} ${year || ''}`
                      )}+site:${source.toLowerCase().replace(' ', '')}.com`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: '6px 12px',
                        fontSize: '8pt',
                        color: getSourceColor(source),
                        border: `1px solid ${getSourceColor(source)}`,
                        borderRadius: '4px',
                        textDecoration: 'none'
                      }}
                    >
                      Search {source}
                    </a>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {/* Sponsored Placements */}
                {partsData.sponsored.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    {partsData.sponsored.map((placement) => (
                      <div
                        key={placement.id}
                        onClick={() => handleSponsoredClick(placement)}
                        style={{
                          padding: '10px 12px',
                          background: '#f0f9ff',
                          border: '1px solid #bae6fd',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          marginBottom: '8px'
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            marginBottom: '4px'
                          }}
                        >
                          <span
                            style={{
                              fontSize: '6pt',
                              color: '#0369a1',
                              textTransform: 'uppercase',
                              fontWeight: 600
                            }}
                          >
                            Sponsored
                          </span>
                          {placement.sponsorLogoUrl && (
                            <img
                              src={placement.sponsorLogoUrl}
                              alt=""
                              style={{ height: '16px', opacity: 0.8 }}
                            />
                          )}
                        </div>
                        <div style={{ fontSize: '10pt', fontWeight: 600, marginBottom: '4px' }}>
                          {placement.headline}
                        </div>
                        {placement.description && (
                          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                            {placement.description}
                          </div>
                        )}
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '4px 10px',
                            fontSize: '8pt',
                            fontWeight: 600,
                            background: '#0284c7',
                            color: 'white',
                            borderRadius: '4px'
                          }}
                        >
                          {placement.ctaText}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Parts List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {partsData.parts.map((part) => (
                    <PartsListingCard
                      key={part.id}
                      partId={part.id}
                      name={part.name}
                      category={part.category}
                      oemPartNumber={part.oemPartNumber}
                      laborEstimate={part.laborEstimate}
                      pricing={part.pricing}
                      sources={part.sources}
                      urgency={part.urgency}
                      failureRisk={part.failureRisk}
                      vehicleId={vehicleId}
                      issuePattern={selectedIssue.pattern}
                      userId={userId}
                    />
                  ))}
                </div>

                {/* Labor Estimate Summary */}
                {partsData.laborEstimate && (
                  <div
                    style={{
                      marginTop: '16px',
                      padding: '12px',
                      background: 'var(--bg-secondary)',
                      borderRadius: '6px'
                    }}
                  >
                    <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>
                      Total Labor Estimate
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '8pt' }}>
                        <strong>{partsData.laborEstimate.hoursMin}-{partsData.laborEstimate.hoursMax}</strong> hours
                        <span
                          style={{
                            marginLeft: '8px',
                            padding: '2px 6px',
                            fontSize: '7pt',
                            background: partsData.laborEstimate.difficulty === 'expert' ? '#fecaca' : '#fef08a',
                            color: partsData.laborEstimate.difficulty === 'expert' ? '#991b1b' : '#854d0e',
                            borderRadius: '3px'
                          }}
                        >
                          {partsData.laborEstimate.difficulty}
                        </span>
                      </div>
                      <div style={{ fontSize: '11pt', fontWeight: 700, color: '#166534' }}>
                        ${partsData.laborEstimate.costMin.toLocaleString()}-${partsData.laborEstimate.costMax.toLocaleString()}
                      </div>
                    </div>
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '6px' }}>
                      Based on ${partsData.laborEstimate.shopRate}/hr shop rate
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Backdrop */}
      {selectedIssue && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.3)',
            zIndex: 999
          }}
          onClick={closePopup}
        />
      )}
    </div>
  );
};

export default VehicleCommunityInsights;
