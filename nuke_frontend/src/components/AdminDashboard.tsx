import React, { useState, useEffect } from 'react';

interface DashboardStats {
  total_tags: number;
  pending_tags: number;
  verified_tags: number;
  disputed_tags: number;
  average_trust_score: number;
  tags_today: number;
  corporate_assigned: number;
}

interface PendingTag {
  id: string;
  image_id: string;
  tag_type: string;
  text: string;
  x_position: number;
  y_position: number;
  trust_score: number;
  verification_status: string;
  inserted_at: string;
}

interface CorporateClient {
  id: string;
  name: string;
  status: string;
  tag_types: string[];
  total_tags: number;
  verified_tags: number;
}

const AdminDashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [pendingTags, setPendingTags] = useState<PendingTag[]>([]);
  const [corporateClients, setCorporateClients] = useState<CorporateClient[]>([]);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const [statsRes, pendingRes, clientsRes] = await Promise.all([
        fetch('/api/admin/dashboard', {
          headers: { 'Authorization': 'Bearer fake-token-for-dev' }
        }),
        fetch('/api/admin/pending-tags?per_page=20', {
          headers: { 'Authorization': 'Bearer fake-token-for-dev' }
        }),
        fetch('/api/admin/corporate-clients', {
          headers: { 'Authorization': 'Bearer fake-token-for-dev' }
        })
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.data);
      }

      if (pendingRes.ok) {
        const pendingData = await pendingRes.json();
        setPendingTags(pendingData.data.tags);
      }

      if (clientsRes.ok) {
        const clientsData = await clientsRes.json();
        setCorporateClients(clientsData.data);
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTagSelection = (tagId: string, selected: boolean) => {
    const newSelected = new Set(selectedTags);
    if (selected) {
      newSelected.add(tagId);
    } else {
      newSelected.delete(tagId);
    }
    setSelectedTags(newSelected);
  };

  const handleBulkAction = async (action: string) => {
    if (selectedTags.size === 0) {
      alert('Please select tags to process');
      return;
    }

    setProcessing(true);
    try {
      const response = await fetch('/api/admin/bulk-process-tags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer fake-token-for-dev'
        },
        body: JSON.stringify({
          tag_ids: Array.from(selectedTags),
          action: action,
          verification_type: 'professional'
        })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Successfully ${result.data.action} ${result.data.processed} tags`);
        setSelectedTags(new Set());
        loadDashboardData(); // Reload data
      } else {
        alert('Error processing tags');
      }
    } catch (error) {
      console.error('Error processing tags:', error);
      alert('Error processing tags');
    } finally {
      setProcessing(false);
    }
  };

  const exportData = async (format: string) => {
    try {
      const response = await fetch('/api/admin/export-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer fake-token-for-dev'
        },
        body: JSON.stringify({
          format: format,
          filters: {
            verification_status: 'verified',
            min_trust_score: '50'
          }
        })
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `tags_export.${format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Error exporting data:', error);
    }
  };

  if (loading) {
    return (
      <div className="admin-dashboard">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <style jsx>{`
        .admin-dashboard {
          padding: 20px;
          font-family: 'MS Sans Serif', sans-serif;
          background: var(--bg-color);
          min-height: 100vh;
        }

        .dashboard-header {
          background: var(--button-face);
          border: 2px outset var(--button-face);
          padding: 15px;
          margin-bottom: 20px;
        }

        .dashboard-title {
          font-size: 18px;
          font-weight: bold;
          color: var(--text-color);
          margin: 0 0 10px 0;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 15px;
          margin-bottom: 30px;
        }

        .stat-card {
          background: var(--button-face);
          border: 2px inset var(--button-face);
          padding: 15px;
          text-align: center;
        }

        .stat-value {
          font-size: 24px;
          font-weight: bold;
          color: var(--text-color);
          display: block;
        }

        .stat-label {
          font-size: 12px;
          color: var(--text-color);
          margin-top: 5px;
        }

        .dashboard-sections {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 20px;
        }

        .section {
          background: var(--button-face);
          border: 2px inset var(--button-face);
          padding: 15px;
        }

        .section-title {
          font-size: 14px;
          font-weight: bold;
          color: var(--text-color);
          margin: 0 0 15px 0;
          padding-bottom: 5px;
          border-bottom: 1px solid var(--border-color);
        }

        .pending-tags-list {
          max-height: 400px;
          overflow-y: auto;
          border: 1px inset var(--button-face);
          padding: 10px;
        }

        .tag-item {
          display: flex;
          align-items: center;
          padding: 8px;
          border-bottom: 1px solid var(--border-color);
          background: var(--input-bg);
          margin-bottom: 5px;
        }

        .tag-checkbox {
          margin-right: 10px;
        }

        .tag-info {
          flex: 1;
          font-size: 12px;
        }

        .tag-type {
          font-weight: bold;
          color: var(--primary);
        }

        .tag-text {
          margin: 2px 0;
        }

        .tag-coords {
          color: var(--secondary);
          font-size: 10px;
        }

        .bulk-actions {
          display: flex;
          gap: 10px;
          margin: 15px 0;
          flex-wrap: wrap;
        }

        .admin-button {
          background: var(--button-face);
          border: 2px outset var(--button-face);
          color: var(--text-color);
          padding: 6px 12px;
          font-size: 12px;
          cursor: pointer;
          min-height: 23px;
        }

        .admin-button:hover {
          background: var(--button-highlight);
        }

        .admin-button:active {
          border: 2px inset var(--button-face);
        }

        .admin-button:disabled {
          background: var(--button-disabled);
          color: var(--text-disabled);
          cursor: not-allowed;
        }

        .verify-btn {
          background: var(--success);
          border-color: var(--success);
          color: white;
        }

        .dispute-btn {
          background: var(--danger);
          border-color: var(--danger);
          color: white;
        }

        .corporate-clients-list {
          font-size: 12px;
        }

        .client-item {
          padding: 10px;
          border-bottom: 1px solid var(--border-color);
          background: var(--input-bg);
          margin-bottom: 5px;
        }

        .client-name {
          font-weight: bold;
          margin-bottom: 5px;
        }

        .client-status {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 10px;
          text-transform: uppercase;
        }

        .status-active {
          background: var(--success);
          color: white;
        }

        .status-pending {
          background: var(--warning);
          color: white;
        }

        .client-stats {
          margin-top: 5px;
          color: var(--secondary);
        }

        .export-section {
          margin-top: 20px;
          padding: 15px;
          background: var(--input-bg);
          border: 1px inset var(--button-face);
        }

        .export-buttons {
          display: flex;
          gap: 10px;
          margin-top: 10px;
        }

        .loading-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 200px;
        }

        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 4px solid var(--border-color);
          border-top: 4px solid var(--primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @media (max-width: 768px) {
          .dashboard-sections {
            grid-template-columns: 1fr;
          }

          .stats-grid {
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          }
        }
      `}</style>

      <div className="dashboard-header">
        <h1 className="dashboard-title">Admin Dashboard - Corporate Data Harvesting</h1>
        <p>Manage tags, verify corporate data, and process bulk operations</p>
      </div>

      {stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-value">{stats.total_tags.toLocaleString()}</span>
            <div className="stat-label">Total Tags</div>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.pending_tags.toLocaleString()}</span>
            <div className="stat-label">Pending Review</div>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.verified_tags.toLocaleString()}</span>
            <div className="stat-label">Verified Tags</div>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.disputed_tags.toLocaleString()}</span>
            <div className="stat-label">Disputed Tags</div>
          </div>
          <div className="stat-card">
            <span className="stat-value">{Math.round(stats.average_trust_score || 0)}</span>
            <div className="stat-label">Avg Trust Score</div>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.tags_today.toLocaleString()}</span>
            <div className="stat-label">Today's Tags</div>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.corporate_assigned.toLocaleString()}</span>
            <div className="stat-label">Corporate Assigned</div>
          </div>
        </div>
      )}

      <div className="dashboard-sections">
        <div className="section">
          <h2 className="section-title">Pending Tags for Review</h2>

          <div className="bulk-actions">
            <button
              className="admin-button verify-btn"
              onClick={() => handleBulkAction('verify')}
              disabled={processing || selectedTags.size === 0}
            >
              {processing ? 'Processing...' : `Verify Selected (${selectedTags.size})`}
            </button>
            <button
              className="admin-button dispute-btn"
              onClick={() => handleBulkAction('dispute')}
              disabled={processing || selectedTags.size === 0}
            >
              Dispute Selected
            </button>
            <button
              className="admin-button"
              onClick={() => handleBulkAction('assign_corporate')}
              disabled={processing || selectedTags.size === 0}
            >
              Assign to Corporate
            </button>
          </div>

          <div className="pending-tags-list">
            {pendingTags.map((tag) => (
              <div key={tag.id} className="tag-item">
                <input
                  type="checkbox"
                  className="tag-checkbox"
                  checked={selectedTags.has(tag.id)}
                  onChange={(e) => handleTagSelection(tag.id, e.target.checked)}
                />
                <div className="tag-info">
                  <div className="tag-type">{tag.tag_type.toUpperCase()}</div>
                  <div className="tag-text">{tag.text}</div>
                  <div className="tag-coords">
                    ({Math.round(tag.x_position)}%, {Math.round(tag.y_position)}%) |
                    Trust: {tag.trust_score}
                  </div>
                </div>
              </div>
            ))}

            {pendingTags.length === 0 && (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--secondary)' }}>
                No pending tags found
              </div>
            )}
          </div>
        </div>

        <div className="section">
          <h2 className="section-title">Corporate Clients</h2>

          <div className="corporate-clients-list">
            {corporateClients.map((client) => (
              <div key={client.id} className="client-item">
                <div className="client-name">{client.name}</div>
                <span className={`client-status status-${client.status}`}>
                  {client.status}
                </span>
                <div className="client-stats">
                  Total Tags: {client.total_tags} |
                  Verified: {client.verified_tags} |
                  Types: {client.tag_types.join(', ')}
                </div>
              </div>
            ))}
          </div>

          <div className="export-section">
            <h3 className="section-title">Data Export</h3>
            <p>Export verified tags for corporate clients:</p>
            <div className="export-buttons">
              <button
                className="admin-button"
                onClick={() => exportData('csv')}
              >
                Export CSV
              </button>
              <button
                className="admin-button"
                onClick={() => exportData('json')}
              >
                Export JSON
              </button>
              <button
                className="admin-button"
                onClick={() => exportData('coco')}
              >
                Export COCO
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;