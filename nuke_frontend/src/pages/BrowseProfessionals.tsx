import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout';
import { professionalService, type ProfessionalUser, type ProfessionalSearchFilters } from '../services/professionalService';

const BrowseProfessionals: React.FC = () => {
  const [professionals, setProfessionals] = useState<ProfessionalUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<ProfessionalSearchFilters>({
    sortBy: 'rating',
    limit: 20
  });
  const [stats, setStats] = useState({
    totalProfessionals: 0,
    totalBusinesses: 0,
    verifiedBusinesses: 0,
    averageRating: 0
  });

  useEffect(() => {
    loadProfessionals();
    loadStats();
  }, [filters]);

  const loadProfessionals = async () => {
    setLoading(true);
    const results = await professionalService.searchProfessionals(filters);
    setProfessionals(results);
    setLoading(false);
  };

  const loadStats = async () => {
    const statsData = await professionalService.getProfessionalStats();
    setStats(statsData);
  };

  const handleFilterChange = (newFilters: Partial<ProfessionalSearchFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  };

  const getUserTypeDisplay = (userType: string) => {
    switch (userType) {
      case 'business': return 'Business';
      case 'professional': return 'Professional';
      default: return 'Individual';
    }
  };

  const getBusinessTypeDisplay = (businessType?: string) => {
    if (!businessType) return '';
    return businessType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const renderStarRating = (rating?: number) => {
    if (!rating) return <span className="text-xs text-gray-400">No ratings</span>;
    
    const stars = [];
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    
    for (let i = 0; i < 5; i++) {
      if (i < fullStars) {
        stars.push('★');
      } else if (i === fullStars && hasHalfStar) {
        stars.push('☆');
      } else {
        stars.push('☆');
      }
    }
    
    return (
      <div className="flex items-center gap-1">
        <span className="text-yellow-500 text-xs">{stars.join('')}</span>
        <span className="text-xs text-gray-600">({rating.toFixed(1)})</span>
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="fade-in">
        {/* Page Header */}
        <section className="section">
          <div className="mb-4">
            <h1 className="text-xs font-bold text-gray-900 mb-2">Browse Professionals</h1>
            <p className="text-xs text-gray-600">Find automotive professionals, shops, and services</p>
          </div>
        </section>

        {/* Stats */}
        <section className="section">
          <div className="grid grid-cols-4 gap-2 mb-4">
            <div className="bg-white p-2 rounded border text-center">
              <div className="text-xs font-medium">{stats.totalProfessionals}</div>
              <div className="text-xs text-gray-600">Professionals</div>
            </div>
            <div className="bg-white p-2 rounded border text-center">
              <div className="text-xs font-medium">{stats.totalBusinesses}</div>
              <div className="text-xs text-gray-600">Businesses</div>
            </div>
            <div className="bg-white p-2 rounded border text-center">
              <div className="text-xs font-medium">{stats.verifiedBusinesses}</div>
              <div className="text-xs text-gray-600">Verified</div>
            </div>
            <div className="bg-white p-2 rounded border text-center">
              <div className="text-xs font-medium">{stats.averageRating.toFixed(1)}</div>
              <div className="text-xs text-gray-600">Avg Rating</div>
            </div>
          </div>
        </section>

        {/* Filters */}
        <section className="section">
          <div className="bg-white p-3 rounded border mb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">User Type</label>
                <select
                  value={filters.userType || ''}
                  onChange={(e) => handleFilterChange({ userType: e.target.value as any || undefined })}
                  className="w-full text-xs border rounded px-2 py-1"
                >
                  <option value="">All Types</option>
                  <option value="business">Businesses</option>
                  <option value="professional">Professionals</option>
                  <option value="individual">Individuals</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">Min Rating</label>
                <select
                  value={filters.minRating || ''}
                  onChange={(e) => handleFilterChange({ minRating: e.target.value ? parseFloat(e.target.value) : undefined })}
                  className="w-full text-xs border rounded px-2 py-1"
                >
                  <option value="">Any Rating</option>
                  <option value="4.5">4.5+ Stars</option>
                  <option value="4.0">4.0+ Stars</option>
                  <option value="3.5">3.5+ Stars</option>
                  <option value="3.0">3.0+ Stars</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">Verified Only</label>
                <select
                  value={filters.isVerified ? 'true' : 'false'}
                  onChange={(e) => handleFilterChange({ isVerified: e.target.value === 'true' })}
                  className="w-full text-xs border rounded px-2 py-1"
                >
                  <option value="false">All</option>
                  <option value="true">Verified Only</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">Sort By</label>
                <select
                  value={filters.sortBy || 'rating'}
                  onChange={(e) => handleFilterChange({ sortBy: e.target.value as any })}
                  className="w-full text-xs border rounded px-2 py-1"
                >
                  <option value="rating">Rating</option>
                  <option value="reviews">Most Reviews</option>
                  <option value="experience">Experience</option>
                  <option value="recent">Recently Joined</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* Results */}
        <section className="section">
          {loading ? (
            <div className="bg-white p-6 rounded border text-center">
              <div className="loading-spinner mx-auto mb-4"></div>
              <p className="text-xs text-gray-600">Loading professionals...</p>
            </div>
          ) : professionals.length === 0 ? (
            <div className="bg-white p-6 rounded border text-center">
              <p className="text-xs text-gray-600">No professionals found matching your criteria.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {professionals.map((professional) => (
                <div key={professional.user_id} className="bg-white p-3 rounded border hover:shadow-sm transition-shadow">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-xs font-medium text-gray-900">
                          {professional.business_name || professional.full_name || professional.username || 'Anonymous User'}
                        </h3>
                        
                        <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">
                          {getUserTypeDisplay(professional.user_type)}
                        </span>
                        
                        {professional.business_verified && (
                          <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                            Verified
                          </span>
                        )}
                      </div>

                      <div className="space-y-1">
                        {professional.business_type && (
                          <div className="text-xs text-gray-600">
                            {getBusinessTypeDisplay(professional.business_type)}
                          </div>
                        )}
                        
                        {professional.city && professional.state && (
                          <div className="text-xs text-gray-600">
                            {professional.city}, {professional.state}
                            {professional.service_radius_miles && (
                              <span> • {professional.service_radius_miles} mile radius</span>
                            )}
                          </div>
                        )}

                        <div className="flex items-center gap-4">
                          {renderStarRating(professional.average_rating)}
                          
                          {professional.review_count > 0 && (
                            <span className="text-xs text-gray-600">
                              {professional.review_count} review{professional.review_count !== 1 ? 's' : ''}
                            </span>
                          )}
                          
                          {professional.verified_certifications > 0 && (
                            <span className="text-xs text-gray-600">
                              {professional.verified_certifications} certification{professional.verified_certifications !== 1 ? 's' : ''}
                            </span>
                          )}
                          
                          {professional.specialization_count > 0 && (
                            <span className="text-xs text-gray-600">
                              {professional.specialization_count} specialization{professional.specialization_count !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Link
                        to={`/profile/${professional.user_id}`}
                        className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                      >
                        View Profile
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
};

export default BrowseProfessionals;
