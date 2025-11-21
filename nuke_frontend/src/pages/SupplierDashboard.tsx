import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Supplier {
  id: string;
  name: string;
  type: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

interface SupplierRating {
  supplier_id: string;
  overall_score: number;
  quality_score: number;
  responsiveness_score: number;
  total_orders: number;
  on_time_deliveries: number;
  on_time_percentage: number;
  quality_issues: number;
  quality_pass_percentage: number;
  last_updated: string;
}

interface SupplierWithRating extends Supplier {
  rating: SupplierRating | null;
}

const SupplierDashboard: React.FC = () => {
  const [suppliers, setSuppliers] = useState<SupplierWithRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'name' | 'rating' | 'orders'>('rating');

  useEffect(() => {
    loadSuppliers();
  }, []);

  const loadSuppliers = async () => {
    setLoading(true);
    try {
      // Get suppliers with ratings
      const { data: suppliersData, error: suppliersError } = await supabase
        .from('suppliers')
        .select('id, name, type, phone, email, website');

      if (suppliersError) throw suppliersError;

      const { data: ratingsData, error: ratingsError } = await supabase
        .from('supplier_ratings')
        .select('*');

      if (ratingsError) throw ratingsError;

      // Combine suppliers with their ratings
      const combined = (suppliersData || []).map(supplier => {
        const rating = (ratingsData || []).find((r: any) => r.supplier_id === supplier.id);
        return {
          ...supplier,
          rating: rating ? {
            supplier_id: rating.supplier_id,
            overall_score: parseFloat(rating.overall_score || 0),
            quality_score: parseFloat(rating.quality_score || 0),
            responsiveness_score: parseFloat(rating.responsiveness_score || 0),
            total_orders: rating.total_orders || 0,
            on_time_deliveries: rating.on_time_deliveries || 0,
            on_time_percentage: parseFloat(rating.on_time_percentage || 0),
            quality_issues: rating.quality_issues || 0,
            quality_pass_percentage: parseFloat(rating.quality_pass_percentage || 0),
            last_updated: rating.last_updated
          } : null
        };
      });

      setSuppliers(combined);
    } catch (error) {
      console.error('Error loading suppliers:', error);
    } finally {
      setLoading(false);
    }
  };

  const sortedSuppliers = [...suppliers].sort((a, b) => {
    switch (sortBy) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'rating':
        return (b.rating?.overall_score || 0) - (a.rating?.overall_score || 0);
      case 'orders':
        return (b.rating?.total_orders || 0) - (a.rating?.total_orders || 0);
      default:
        return 0;
    }
  });

  const formatStars = (score: number) => {
    const stars = Math.round(score / 20);
    return '★'.repeat(stars) + '☆'.repeat(5 - stars);
  };

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', padding: 'var(--space-4)' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ 
          marginBottom: 'var(--space-4)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h1 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            Supplier Performance
          </h1>
          
          {/* Sort Options */}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-secondary)', alignSelf: 'center' }}>
              SORT BY:
            </span>
            {(['name', 'rating', 'orders'] as const).map(sort => (
              <button
                key={sort}
                onClick={() => setSortBy(sort)}
                style={{
                  padding: '4px var(--space-2)',
                  border: '2px solid var(--border)',
                  background: sortBy === sort ? 'var(--text)' : 'var(--surface)',
                  color: sortBy === sort ? 'var(--surface)' : 'var(--text)',
                  fontSize: '9px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius)',
                  textTransform: 'uppercase'
                }}
              >
                {sort}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-secondary)', fontSize: '10px' }}>
            Loading suppliers...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {sortedSuppliers.map(supplier => (
              <div
                key={supplier.id}
                style={{
                  background: 'var(--surface)',
                  border: '2px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--space-3)',
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 1fr 1fr auto',
                  gap: 'var(--space-4)',
                  alignItems: 'center'
                }}
              >
                {/* Supplier Info */}
                <div>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text)' }}>
                    {supplier.name}
                  </div>
                  <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {supplier.type && <span>{supplier.type} • </span>}
                    {supplier.phone || supplier.email || 'No contact info'}
                  </div>
                </div>

                {/* Overall Rating */}
                <div style={{ textAlign: 'center' }}>
                  {supplier.rating ? (
                    <>
                      <div style={{ 
                        fontSize: '14px',
                        color: supplier.rating.overall_score >= 95 ? 'var(--success)' : 
                               supplier.rating.overall_score >= 85 ? 'var(--warning)' : 'var(--error)'
                      }}>
                        {formatStars(supplier.rating.overall_score)}
                      </div>
                      <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text)' }}>
                        {supplier.rating.overall_score.toFixed(1)}%
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                      No ratings yet
                    </div>
                  )}
                </div>

                {/* Quality Score */}
                <div>
                  <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                    Quality
                  </div>
                  {supplier.rating ? (
                    <>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text)' }}>
                        {supplier.rating.quality_pass_percentage.toFixed(1)}%
                      </div>
                      <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                        {supplier.rating.quality_issues} issues
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>-</div>
                  )}
                </div>

                {/* On-Time Delivery */}
                <div>
                  <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                    On-Time
                  </div>
                  {supplier.rating ? (
                    <>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text)' }}>
                        {supplier.rating.on_time_percentage.toFixed(1)}%
                      </div>
                      <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                        {supplier.rating.on_time_deliveries}/{supplier.rating.total_orders} orders
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>-</div>
                  )}
                </div>

                {/* Actions */}
                <button
                  onClick={() => {
                    // Future: Detailed supplier view
                    alert(`Supplier details for ${supplier.name} coming soon`);
                  }}
                  style={{
                    padding: '4px var(--space-2)',
                    border: '2px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    fontSize: '9px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    borderRadius: 'var(--radius)'
                  }}
                >
                  VIEW
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SupplierDashboard;

