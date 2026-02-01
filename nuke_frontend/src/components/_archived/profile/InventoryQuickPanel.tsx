import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface ShopItem {
  id: string;
  owner_id: string;
  name: string;
  type?: string | null;
  brand?: string | null;
  model?: string | null;
  images?: string[] | null;
  for_sale?: boolean | null;
  price_cents?: number | null;
  affiliate_url?: string | null;
}

const InventoryQuickPanel: React.FC<{ userId: string; isOwnProfile: boolean }> = ({ userId, isOwnProfile }) => {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('shop_items')
          .select('id, owner_id, name, type, brand, model, images, for_sale, price_cents, affiliate_url')
          .eq('owner_id', userId)
          .limit(8);
        if (!error && data) setItems(data as any);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userId]);

  return (
    <div className="card">
      <div className="card-body">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text font-bold">Shop Inventory</h4>
          {isOwnProfile && <button className="button button-small">Add Item</button>}
        </div>
        {loading && <div className="text-small text-muted">Loading…</div>}
        {!loading && items.length === 0 && (
          <div className="text-small text-muted">No items yet</div>
        )}
        <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 8 }}>
          {items.map(it => (
            <div key={it.id} className="flex items-center gap-2 border rounded p-2">
              <div style={{ width: 48, height: 48, borderRadius: 6, background: 'var(--bg)', overflow: 'hidden' }}>
                {Array.isArray(it.images) && it.images[0] && (
                  <img src={it.images[0]} alt={it.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                )}
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold truncate">{it.name}</div>
                <div className="text-xs text-gray-500 truncate">{[it.brand, it.model].filter(Boolean).join(' ')}</div>
                {/* Price */}
                {typeof it.price_cents === 'number' && it.price_cents > 0 && (
                  <div className="text-xs" style={{ color: '#111827' }}>
                    ${ (it.price_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {it.for_sale && (
                  <div className="text-xs badge badge-success">For Sale</div>
                )}
                {/* External link (affiliate or product URL) */}
                {it.affiliate_url && (
                  <a
                    href={it.affiliate_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="button button-small button-secondary"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default InventoryQuickPanel;
