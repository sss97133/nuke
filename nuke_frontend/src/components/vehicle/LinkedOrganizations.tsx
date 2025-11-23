import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { FiMapPin, FiTool, FiDollarSign, FiTruck, FiShoppingCart } from 'react-icons/fi';

interface LinkedOrganizationsProps {
  vehicleId: string;
  initialOrganizations?: LinkedOrg[];
}

export interface LinkedOrg {
  id: string;
  organization_id: string;
  relationship_type: string;
  auto_tagged: boolean;
  gps_match_confidence?: number;
  business_name: string;
  business_type?: string;
  city?: string;
  state?: string;
  logo_url?: string;
}

const RELATIONSHIP_ICONS: Record<string, React.ComponentType> = {
  owner: FiDollarSign,
  service_provider: FiTool,
  work_location: FiMapPin,
  seller: FiShoppingCart,
  buyer: FiShoppingCart,
  parts_supplier: FiTruck,
  fabricator: FiTool,
  painter: FiTool,
  upholstery: FiTool,
  transport: FiTruck,
  storage: FiMapPin,
  inspector: FiTool,
  collaborator: FiTool
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  owner: 'Owner',
  service_provider: 'Service Provider',
  work_location: 'Work Location',
  seller: 'Seller',
  buyer: 'Buyer',
  parts_supplier: 'Parts Supplier',
  fabricator: 'Fabricator',
  painter: 'Paint Shop',
  upholstery: 'Upholstery Shop',
  transport: 'Transport',
  storage: 'Storage',
  inspector: 'Inspector',
  collaborator: 'Collaborator',
  consigner: 'Consignment'
};

const LinkedOrganizations: React.FC<LinkedOrganizationsProps> = ({ vehicleId, initialOrganizations }) => {
  const [organizations, setOrganizations] = useState<LinkedOrg[]>(initialOrganizations ?? []);
  const [loading, setLoading] = useState(initialOrganizations === undefined);

  useEffect(() => {
    if (initialOrganizations !== undefined) {
      setOrganizations(initialOrganizations);
      setLoading(false);
      return;
    }
    loadOrganizations();
  }, [vehicleId, initialOrganizations]);

  const loadOrganizations = async () => {
    try {
      console.log('[LinkedOrganizations] Loading for vehicle:', vehicleId);
      
      const { data, error } = await supabase
        .from('organization_vehicles')
        .select(`
          id,
          organization_id,
          relationship_type,
          auto_tagged,
          gps_match_confidence,
          businesses!inner (
            id,
            business_name,
            business_type,
            city,
            state,
            logo_url
          )
        `)
        .eq('vehicle_id', vehicleId)
        .eq('status', 'active');

      if (error) {
        console.error('[LinkedOrganizations] Query error:', error);
        throw error;
      }
      
      console.log('[LinkedOrganizations] Found', data?.length || 0, 'organizations');

      const enriched = (data || []).map((ov: any) => ({
        id: ov.id,
        organization_id: ov.organization_id,
        relationship_type: ov.relationship_type,
        auto_tagged: ov.auto_tagged,
        gps_match_confidence: ov.gps_match_confidence,
        business_name: ov.businesses.business_name,
        business_type: ov.businesses.business_type,
        city: ov.businesses.city,
        state: ov.businesses.state,
        logo_url: ov.businesses.logo_url
      }));

      setOrganizations(enriched);
      console.log('[LinkedOrganizations] Rendered', enriched.length, 'org cards');
    } catch (error) {
      console.error('[LinkedOrganizations] Failed to load:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-semibold">Linked Organizations</h3>
        </div>
        <div className="card-body">
          <div className="text-center text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  if (organizations.length === 0) {
    console.log('[LinkedOrganizations] No organizations found, hiding component');
    return null; // Don't show card if no organizations
  }
  
  console.log('[LinkedOrganizations] Rendering card with', organizations.length, 'organizations');

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="text-lg font-semibold">Associated Organizations</h3>
        <p className="text-sm text-gray-600 mt-1">
          Shops, dealers, and other businesses linked to this vehicle
        </p>
      </div>
      <div className="card-body">
        <div className="space-y-3">
          {organizations.map((org) => {
            const Icon = RELATIONSHIP_ICONS[org.relationship_type || 'service_provider'] || FiMapPin;
            const relationshipLabel = RELATIONSHIP_LABELS[org.relationship_type || 'service_provider'] || org.relationship_type || 'Unknown';

            return (
              <Link
                key={org.id}
                to={`/org/${org.organization_id}`}
                className="block p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all"
              >
                <div className="flex items-start gap-3">
                  {/* Logo or Icon */}
                  <div className="flex-shrink-0">
                    {org.logo_url ? (
                      <img
                        src={org.logo_url}
                        alt={org.business_name}
                        className="w-12 h-12 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
                        <Icon className="w-6 h-6 text-gray-400" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-gray-900 truncate">
                        {org.business_name}
                      </h4>
                      {org.auto_tagged && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          Auto-linked
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-sm text-gray-600">
                      <span className="flex items-center gap-1">
                        <Icon className="w-4 h-4" />
                        {relationshipLabel}
                      </span>
                      {(org.city || org.state) && (
                        <span className="flex items-center gap-1">
                          <FiMapPin className="w-4 h-4" />
                          {org.city}{org.city && org.state && ', '}{org.state}
                        </span>
                      )}
                    </div>

                    {org.auto_tagged && org.gps_match_confidence && (
                      <div className="mt-1 text-xs text-gray-500">
                        GPS match: {Math.round(org.gps_match_confidence)}% confidence
                      </div>
                    )}
                  </div>

                  {/* Arrow */}
                  <div className="flex-shrink-0 self-center">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {organizations.some(o => o.auto_tagged) && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
            <div className="font-medium">🎯 Auto-linked from GPS data</div>
            <div className="mt-1 text-blue-700">
              Organizations were automatically detected from image location data and receipt information.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LinkedOrganizations;

