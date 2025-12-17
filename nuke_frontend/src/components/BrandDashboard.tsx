She wants you to be annoying so don't be annoyingimport React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Brand {
  id: string;
  name: string;
  slug: string;
  industry: string;
  category: string;
  description?: string;
  logo_url?: string;
  website_url?: string;
  verification_status: 'pending' | 'verified' | 'disputed';
  claimed_at?: string;
  claimed_by?: string;
  total_tags: number;
  total_verified_tags: number;
  first_tagged_at?: string;
  last_tagged_at?: string;
}

interface BrandAnalytics {
  brand: Brand;
  total_tags: number;
  total_verified_tags: number;
  tag_counts: Record<string, number>;
  verification_counts: Record<string, number>;
  monthly_trend: Array<[string, number]>;
  first_tagged?: string;
  last_tagged?: string;
}

interface BrandDashboardProps {
  brandId?: string;
}

const BrandDashboard: React.FC<BrandDashboardProps> = ({ brandId }) => {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  const [analytics, setAnalytics] = useState<BrandAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [claimNotes, setClaimNotes] = useState('');
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Get current user
  useEffect(() => {
    const getCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
    };
    getCurrentUser();
  }, []);

  // Load brands
  useEffect(() => {
    loadBrands();
  }, [searchQuery]);

  // Load specific brand if provided
  useEffect(() => {
    if (brandId) {
      loadBrandAnalytics(brandId);
    }
  }, [brandId]);

  const loadBrands = async () => {
    setLoading(true);
    try {
      let url = '/api/brands';
      const params = new URLSearchParams();

      if (searchQuery) {
        url = '/api/brands/search';
        params.append('q', searchQuery);
      }

      const response = await fetch(`${url}?${params}`);
      if (response.ok) {
        const { data } = await response.json();
        setBrands(data);

        // Auto-select first brand if none selected
        if (!selectedBrand && data.length > 0) {
          setSelectedBrand(data[0]);
          loadBrandAnalytics(data[0].id);
        }
      }
    } catch (error) {
      console.error('Error loading brands:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadBrandAnalytics = async (id: string) => {
    try {
      const response = await fetch(`/api/brands/${id}`);
      if (response.ok) {
        const { data } = await response.json();
        setAnalytics(data);
      }
    } catch (error) {
      console.error('Error loading brand analytics:', error);
    }
  };

  const claimBrand = async (brand: Brand) => {
    if (!currentUser) {
      alert('Please log in to claim a brand');
      return;
    }

    if (brand.claimed_by) {
      alert('This brand is already claimed by another user');
      return;
    }

    setClaiming(true);
    try {
      const response = await fetch(`/api/brands/${brand.id}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          claim_notes: claimNotes
        })
      });

      if (response.ok) {
        const { data, message } = await response.json();
        alert(message || 'Brand claim submitted successfully!');

        // Update the brand in our state
        setBrands(prev => prev.map(b => b.id === brand.id ? data : b));
        if (selectedBrand?.id === brand.id) {
          setSelectedBrand(data);
        }
        setClaimNotes('');
      } else {
        const { error } = await response.json();
        alert(`Failed to claim brand: ${error}`);
      }
    } catch (error) {
      console.error('Error claiming brand:', error);
      alert('Error claiming brand. Please try again.');
    } finally {
      setClaiming(false);
    }
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(num);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <div className="text">Loading brands...</div>
      </div>
    );
  }

  return (
    <div className="brand-dashboard">
      <div className="card">
        <div className="card-header">
          <h2 className="text text-large font-bold">Brand Analytics Dashboard</h2>
          <p className="text text-small text-muted">
            Discover how brands are being tagged across the platform and claim your company's presence.
          </p>
        </div>

        <div className="card-body">
          {/* Search and Filters */}
          <div className="mb-4">
            <div className="form-group">
              <label className="form-label text text-small font-bold">Search Brands</label>
              <input
                type="text"
                className="form-input"
                placeholder="Search by brand name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="dashboard-layout">
            {/* Brand List */}
            <div className="brand-list">
              <h3 className="text text-medium font-bold mb-2">Brands ({brands.length})</h3>

              <div className="brand-list-container">
                {brands.map((brand) => (
                  <div
                    key={brand.id}
                    className={`brand-item ${selectedBrand?.id === brand.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedBrand(brand);
                      loadBrandAnalytics(brand.id);
                    }}
                  >
                    <div className="brand-item-header">
                      <div className="brand-name text font-bold">{brand.name}</div>
                      <div className="brand-status">
                        <span className={`status-badge status-${brand.verification_status}`}>
                          {brand.verification_status}
                        </span>
                        {brand.claimed_by && (
                          <span className="claimed-badge">Claimed</span>
                        )}
                      </div>
                    </div>

                    <div className="brand-stats">
                      <div className="stat">
                        <span className="text text-small text-muted">Tags:</span>
                        <span className="text text-small font-bold">{formatNumber(brand.total_tags)}</span>
                      </div>
                      <div className="stat">
                        <span className="text text-small text-muted">Verified:</span>
                        <span className="text text-small font-bold">{formatNumber(brand.total_verified_tags)}</span>
                      </div>
                      <div className="stat">
                        <span className="text text-small text-muted">Industry:</span>
                        <span className="text text-small">{brand.industry}</span>
                      </div>
                    </div>
                  </div>
                ))}

                {brands.length === 0 && (
                  <div className="empty-state">
                    <div className="text text-muted">No brands found</div>
                  </div>
                )}
              </div>
            </div>

            {/* Brand Analytics */}
            <div className="brand-analytics">
              {selectedBrand && analytics ? (
                <div>
                  <div className="analytics-header">
                    <div className="brand-title">
                      <h3 className="text text-large font-bold">{analytics.brand.name}</h3>
                      <div className="brand-meta">
                        <span className="text text-small text-muted">
                          {analytics.brand.industry} • {analytics.brand.category}
                        </span>
                        {analytics.brand.website_url && (
                          <a
                            href={analytics.brand.website_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text text-small link"
                          >
                            Visit Website
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Claim Button */}
                    {!analytics.brand.claimed_by && currentUser && (
                      <button
                        className="button button-primary"
                        onClick={() => claimBrand(analytics.brand)}
                        disabled={claiming}
                      >
                        {claiming ? 'Claiming...' : 'Claim Brand'}
                      </button>
                    )}
                  </div>

                  {/* Analytics Cards */}
                  <div className="analytics-cards">
                    <div className="analytics-card">
                      <div className="card-value text text-large font-bold">
                        {formatNumber(analytics.total_tags)}
                      </div>
                      <div className="card-label text text-small text-muted">Total Tags</div>
                    </div>

                    <div className="analytics-card">
                      <div className="card-value text text-large font-bold">
                        {formatNumber(analytics.total_verified_tags)}
                      </div>
                      <div className="card-label text text-small text-muted">Verified Tags</div>
                    </div>

                    <div className="analytics-card">
                      <div className="card-value text text-large font-bold">
                        {analytics.total_verified_tags > 0
                          ? Math.round((analytics.total_verified_tags / analytics.total_tags) * 100)
                          : 0}%
                      </div>
                      <div className="card-label text text-small text-muted">Verification Rate</div>
                    </div>

                    <div className="analytics-card">
                      <div className="card-value text text-small">
                        {formatDate(analytics.first_tagged)}
                      </div>
                      <div className="card-label text text-small text-muted">First Tagged</div>
                    </div>
                  </div>

                  {/* Tag Types Breakdown */}
                  <div className="analytics-section">
                    <h4 className="text text-medium font-bold">Tag Types</h4>
                    <div className="tag-types">
                      {Object.entries(analytics.tag_counts).map(([type, count]) => (
                        <div key={type} className="tag-type-item">
                          <span className="text text-small">{type}</span>
                          <span className="text text-small font-bold">{formatNumber(count)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Verification Status */}
                  <div className="analytics-section">
                    <h4 className="text text-medium font-bold">Verification Status</h4>
                    <div className="verification-status">
                      {Object.entries(analytics.verification_counts).map(([status, count]) => (
                        <div key={status} className="verification-item">
                          <span className={`status-badge status-${status}`}>{status}</span>
                          <span className="text text-small font-bold">{formatNumber(count)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Monthly Trend */}
                  {analytics.monthly_trend && analytics.monthly_trend.length > 0 && (
                    <div className="analytics-section">
                      <h4 className="text text-medium font-bold">Monthly Tag Trend</h4>
                      <div className="trend-chart">
                        {analytics.monthly_trend.map(([month, count]) => (
                          <div key={month} className="trend-item">
                            <div className="trend-month text text-small">
                              {new Date(month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                            </div>
                            <div className="trend-count text text-small font-bold">{formatNumber(count)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Claim Notes Input */}
                  {!analytics.brand.claimed_by && currentUser && (
                    <div className="claim-section">
                      <h4 className="text text-medium font-bold">Claim This Brand</h4>
                      <div className="form-group">
                        <label className="form-label text text-small">
                          Claim Notes (optional)
                        </label>
                        <textarea
                          className="form-input"
                          placeholder="Explain why you should be able to claim this brand..."
                          value={claimNotes}
                          onChange={(e) => setClaimNotes(e.target.value)}
                          rows={3}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-analytics">
                  <div className="text text-muted">
                    {selectedBrand ? 'Loading analytics...' : 'Select a brand to view analytics'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .brand-dashboard {
          padding: var(--space-4);
          max-width: 1400px;
          margin: 0 auto;
        }

        .dashboard-layout {
          display: flex;
          gap: var(--space-4);
        }

        .brand-list {
          flex: 0 0 350px;
        }

        .brand-list-container {
          max-height: 600px;
          overflow-y: auto;
          border: 1px solid var(--border-light);
          border-radius: var(--border-radius);
        }

        .brand-item {
          padding: var(--space-3);
          border-bottom: 1px solid var(--border-light);
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .brand-item:hover {
          background-color: var(--grey-50);
        }

        .brand-item.selected {
          background-color: var(--primary-50);
          border-left: 3px solid var(--primary-500);
        }

        .brand-item-header {
          display: flex;
          justify-content: between;
          align-items: flex-start;
          margin-bottom: var(--space-2);
        }

        .brand-status {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
          align-items: flex-end;
        }

        .status-badge {
          padding: var(--space-1) var(--space-2);
          border-radius: var(--border-radius-small);
          font-size: var(--text-xs);
          text-transform: uppercase;
          font-weight: bold;
        }

        .status-pending {
          background-color: var(--yellow-100);
          color: var(--yellow-800);
        }

        .status-verified {
          background-color: var(--green-100);
          color: var(--green-800);
        }

        .status-disputed {
          background-color: var(--red-100);
          color: var(--red-800);
        }

        .claimed-badge {
          background-color: var(--blue-100);
          color: var(--blue-800);
          padding: var(--space-1) var(--space-2);
          border-radius: var(--border-radius-small);
          font-size: var(--text-xs);
          font-weight: bold;
        }

        .brand-stats {
          display: flex;
          gap: var(--space-3);
        }

        .stat {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .brand-analytics {
          flex: 1;
        }

        .analytics-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: var(--space-4);
          padding-bottom: var(--space-3);
          border-bottom: 1px solid var(--border-light);
        }

        .brand-meta {
          display: flex;
          gap: var(--space-3);
          margin-top: var(--space-1);
        }

        .analytics-cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: var(--space-3);
          margin-bottom: var(--space-4);
        }

        .analytics-card {
          padding: var(--space-3);
          border: 1px solid var(--border-light);
          border-radius: var(--border-radius);
          background: var(--grey-50);
          text-align: center;
        }

        .card-value {
          margin-bottom: var(--space-1);
        }

        .analytics-section {
          margin-bottom: var(--space-4);
          padding: var(--space-3);
          border: 1px solid var(--border-light);
          border-radius: var(--border-radius);
        }

        .analytics-section h4 {
          margin-bottom: var(--space-3);
          padding-bottom: var(--space-2);
          border-bottom: 1px solid var(--border-light);
        }

        .tag-types, .verification-status {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
        }

        .tag-type-item, .verification-item {
          display: flex;
          justify-content: space-between;
          padding: var(--space-2);
          background: white;
          border: 1px solid var(--border-light);
          border-radius: var(--border-radius-small);
          min-width: 120px;
        }

        .trend-chart {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
        }

        .trend-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: var(--space-2);
          background: white;
          border: 1px solid var(--border-light);
          border-radius: var(--border-radius-small);
          min-width: 80px;
        }

        .empty-state, .empty-analytics {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 200px;
          border: 1px dashed var(--border-light);
          border-radius: var(--border-radius);
        }

        .claim-section {
          margin-top: var(--space-4);
          padding: var(--space-3);
          background: var(--blue-50);
          border-radius: var(--border-radius);
        }

      `}</style>
    </div>
  );
};

export default BrandDashboard;