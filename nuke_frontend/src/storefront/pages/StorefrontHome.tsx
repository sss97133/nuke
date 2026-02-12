import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { StorefrontOrg } from '../StorefrontApp';

interface Props {
  organization: StorefrontOrg;
}

interface VehicleSummary {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  image_url: string | null;
  primary_image_url: string | null;
  sale_price: number | null;
  asking_price: number | null;
  mileage: number | null;
  transmission: string | null;
  exterior_color: string | null;
  vin: string | null;
}

export default function StorefrontHome({ organization }: Props) {
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    (async () => {
      const featuredIds: string[] = organization.ui_config?.storefront?.layout?.featuredVehicleIds || [];

      // Get count
      const { count } = await supabase
        .from('organization_vehicles')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organization.id)
        .eq('status', 'active');
      setTotalCount(count || 0);

      // Get featured or latest 8
      let query = supabase
        .from('organization_vehicles')
        .select(`
          vehicle_id,
          vehicles!inner(id, year, make, model, trim, image_url, primary_image_url, sale_price, asking_price, mileage, transmission, exterior_color, vin)
        `)
        .eq('organization_id', organization.id)
        .eq('status', 'active');

      if (featuredIds.length > 0) {
        query = query.in('vehicle_id', featuredIds);
      } else {
        query = query.order('created_at', { ascending: false }).limit(8);
      }

      const { data, error } = await query;
      if (!error && data) {
        setVehicles(data.map((d: any) => d.vehicles));
      }
      setLoading(false);
    })();
  }, [organization]);

  const formatPrice = (v: VehicleSummary) => {
    const price = v.sale_price || v.asking_price;
    if (!price) return null;
    return '$' + price.toLocaleString();
  };

  const formatTitle = (v: VehicleSummary) => {
    return [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
  };

  const getImage = (v: VehicleSummary) => {
    return v.primary_image_url || v.image_url || null;
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Arial, sans-serif', fontSize: 'var(--fs-9, 9px)', color: 'var(--text-secondary)' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* Org Description */}
      {organization.description && (
        <p style={{ fontSize: 'var(--fs-9, 9px)', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24, maxWidth: 700 }}>
          {organization.description}
        </p>
      )}

      {/* Section Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <h2 style={{ fontSize: 'var(--fs-10, 10px)', fontWeight: 700, color: 'var(--text)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Featured Vehicles
        </h2>
        {totalCount > vehicles.length && (
          <Link to="/inventory" style={{ fontSize: 'var(--fs-8, 8px)', color: 'var(--accent)', textDecoration: 'none' }}>
            View All {totalCount} &rarr;
          </Link>
        )}
      </div>

      {/* Vehicle Grid */}
      {vehicles.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {vehicles.map((v) => (
            <Link
              key={v.id}
              to={`/vehicles/${v.id}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div style={{
                background: 'var(--surface)',
                border: '2px solid var(--border)',
                overflow: 'hidden',
                transition: 'border-color 0.12s',
              }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              >
                {/* Image */}
                <div style={{ aspectRatio: '16/10', background: 'var(--bg)', overflow: 'hidden' }}>
                  {getImage(v) ? (
                    <img
                      src={getImage(v)!}
                      alt={formatTitle(v)}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-disabled)', fontSize: 'var(--fs-8, 8px)' }}>
                      No Image
                    </div>
                  )}
                </div>

                {/* Info */}
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: 'var(--fs-9, 9px)', fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                    {formatTitle(v)}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 8, fontSize: 'var(--fs-8, 8px)', color: 'var(--text-secondary)' }}>
                      {v.mileage && <span>{v.mileage.toLocaleString()} mi</span>}
                      {v.transmission && <span>{v.transmission}</span>}
                      {v.exterior_color && <span>{v.exterior_color}</span>}
                    </div>
                    {formatPrice(v) && (
                      <span style={{ fontSize: 'var(--fs-9, 9px)', fontWeight: 700, color: 'var(--accent)', fontFamily: 'monospace' }}>
                        {formatPrice(v)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--fs-9, 9px)' }}>
          No vehicles listed yet.
        </div>
      )}
    </div>
  );
}
