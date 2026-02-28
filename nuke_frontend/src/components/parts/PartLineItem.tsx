/**
 * PartLineItem - Interchangeable part selector
 *
 * Shows a part with dropdown to swap alternatives.
 * Simple: Brand | Condition | Retailer | Price
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface Alternative {
  id: string;
  brand: string;
  part_number: string | null;
  condition: string;
  retailer: string;
  price: number;
  store_location: string | null;
  in_stock: boolean;
  is_selected: boolean;
  notes: string | null;
}

interface PartLineItemProps {
  partId: string;
  partName: string;
  brand: string | null;
  partNumber: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  supplier: string | null;
  priority: 'critical' | 'normal' | 'later';
  status: string;
  notes: string | null;
  onPriceChange?: (newTotal: number) => void;
  onPriorityChange?: (newPriority: string) => void;
}

export const PartLineItem: React.FC<PartLineItemProps> = ({
  partId,
  partName,
  brand,
  partNumber,
  quantity,
  unitPrice,
  totalPrice,
  supplier,
  priority,
  status,
  notes,
  onPriceChange,
  onPriorityChange
}) => {
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selectedAlt, setSelectedAlt] = useState<string | null>(null);
  const [currentPrice, setCurrentPrice] = useState(unitPrice);

  // Load alternatives on expand
  useEffect(() => {
    if (expanded && alternatives.length === 0) {
      loadAlternatives();
    }
  }, [expanded]);

  const loadAlternatives = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('part_alternatives')
      .select('*')
      .eq('work_order_part_id', partId)
      .order('price', { ascending: true });

    if (data) {
      setAlternatives(data);
      const selected = data.find(a => a.is_selected);
      if (selected) setSelectedAlt(selected.id);
    }
    setLoading(false);
  };

  const selectAlternative = async (altId: string) => {
    const alt = alternatives.find(a => a.id === altId);
    if (!alt) return;

    // Update selection in DB
    await supabase
      .from('part_alternatives')
      .update({ is_selected: false })
      .eq('work_order_part_id', partId);

    await supabase
      .from('part_alternatives')
      .update({ is_selected: true })
      .eq('id', altId);

    // Update main part price
    await supabase
      .from('work_order_parts')
      .update({
        unit_price: alt.price,
        total_price: alt.price * quantity,
        brand: alt.brand,
        part_number: alt.part_number,
        supplier: alt.retailer
      })
      .eq('id', partId);

    setSelectedAlt(altId);
    setCurrentPrice(alt.price);
    setAlternatives(prev => prev.map(a => ({ ...a, is_selected: a.id === altId })));

    if (onPriceChange) {
      onPriceChange(alt.price * quantity);
    }
  };

  const updatePriority = async (newPriority: string) => {
    await supabase
      .from('work_order_parts')
      .update({ priority: newPriority })
      .eq('id', partId);

    if (onPriorityChange) {
      onPriorityChange(newPriority);
    }
  };

  const priorityBadge = {
    critical: { bg: 'var(--error-dim)', color: 'var(--error)', label: 'CRITICAL' },
    normal: { bg: 'var(--bg)', color: 'var(--text)', label: 'NORMAL' },
    later: { bg: 'var(--bg)', color: 'var(--accent)', label: 'LATER' }
  }[priority] || { bg: 'var(--bg)', color: 'var(--text)', label: 'NORMAL' };

  const retailerIcon = (retailer: string) => {
    const icons: Record<string, string> = {
      autozone: '🔴',
      oreilly: '🟢',
      rockauto: '🟡',
      amazon: '📦',
      ebay: '🏷️',
      summitracing: '🏁',
      lmc: '🚛',
      costco: '🏪'
    };
    return icons[retailer.toLowerCase()] || '🔧';
  };

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: priority === 'critical' ? '4px solid var(--error)' :
                  priority === 'later' ? '4px solid var(--accent)' : '4px solid var(--text-disabled)',
      marginBottom: '8px',
      background: 'var(--surface)'
    }}>
      {/* Main row - always visible */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 80px 100px 40px',
          gap: '8px',
          padding: '10px 12px',
          cursor: 'pointer',
          alignItems: 'center'
        }}
      >
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600 }}>
            {partName}
            {quantity > 1 && <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}> ×{quantity}</span>}
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {brand || 'Generic'} {partNumber && `#${partNumber}`} • {supplier || 'TBD'}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <span style={{
            fontSize: '9px',
            padding: '2px 6px',
            background: priorityBadge.bg,
            color: priorityBadge.color,
            fontWeight: 700
          }}>
            {priorityBadge.label}
          </span>
        </div>

        <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 700 }}>
          ${(currentPrice * quantity).toFixed(2)}
        </div>

        <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-secondary)' }}>
          {alternatives.length > 0 || loading ? (expanded ? '▼' : '▶') : ''}
          {alternatives.length > 0 && !expanded && (
            <div style={{ fontSize: '8px' }}>{alternatives.length}</div>
          )}
        </div>
      </div>

      {/* Expanded alternatives */}
      {expanded && (
        <div style={{
          borderTop: '1px solid var(--border)',
          background: 'var(--bg)',
          padding: '8px 12px'
        }}>
          {loading ? (
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Loading...</div>
          ) : alternatives.length === 0 ? (
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>No alternatives found</div>
          ) : (
            <>
              <div style={{
                fontSize: '9px',
                fontWeight: 700,
                marginBottom: '6px',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase'
              }}>
                Select Alternative:
              </div>

              {alternatives.map(alt => (
                <div
                  key={alt.id}
                  onClick={() => selectAlternative(alt.id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '20px 1fr 70px 70px 90px',
                    gap: '8px',
                    padding: '6px 8px',
                    marginBottom: '4px',
                    background: alt.is_selected ? 'var(--success-dim)' : 'var(--surface)',
                    border: alt.is_selected ? '2px solid var(--success)' : '1px solid var(--border)',
                    cursor: 'pointer',
                    alignItems: 'center',
                    fontSize: '11px'
                  }}
                >
                  <div>{alt.is_selected ? '●' : '○'}</div>
                  <div>
                    <span style={{ fontWeight: 600 }}>{alt.brand}</span>
                    {alt.part_number && (
                      <span
                        style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(alt.part_number!);
                          alert('Copied: ' + alt.part_number);
                        }}
                        title="Click to copy"
                      >
                        {' '}#{alt.part_number}
                      </span>
                    )}
                    {alt.notes && <span style={{ color: 'var(--text-disabled)', fontSize: '9px' }}> - {alt.notes}</span>}
                  </div>
                  <div style={{
                    color: alt.condition === 'new' ? 'var(--success)' :
                           alt.condition === 'reman' ? 'var(--warning)' : 'var(--text-secondary)',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    fontSize: '9px'
                  }}>
                    {alt.condition}
                  </div>
                  <div
                    style={{ fontSize: '9px', cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const searchUrls: Record<string, string> = {
                        autozone: `https://www.autozone.com/searchresult?searchText=${encodeURIComponent(alt.part_number || alt.brand)}`,
                        oreilly: `https://www.oreillyauto.com/search?q=${encodeURIComponent(alt.part_number || alt.brand)}`,
                        rockauto: `https://www.rockauto.com/en/partsearch/?partnum=${encodeURIComponent(alt.part_number || '')}`,
                        amazon: `https://www.amazon.com/s?k=${encodeURIComponent(alt.brand + ' ' + (alt.part_number || ''))}`,
                        summitracing: `https://www.summitracing.com/search?search_Text=${encodeURIComponent(alt.part_number || alt.brand)}`,
                        ebay: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(alt.brand + ' ' + (alt.part_number || ''))}`,
                        costco: `https://www.costco.com/CatalogSearch?keyword=${encodeURIComponent(alt.brand)}`
                      };
                      const url = searchUrls[alt.retailer.toLowerCase()] ||
                        `https://www.google.com/search?q=${encodeURIComponent(alt.brand + ' ' + (alt.part_number || '') + ' buy')}`;
                      window.open(url, '_blank');
                    }}
                    title={`Shop at ${alt.retailer}`}
                  >
                    {retailerIcon(alt.retailer)} {alt.retailer} ↗
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontWeight: 700 }}>${alt.price.toFixed(2)}</span>
                    {alt.in_stock && (
                      <div style={{ fontSize: '8px', color: 'var(--success)' }}>✓ In Stock</div>
                    )}
                    {alt.store_location && (
                      <div
                        style={{ fontSize: '8px', color: 'var(--text-secondary)', cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`https://maps.google.com/?q=${encodeURIComponent(alt.store_location!)}`, '_blank');
                        }}
                        title="Open in Maps"
                      >
                        📍 {alt.store_location.slice(0, 15)}...
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Priority selector */}
              <div style={{
                marginTop: '10px',
                paddingTop: '8px',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                gap: '8px',
                alignItems: 'center'
              }}>
                <span style={{ fontSize: '9px', color: 'var(--text-secondary)', fontWeight: 700 }}>PRIORITY:</span>
                {['critical', 'normal', 'later'].map(p => (
                  <button
                    key={p}
                    onClick={(e) => { e.stopPropagation(); updatePriority(p); }}
                    style={{
                      fontSize: '9px',
                      padding: '3px 8px',
                      border: priority === p ? '2px solid var(--text)' : '1px solid var(--border)',
                      background: priority === p ? 'var(--text)' : 'var(--surface)',
                      color: priority === p ? 'var(--bg)' : 'var(--text)',
                      cursor: 'pointer',
                      fontWeight: 600,
                      textTransform: 'uppercase'
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default PartLineItem;
