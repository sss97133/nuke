import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface SuggestedOrganization {
  organization_id: string;
  business_name: string;
  distance_meters: number;
  confidence_score: number;
  image_count: number;
  relationship_type: string;
}

interface GPSOrganizationSuggestionsProps {
  vehicleId: string;
  userId: string;
  onAssign?: () => void;
}

const GPSOrganizationSuggestions: React.FC<GPSOrganizationSuggestionsProps> = ({
  vehicleId,
  userId,
  onAssign
}) => {
  const [suggestions, setSuggestions] = useState<SuggestedOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null);

  useEffect(() => {
    loadSuggestions();
  }, [vehicleId]);

  const loadSuggestions = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .rpc('find_suggested_organizations_for_vehicle', {
          p_vehicle_id: vehicleId,
          p_max_distance_meters: 500
        });

      if (error) {
        // Function might not exist yet, that's ok
        if (error.code === '42883') {
          console.log('GPS suggestion function not available yet');
          setSuggestions([]);
          return;
        }
        throw error;
      }

      // Deduplicate by organization_id, keep best match
      const unique = new Map<string, SuggestedOrganization>();
      (data || []).forEach((s: SuggestedOrganization) => {
        const existing = unique.get(s.organization_id);
        if (!existing || s.confidence_score > existing.confidence_score) {
          unique.set(s.organization_id, s);
        }
      });

      setSuggestions(Array.from(unique.values()).sort((a, b) => b.confidence_score - a.confidence_score));
    } catch (error) {
      console.error('Error loading GPS suggestions:', error);
    } finally {
      setLoading(false);
    }
  };

  const assignToOrganization = async (orgId: string, relationshipType: string) => {
    setAssigning(orgId);
    try {
      const { error } = await supabase
        .from('organization_vehicles')
        .upsert({
          organization_id: orgId,
          vehicle_id: vehicleId,
          relationship_type: relationshipType,
          auto_tagged: true,
          linked_by_user_id: userId
        }, {
          onConflict: 'organization_id,vehicle_id,relationship_type'
        });

      if (error) throw error;

      if (onAssign) onAssign();
      // Reload suggestions to show updated state
      loadSuggestions();
    } catch (error) {
      console.error('Error assigning to organization:', error);
      alert('Failed to assign vehicle to organization');
    } finally {
      setAssigning(null);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '8px', fontSize: '7pt', color: 'var(--text-muted)' }}>
        Checking GPS coordinates...
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div style={{ padding: '8px', fontSize: '7pt', color: 'var(--text-muted)', fontStyle: 'italic' }}>
        No nearby organizations found (vehicles need GPS coordinates in images)
      </div>
    );
  }

  return (
    <div style={{
      padding: '8px',
      background: '#f0f9ff',
      border: '1px solid #93c5fd',
      borderRadius: '4px',
      fontSize: '8pt'
    }}>
      <div style={{ marginBottom: '8px', fontWeight: 600, color: '#1e40af' }}>
        Suggested Organizations (GPS-based):
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.organization_id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 8px',
              background: 'var(--surface)',
              border: '1px solid #bfdbfe',
              borderRadius: '3px'
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                {suggestion.business_name}
              </div>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                {Math.round(suggestion.distance_meters)}m away • {Math.round(suggestion.confidence_score)}% confidence
                {suggestion.image_count > 1 && ` • ${suggestion.image_count} images`}
              </div>
            </div>
            <button
              onClick={() => assignToOrganization(suggestion.organization_id, suggestion.relationship_type)}
              disabled={assigning === suggestion.organization_id}
              style={{
                padding: '4px 12px',
                fontSize: '7pt',
                fontWeight: 600,
                border: '1px solid #1e40af',
                background: '#1e40af',
                color: 'white',
                cursor: assigning === suggestion.organization_id ? 'wait' : 'pointer',
                borderRadius: '3px',
                opacity: assigning === suggestion.organization_id ? 0.5 : 1
              }}
            >
              {assigning === suggestion.organization_id ? 'Assigning...' : 'ASSIGN'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GPSOrganizationSuggestions;

