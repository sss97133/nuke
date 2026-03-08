import React, { useState, useEffect } from 'react';
import AppLayout from '../components/layout/AppLayout';
import type { BusinessForm } from '../components/BusinessForm';
import type { Business } from '../types/business';
import type { BusinessService } from '../services/businessService';
import type { useAuth } from '../hooks/useAuth';

export const BusinessManagement: React.FC = () => {
  const { user } = useAuth();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBusinesses();
  }, []);

  const loadBusinesses = async () => {
    try {
      setLoading(true);
      const userBusinesses = await BusinessService.getUserBusinesses();
      setBusinesses(userBusinesses);
    } catch (err) {
      console.error('Error loading businesses:', err);
      setError('Failed to load businesses');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSuccess = (business: Business) => {
    setBusinesses(prev => [...prev, business]);
    setShowCreateForm(false);
  };

  const handleBusinessSelect = (business: Business) => {
    setSelectedBusiness(business);
  };

  const formatCurrency = (amount?: number) => {
    if (!amount) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const getBusinessTypeLabel = (type: string) => {
    const typeMap: Record<string, string> = {
      garage: 'Auto Garage',
      dealership: 'Car Dealership',
      restoration_shop: 'Restoration Shop',
      performance_shop: 'Performance Shop',
      body_shop: 'Body Shop',
      detailing: 'Detailing Service',
      mobile_service: 'Mobile Service',
      specialty_shop: 'Specialty Shop',
      parts_supplier: 'Parts Supplier',
      fabrication: 'Fabrication Shop',
      racing_team: 'Racing Team',
      sole_proprietorship: 'Sole Proprietorship',
      partnership: 'Partnership',
      llc: 'LLC',
      corporation: 'Corporation',
      other: 'Other'
    };
    return typeMap[type] || type;
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Authentication Required</h2>
          <p className="text-gray-600">Please log in to manage your businesses.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="layout">
        <div className="main">
          <div className="container">
            <div className="card">
              <div className="card-body text-center">
                <div className="loading-spinner"></div>
                <div className="text text-muted">Loading businesses...</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (showCreateForm) {
    return (
      <div className="layout">
        <div className="main">
          <BusinessForm
            onSuccess={handleCreateSuccess}
            onCancel={() => setShowCreateForm(false)}
          />
        </div>
      </div>
    );
  }

  if (selectedBusiness) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-6xl mx-auto px-4">
          <div className="mb-6">
            <button
              onClick={() => setSelectedBusiness(null)}
              className="flex items-center text-blue-600 hover:text-blue-800"
            >
              ← Back to Business List
            </button>
          </div>
          
          <BusinessDetailView business={selectedBusiness} />
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      <div className="main">
        <div className="container">
          <div className="flex justify-between">
            <h1 className="text font-bold">My Businesses</h1>
            <button
              onClick={() => setShowCreateForm(true)}
              className="button button-primary"
            >
              Create New Business
            </button>
          </div>

        {error && (
          <div className="alert alert-error">
            <div className="text">{error}</div>
          </div>
        )}

        {businesses.length === 0 ? (
          <div className="section">
            <div className="card">
              <div className="card-body text-center">
                <div className="text font-bold">No businesses yet</div>
                <div className="text text-muted">
                  Create your first business to start building your automotive empire. 
                  Businesses become tradable assets on the platform once established.
                </div>
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="button button-primary"
                >
                  Create Your First Business
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="vehicle-grid">
            {businesses.map((business) => (
              <BusinessCard 
                key={business.id} 
                business={business} 
                onClick={() => handleBusinessSelect(business)}
              />
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

interface BusinessCardProps {
  business: Business;
  onClick: () => void;
}

const BusinessCard: React.FC<BusinessCardProps> = ({ business, onClick }) => {
  const getStatusBadge = (status: string) => {
    return `badge ${status === 'active' ? 'badge-success' : 
                   status === 'for_sale' ? 'badge-primary' : 'badge-warning'}`;
  };

  const getVerificationBadge = (business: Business) => {
    if (business.is_verified) {
      return (
        <span className="badge badge-success">
          ✓ Verified
        </span>
      );
    }
    return (
      <span className="badge badge-warning">
        Pending Verification
      </span>
    );
  };

  return (
    <div 
      onClick={onClick}
      className="vehicle-card"
    >
      <div className="vehicle-content">
        <div className="flex justify-between">
          <div>
            <div className="vehicle-title">
              {business.business_name}
            </div>
            <div className="text-small text-muted">
              {business.business_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </div>
          </div>
          <span className={getStatusBadge(business.status)}>
            {business.status.replace('_', ' ').toUpperCase()}
          </span>
        </div>

        <div className="vehicle-details">
          {business.city && business.state && (
            <div className="vehicle-detail">
              <span>Location:</span>
              <span>{business.city}, {business.state}</span>
            </div>
          )}

          {business.specializations.length > 0 && (
            <div className="vehicle-detail">
              <span>Specializations:</span>
              <span>{business.specializations.slice(0, 2).join(', ')}
              {business.specializations.length > 2 && ` +${business.specializations.length - 2}`}</span>
            </div>
          )}

          {business.years_in_business && (
            <div className="vehicle-detail">
              <span>Years:</span>
              <span>{business.years_in_business}</span>
            </div>
          )}
        </div>

        <div className="vehicle-metrics">
          <div className="metric-item">
            <span className="metric-label">Vehicles</span>
            <span className="metric-value">{business.total_vehicles_worked}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Projects</span>
            <span className="metric-value">{business.total_projects_completed}</span>
          </div>
        </div>

        <div className="flex justify-between">
          {getVerificationBadge(business)}
          
          {business.average_project_rating > 0 && (
            <div className="text-small">
              ★ {business.average_project_rating.toFixed(1)}
            </div>
          )}
        </div>

        {business.is_for_sale && business.asking_price && (
          <div className="alert alert-info">
            <div className="text-small font-bold">
              For Sale: {new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD'
              }).format(business.asking_price)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface BusinessDetailViewProps {
  business: Business;
}

const BusinessDetailView: React.FC<BusinessDetailViewProps> = ({ business }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'fleet' | 'team' | 'timeline'>('overview');

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'fleet', label: 'Vehicle Fleet' },
    { id: 'team', label: 'Team' },
    { id: 'timeline', label: 'Timeline' }
  ];

  return (
    <div className="bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{business.business_name}</h1>
            {business.legal_name && business.legal_name !== business.business_name && (
              <p className="text-sm text-gray-600">Legal Name: {business.legal_name}</p>
            )}
            <p className="text-sm text-gray-600 mt-1">
              {business.business_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </p>
          </div>
          <div className="text-right">
            <span className={`px-3 py-1 text-sm font-medium rounded-full ${
              business.status === 'active' ? 'bg-green-100 text-green-800' :
              business.status === 'for_sale' ? 'bg-blue-100 text-blue-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {business.status.replace('_', ' ').toUpperCase()}
            </span>
            {business.is_verified && (
              <div className="mt-2">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  ✓ Verified Business
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8 px-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="p-6">
        {activeTab === 'overview' && (
          <BusinessOverviewTab business={business} />
        )}
        {activeTab === 'fleet' && (
          <BusinessFleetTab businessId={business.id} />
        )}
        {activeTab === 'team' && (
          <BusinessTeamTab businessId={business.id} />
        )}
        {activeTab === 'timeline' && (
          <BusinessTimelineTab businessId={business.id} />
        )}
      </div>
    </div>
  );
};

const BusinessOverviewTab: React.FC<{ business: Business }> = ({ business }) => {
  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="text-2xl font-bold text-gray-900">{business.total_vehicles_worked}</div>
          <div className="text-sm text-gray-600">Total Vehicles</div>
        </div>
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="text-2xl font-bold text-gray-900">{business.total_projects_completed}</div>
          <div className="text-sm text-gray-600">Projects Completed</div>
        </div>
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="text-2xl font-bold text-gray-900">
            {business.average_project_rating > 0 ? business.average_project_rating.toFixed(1) : 'N/A'}
          </div>
          <div className="text-sm text-gray-600">Average Rating</div>
        </div>
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="text-2xl font-bold text-gray-900">
            {business.on_time_completion_rate > 0 ? `${business.on_time_completion_rate}%` : 'N/A'}
          </div>
          <div className="text-sm text-gray-600">On-Time Rate</div>
        </div>
      </div>

      {/* Description */}
      {business.description && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">About</h3>
          <p className="text-gray-600">{business.description}</p>
        </div>
      )}

      {/* Contact & Location */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Contact Information</h3>
          <div className="space-y-2">
            {business.email && (
              <div className="flex items-center">
                <span className="font-medium text-gray-700 w-16">Email:</span>
                <span className="text-gray-600">{business.email}</span>
              </div>
            )}
            {business.phone && (
              <div className="flex items-center">
                <span className="font-medium text-gray-700 w-16">Phone:</span>
                <span className="text-gray-600">{business.phone}</span>
              </div>
            )}
            {business.website && (
              <div className="flex items-center">
                <span className="font-medium text-gray-700 w-16">Website:</span>
                <a href={business.website} target="_blank" rel="noopener noreferrer" 
                   className="text-blue-600 hover:text-blue-800">
                  {business.website}
                </a>
              </div>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Location</h3>
          <div className="space-y-1">
            {business.address && <div className="text-gray-600">{business.address}</div>}
            {(business.city || business.state) && (
              <div className="text-gray-600">
                {business.city}{business.city && business.state && ', '}{business.state} {business.zip_code}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Specializations & Services */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {business.specializations.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Specializations</h3>
            <div className="flex flex-wrap gap-2">
              {business.specializations.map((spec, index) => (
                <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded">
                  {spec.replace('_', ' ')}
                </span>
              ))}
            </div>
          </div>
        )}

        {business.services_offered.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Services Offered</h3>
            <div className="flex flex-wrap gap-2">
              {business.services_offered.map((service, index) => (
                <span key={index} className="px-2 py-1 bg-green-100 text-green-800 text-sm rounded">
                  {service.replace('_', ' ')}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const BusinessFleetTab: React.FC<{ businessId: string }> = ({ businessId }) => {
  return (
    <div className="text-center py-12">
      <p className="text-gray-600">Fleet management functionality coming soon...</p>
      <p className="text-sm text-gray-500 mt-2">This will show all vehicles associated with the business.</p>
    </div>
  );
};

const BusinessTeamTab: React.FC<{ businessId: string }> = ({ businessId }) => {
  return (
    <div className="text-center py-12">
      <p className="text-gray-600">Team management functionality coming soon...</p>
      <p className="text-sm text-gray-500 mt-2">This will show all employees and contractors associated with the business.</p>
    </div>
  );
};

const BusinessTimelineTab: React.FC<{ businessId: string }> = ({ businessId }) => {
  return (
    <div className="text-center py-12">
      <p className="text-gray-600">Business timeline functionality coming soon...</p>
      <p className="text-sm text-gray-500 mt-2">This will show the complete history of business events and milestones.</p>
    </div>
  );
};
