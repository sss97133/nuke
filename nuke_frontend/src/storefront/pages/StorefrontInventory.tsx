import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { StorefrontOrg } from '../StorefrontApp';

interface Props {
  organization: StorefrontOrg;
}

interface Vehicle {
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
  body_style: string | null;
}

export default function StorefrontInventory({ organization }: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'price-low' | 'price-high' | 'year'>('newest');

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('organization_vehicles')
        .select(`
          vehicle_id,
          created_at,
          vehicles!inner(id, year, make, model, trim, image_url, primary_image_url, sale_price, asking_price, mileage, transmission, exterior_color, vin, body_style)
        `)
        .eq('organization_id', organization.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (!error && data) {
        setVehicles(data.map((d: any) => d.vehicles));
      }
      setLoading(false);
    })();
  }, [organization]);

  const filtered = useMemo(() => {
    let list = vehicles;

    // Text filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((v) => {
        const text = [v.year, v.make, v.model, v.trim, v.exterior_color, v.vin].filter(Boolean).join(' ').toLowerCase();
        return text.includes(q);
      });
    }

    // Sort
    list = [...list].sort((a, b) => {
      switch (sortBy) {
        case 'price-low':
          return ((a.sale_price || a.asking_price) || Infinity) - ((b.sale_price || b.asking_price) || Infinity);
        case 'price-high':
          return ((b.sale_price || b.asking_price) || 0) - ((a.sale_price || a.asking_price) || 0);
        case 'year':
          return (b.year || 0) - (a.year || 0);
        default:
          return 0; // already sorted by newest from query
      }
    });

    return list;
  }, [vehicles, search, sortBy]);

  const formatTitle = (v: Vehicle) => [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
  const formatPrice = (v: Vehicle) => {
    const price = v.sale_price || v.asking_price;
    return price ? '$' + price.toLocaleString() : null;
  };
  const getImage = (v: Vehicle) => v.primary_image_url || v.image_url || null;

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Arial, sans-serif', fontSize: 'var(--fs-9, 9px)', color: 'var(--text-secondary)' }}>
        Loading inventory...
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* Header + Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontSize: 'var(--fs-10, 10px)', fontWeight: 700, color: 'var(--text)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Inventory ({filtered.length})
        </h2>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '4px 8px',
              fontSize: 'var(--fs-8, 8px)',
              fontFamily: 'Arial, sans-serif',
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              outline: 'none',
              width: 160,
            }}
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            style={{
              padding: '4px 6px',
              fontSize: 'var(--fs-8, 8px)',
              fontFamily: 'Arial, sans-serif',
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
            }}
          >
            <option value="newest">Newest</option>
            <option value="price-low">Price: Low to High</option>
            <option value="price-high">Price: High to Low</option>
            <option value="year">Year</option>
          </select>
        </div>
      </div>

      {/* Grid */}
      {filtered.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {filtered.map((v) => (
            <Link key={v.id} to={`/vehicles/${v.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div
                style={{
                  background: 'var(--surface)',
                  border: '2px solid var(--border)',
                  overflow: 'hidden',
                  transition: 'border-color 0.12s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              >
                <div style={{ aspectRatio: '16/10', background: 'var(--bg)', overflow: 'hidden' }}>
                  {getImage(v) ? (
                    <img src={getImage(v)!} alt={formatTitle(v)} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-disabled)', fontSize: 'var(--fs-8, 8px)' }}>
                      No Image
                    </div>
                  )}
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: 'var(--fs-9, 9px)', fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                    {formatTitle(v)}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 8, fontSize: 'var(--fs-8, 8px)', color: 'var(--text-secondary)' }}>
                      {v.mileage && <span>{v.mileage.toLocaleString()} mi</span>}
                      {v.transmission && <span>{v.transmission}</span>}
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
          {search ? 'No vehicles match your search.' : 'No vehicles in inventory.'}
        </div>
      )}
    </div>
  );
}
