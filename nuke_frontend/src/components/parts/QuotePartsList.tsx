/**
 * QuotePartsList - Interchangeable parts quote
 *
 * Shows all parts in a work order with:
 * - Priority grouping (Critical → Normal → Later)
 * - Click to expand alternatives
 * - Running total
 * - "Buy all from X" retailer grouping
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { PartLineItem } from './PartLineItem';

interface Part {
  id: string;
  part_name: string;
  brand: string | null;
  part_number: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  supplier: string | null;
  priority: 'critical' | 'normal' | 'later';
  status: string;
  notes: string | null;
  category: string | null;
}

interface QuotePartsListProps {
  timelineEventId: string;
  workOrderId?: string;
  onTotalChange?: (total: number) => void;
}

export const QuotePartsList: React.FC<QuotePartsListProps> = ({
  timelineEventId,
  workOrderId,
  onTotalChange
}) => {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<'priority' | 'category' | 'retailer'>('priority');
  const [showLater, setShowLater] = useState(false);

  useEffect(() => {
    loadParts();
  }, [timelineEventId]);

  const loadParts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('work_order_parts')
      .select('*')
      .eq('timeline_event_id', timelineEventId)
      .order('priority', { ascending: true })
      .order('total_price', { ascending: false });

    if (data) {
      setParts(data as Part[]);
    }
    setLoading(false);
  };

  const handlePriceChange = (partId: string, newTotal: number) => {
    setParts(prev => prev.map(p =>
      p.id === partId ? { ...p, total_price: newTotal, unit_price: newTotal / p.quantity } : p
    ));
  };

  const handlePriorityChange = (partId: string, newPriority: string) => {
    setParts(prev => prev.map(p =>
      p.id === partId ? { ...p, priority: newPriority as any } : p
    ));
  };

  // Group parts
  const criticalParts = parts.filter(p => p.priority === 'critical');
  const normalParts = parts.filter(p => p.priority === 'normal');
  const laterParts = parts.filter(p => p.priority === 'later');

  // Totals
  const criticalTotal = criticalParts.reduce((sum, p) => sum + p.total_price, 0);
  const normalTotal = normalParts.reduce((sum, p) => sum + p.total_price, 0);
  const laterTotal = laterParts.reduce((sum, p) => sum + p.total_price, 0);
  const activeTotal = criticalTotal + normalTotal;
  const grandTotal = activeTotal + laterTotal;

  // Retailer summary
  const retailerTotals = parts.reduce((acc, p) => {
    const r = (p.supplier || 'TBD').toLowerCase();
    acc[r] = (acc[r] || 0) + p.total_price;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return <div style={{ padding: '20px', fontSize: '12px', color: 'var(--text-secondary)' }}>Loading parts...</div>;
  }

  return (
    <div style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* Summary header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px',
        background: 'var(--bg-secondary)',
        borderBottom: '2px solid var(--text)',
        marginBottom: '12px'
      }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700 }}>
            PARTS QUOTE
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {parts.length} items • Click to see alternatives
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '16px', fontWeight: 700 }}>
            ${activeTotal.toFixed(2)}
          </div>
          {laterTotal > 0 && (
            <div style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
              +${laterTotal.toFixed(2)} later
            </div>
          )}
        </div>
      </div>

      {/* Critical parts */}
      {criticalParts.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--error)',
            padding: '4px 12px',
            background: 'var(--error-dim)',
            display: 'flex',
            justifyContent: 'space-between'
          }}>
            <span>🔴 CRITICAL - Need Now ({criticalParts.length})</span>
            <span>${criticalTotal.toFixed(2)}</span>
          </div>
          <div style={{ padding: '8px 12px' }}>
            {criticalParts.map(part => (
              <PartLineItem
                key={part.id}
                partId={part.id}
                partName={part.part_name}
                brand={part.brand}
                partNumber={part.part_number}
                quantity={part.quantity}
                unitPrice={part.unit_price}
                totalPrice={part.total_price}
                supplier={part.supplier}
                priority={part.priority}
                status={part.status}
                notes={part.notes}
                onPriceChange={(newTotal) => handlePriceChange(part.id, newTotal)}
                onPriorityChange={(newPriority) => handlePriorityChange(part.id, newPriority)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Normal parts */}
      {normalParts.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--text)',
            padding: '4px 12px',
            background: 'var(--bg-secondary)',
            display: 'flex',
            justifyContent: 'space-between'
          }}>
            <span>⚪ NORMAL ({normalParts.length})</span>
            <span>${normalTotal.toFixed(2)}</span>
          </div>
          <div style={{ padding: '8px 12px' }}>
            {normalParts.map(part => (
              <PartLineItem
                key={part.id}
                partId={part.id}
                partName={part.part_name}
                brand={part.brand}
                partNumber={part.part_number}
                quantity={part.quantity}
                unitPrice={part.unit_price}
                totalPrice={part.total_price}
                supplier={part.supplier}
                priority={part.priority}
                status={part.status}
                notes={part.notes}
                onPriceChange={(newTotal) => handlePriceChange(part.id, newTotal)}
                onPriorityChange={(newPriority) => handlePriorityChange(part.id, newPriority)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Later / Saved parts */}
      {laterParts.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div
            onClick={() => setShowLater(!showLater)}
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--accent)',
              padding: '4px 12px',
              background: 'var(--info-bg)',
              display: 'flex',
              justifyContent: 'space-between',
              cursor: 'pointer'
            }}
          >
            <span>🔵 LATER - Pipedream ({laterParts.length}) {showLater ? '▼' : '▶'}</span>
            <span>${laterTotal.toFixed(2)}</span>
          </div>
          {showLater && (
            <div style={{ padding: '8px 12px' }}>
              {laterParts.map(part => (
                <PartLineItem
                  key={part.id}
                  partId={part.id}
                  partName={part.part_name}
                  brand={part.brand}
                  partNumber={part.part_number}
                  quantity={part.quantity}
                  unitPrice={part.unit_price}
                  totalPrice={part.total_price}
                  supplier={part.supplier}
                  priority={part.priority}
                  status={part.status}
                  notes={part.notes}
                  onPriceChange={(newTotal) => handlePriceChange(part.id, newTotal)}
                  onPriorityChange={(newPriority) => handlePriorityChange(part.id, newPriority)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Retailer summary */}
      <div style={{
        padding: '12px',
        background: 'var(--surface)',
        borderTop: '2px solid var(--text)'
      }}>
        <div style={{
          fontSize: '11px',
          fontWeight: 700,
          marginBottom: '8px',
          textTransform: 'uppercase'
        }}>
          By Retailer
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {Object.entries(retailerTotals)
            .sort((a, b) => b[1] - a[1])
            .map(([retailer, total]) => (
              <div
                key={retailer}
                style={{
                  fontSize: '9px',
                  padding: '4px 8px',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)'
                }}
              >
                <span style={{ fontWeight: 600 }}>{retailer}</span>
                <span style={{ marginLeft: '6px', color: 'var(--text-secondary)' }}>${total.toFixed(2)}</span>
              </div>
            ))}
        </div>
      </div>

      {/* Grand total */}
      <div style={{
        padding: '16px 12px',
        background: 'var(--text)',
        color: 'var(--bg)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <div style={{ fontSize: '11px', textTransform: 'uppercase' }}>Active Total</div>
          <div style={{ fontSize: '9px', opacity: 0.7 }}>
            {criticalParts.length + normalParts.length} items ready to order
          </div>
        </div>
        <div style={{ fontSize: '19px', fontWeight: 700 }}>
          ${activeTotal.toFixed(2)}
        </div>
      </div>
    </div>
  );
};

export default QuotePartsList;
