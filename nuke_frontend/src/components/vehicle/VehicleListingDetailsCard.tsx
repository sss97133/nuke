/**
 * VehicleListingDetailsCard.tsx
 *
 * Displays structured listing details extracted from auction listings:
 * highlights, equipment, modifications, known flaws, recent service history,
 * and title status. Only renders sections that have data.
 *
 * Design system: Arial, Courier New mono, zero radius, zero shadows,
 * 2px borders, ALL CAPS labels at 8-9px.
 */
import React from 'react';
import { CollapsibleWidget } from '../ui/CollapsibleWidget';

interface VehicleListingDetailsCardProps {
  vehicle: {
    highlights?: string[] | string | null;
    equipment?: string[] | string | null;
    modifications?: string[] | string | null;
    known_flaws?: string[] | string | null;
    recent_service_history?: string[] | string | null;
    title_status?: string | null;
  };
}

/** Parse a field that may be a JSON string array, a real array, or null. */
function parseList(val: string[] | string | null | undefined): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return [];
    // Try JSON parse (e.g. '["item1","item2"]')
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      } catch {
        // not JSON
      }
    }
    // Try Postgres array literal (e.g. '{"item1","item2"}')
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        // Convert Postgres array literal to JSON array and parse
        const jsonStr = '[' + trimmed.slice(1, -1) + ']';
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      } catch {
        // Try splitting on comma with quote-aware parsing
        const inner = trimmed.slice(1, -1);
        const items: string[] = [];
        let current = '';
        let inQuote = false;
        for (let i = 0; i < inner.length; i++) {
          const ch = inner[i];
          if (ch === '"' && (i === 0 || inner[i - 1] !== '\\')) {
            inQuote = !inQuote;
          } else if (ch === ',' && !inQuote) {
            items.push(current.trim());
            current = '';
          } else {
            current += ch;
          }
        }
        if (current.trim()) items.push(current.trim());
        return items.filter(Boolean);
      }
    }
    // Single value or comma-separated fallback (only if no commas in natural text)
    if (trimmed.length < 200 && trimmed.includes(',')) {
      return trimmed.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [trimmed];
  }
  return [];
}

const SectionList: React.FC<{ label: string; items: string[]; variant?: 'default' | 'warning' }> = ({ label, items, variant = 'default' }) => {
  if (items.length === 0) return null;
  const labelColor = variant === 'warning' ? 'var(--warning, #d97706)' : 'var(--text-secondary)';
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '8px',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
        color: labelColor,
        marginBottom: '4px',
        borderBottom: '1px solid var(--border)',
        paddingBottom: '3px',
      }}>
        {label}
      </div>
      <ul style={{
        margin: 0,
        paddingLeft: '14px',
        listStyleType: 'none',
      }}>
        {items.map((item, i) => (
          <li key={i} style={{
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: '10px',
            lineHeight: 1.6,
            color: 'var(--text)',
            position: 'relative',
            paddingLeft: '2px',
          }}>
            <span style={{
              position: 'absolute',
              left: '-12px',
              color: 'var(--text-disabled)',
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: '8px',
            }}>
              {variant === 'warning' ? '!' : '-'}
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
};

export const VehicleListingDetailsCard: React.FC<VehicleListingDetailsCardProps> = ({ vehicle }) => {
  const highlights = parseList(vehicle.highlights);
  const equipment = parseList(vehicle.equipment);
  const modifications = parseList(vehicle.modifications);
  const knownFlaws = parseList(vehicle.known_flaws);
  const serviceHistory = parseList(vehicle.recent_service_history);
  const titleStatus = vehicle.title_status?.trim() || null;

  const totalItems = highlights.length + equipment.length + modifications.length +
    knownFlaws.length + serviceHistory.length + (titleStatus ? 1 : 0);

  if (totalItems === 0) return null;

  return (
    <CollapsibleWidget
      variant="profile"
      title="Listing Details"
      defaultCollapsed={false}
      badge={<span className="widget__count">{totalItems} ITEMS</span>}
    >
      <div style={{ padding: '0' }}>
        <SectionList label="Highlights" items={highlights} />
        <SectionList label="Equipment" items={equipment} />
        <SectionList label="Modifications" items={modifications} />
        <SectionList label="Known Flaws" items={knownFlaws} variant="warning" />
        <SectionList label="Recent Service History" items={serviceHistory} />
        {titleStatus && (
          <div style={{ marginBottom: '4px' }}>
            <div style={{
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontSize: '8px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
              color: 'var(--text-secondary)',
              marginBottom: '4px',
              borderBottom: '1px solid var(--border)',
              paddingBottom: '3px',
            }}>
              TITLE STATUS
            </div>
            <div style={{
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontSize: '10px',
              color: 'var(--text)',
            }}>
              {titleStatus}
            </div>
          </div>
        )}
      </div>
    </CollapsibleWidget>
  );
};

export default VehicleListingDetailsCard;
