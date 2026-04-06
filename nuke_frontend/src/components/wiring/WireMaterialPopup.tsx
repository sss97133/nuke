// WireMaterialPopup.tsx — Wire product detail popup
// Shows: product photo, gauge AWG+mm², color hex swatch, price/ft, total cost,
// terminal compatibility, protection required. Renders inline in detail panel.

import React from 'react';
import type { WireProduct, GaugeConversion } from './useWireCatalog';
import type { WireSpec } from './overlayCompute';

// ── Shared styles ─────────────────────────────────────────────────────
const label: React.CSSProperties = {
  fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px',
  color: 'var(--text-secondary, #666)', fontWeight: 700, fontFamily: 'Arial, sans-serif',
};
const val: React.CSSProperties = {
  fontSize: '10px', fontFamily: '"Courier New", monospace', fontWeight: 700,
  color: 'var(--text, #2a2a2a)',
};
const row: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
  padding: '3px 0', borderBottom: '1px solid var(--border, #bdbdbd)',
};
const sectionTitle: React.CSSProperties = {
  ...label, fontSize: '7px', letterSpacing: '1px', marginBottom: 4,
  paddingBottom: 3, borderBottom: '2px solid var(--text, #2a2a2a)',
};

// ── Props ─────────────────────────────────────────────────────────────
interface Props {
  wire: WireSpec;
  product?: WireProduct;
  gaugeInfo?: GaugeConversion;
  tierLabel: string;
  terminalCompatibility?: {
    compatible: boolean;
    terminalSize: string | null;
    notes: string | null;
  };
}

export function WireMaterialPopup({ wire, product, gaugeInfo, tierLabel, terminalCompatibility }: Props) {
  const totalCost = product?.price_per_ft != null
    ? Math.round(product.price_per_ft * wire.lengthFt * 100) / 100
    : null;

  return (
    <div style={{ fontFamily: 'Arial, sans-serif' }}>
      <div style={sectionTitle}>WIRE MATERIAL — {tierLabel}</div>

      {/* Color swatch + product image */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        {/* Color swatch */}
        <div style={{
          width: 24, height: 24,
          border: '2px solid var(--text, #2a2a2a)',
          background: product?.color_hex || '#bdbdbd',
          position: 'relative',
        }}>
          {product?.stripe_hex && (
            <div style={{
              position: 'absolute', top: 0, left: '50%', width: '30%', height: '100%',
              background: product.stripe_hex,
            }} />
          )}
        </div>

        <div>
          <div style={{ ...val, fontSize: '11px' }}>
            {wire.color} — {wire.gauge} AWG
            {gaugeInfo ? ` (${gaugeInfo.mm2}mm\u00B2)` : ''}
          </div>
          <div style={{ fontSize: '7px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            {product?.mil_spec || 'UNSPECIFIED'} {product?.trade_name || ''}
          </div>
        </div>
      </div>

      {/* Product image */}
      {product?.product_image_url && (
        <div style={{
          marginBottom: 8, display: 'flex', justifyContent: 'center',
          background: '#fff', padding: 6,
          border: '1px solid var(--border)',
        }}>
          <img
            src={product.product_image_url}
            alt={`${wire.gauge}AWG ${wire.color}`}
            style={{ maxWidth: '100%', maxHeight: 80, objectFit: 'contain' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      {/* Specs */}
      <div style={row}>
        <span style={label}>GAUGE</span>
        <span style={val}>
          {wire.gauge} AWG
          {gaugeInfo ? ` / ${gaugeInfo.mm2}mm\u00B2 / ${gaugeInfo.diameter_inches}"` : ''}
        </span>
      </div>
      <div style={row}>
        <span style={label}>COLOR</span>
        <span style={{ ...val, display: 'flex', alignItems: 'center', gap: 4 }}>
          {wire.color}
          {product?.color_hex && (
            <span style={{
              display: 'inline-block', width: 10, height: 10,
              border: '1px solid var(--border)', background: product.color_hex,
            }} />
          )}
        </span>
      </div>
      {product?.insulation && (
        <div style={row}>
          <span style={label}>INSULATION</span>
          <span style={val}>{product.insulation}</span>
        </div>
      )}
      {product?.temp_rating_c && (
        <div style={row}>
          <span style={label}>TEMP RATING</span>
          <span style={val}>{product.temp_rating_c}C ({Math.round(product.temp_rating_c * 9/5 + 32)}F)</span>
        </div>
      )}
      {product?.od_inches && (
        <div style={row}>
          <span style={label}>OD</span>
          <span style={val}>{product.od_inches}" ({product.od_mm}mm)</span>
        </div>
      )}
      {gaugeInfo?.max_amps_chassis && (
        <div style={row}>
          <span style={label}>MAX AMPS (CHASSIS)</span>
          <span style={val}>{gaugeInfo.max_amps_chassis}A</span>
        </div>
      )}

      {/* Pricing */}
      <div style={{ ...sectionTitle, marginTop: 8 }}>PRICING</div>
      <div style={row}>
        <span style={label}>PRICE/FT</span>
        <span style={val}>
          {product?.price_per_ft != null ? `$${product.price_per_ft.toFixed(3)}` : '—'}
        </span>
      </div>
      <div style={row}>
        <span style={label}>LENGTH</span>
        <span style={val}>{wire.lengthFt.toFixed(1)} ft</span>
      </div>
      <div style={row}>
        <span style={label}>WIRE COST</span>
        <span style={{ ...val, color: totalCost != null ? 'var(--text)' : 'var(--text-secondary)' }}>
          {totalCost != null ? `$${totalCost.toFixed(2)}` : '—'}
        </span>
      </div>

      {/* Supplier */}
      {product?.supplier && (
        <>
          <div style={{ ...sectionTitle, marginTop: 8 }}>SUPPLIER</div>
          <div style={row}>
            <span style={label}>VENDOR</span>
            <span style={val}>{product.supplier}</span>
          </div>
          {product.supplier_sku && (
            <div style={row}>
              <span style={label}>SKU</span>
              <span style={val}>{product.supplier_sku}</span>
            </div>
          )}
          {product.in_stock != null && (
            <div style={row}>
              <span style={label}>IN STOCK</span>
              <span style={{
                ...val,
                color: product.in_stock ? 'var(--success, #16825d)' : 'var(--error, #d13438)',
              }}>
                {product.in_stock ? 'YES' : 'NO'}
              </span>
            </div>
          )}
          {product.min_order_ft && (
            <div style={row}>
              <span style={label}>MIN ORDER</span>
              <span style={val}>{product.min_order_ft} ft</span>
            </div>
          )}
        </>
      )}

      {/* Terminal compatibility */}
      {terminalCompatibility && (
        <>
          <div style={{ ...sectionTitle, marginTop: 8 }}>TERMINAL FIT</div>
          <div style={row}>
            <span style={label}>COMPATIBLE</span>
            <span style={{
              ...val,
              color: terminalCompatibility.compatible ? 'var(--success, #16825d)' : 'var(--error, #d13438)',
            }}>
              {terminalCompatibility.compatible ? 'YES' : 'NO'}
            </span>
          </div>
          {terminalCompatibility.terminalSize && (
            <div style={row}>
              <span style={label}>TERMINAL SIZE</span>
              <span style={val}>{terminalCompatibility.terminalSize}</span>
            </div>
          )}
          {terminalCompatibility.notes && (
            <div style={{
              fontSize: '7px', color: 'var(--warning, #b05a00)', marginTop: 3,
              textTransform: 'uppercase', fontWeight: 700,
            }}>
              {terminalCompatibility.notes}
            </div>
          )}
        </>
      )}

      {/* Protection */}
      {(wire.isShielded || wire.isTwistedPair) && (
        <>
          <div style={{ ...sectionTitle, marginTop: 8 }}>PROTECTION</div>
          {wire.isShielded && (
            <div style={row}>
              <span style={label}>SHIELDED</span>
              <span style={val}>YES — BRAIDED SHIELD REQUIRED</span>
            </div>
          )}
          {wire.isTwistedPair && (
            <div style={row}>
              <span style={label}>TWISTED PAIR</span>
              <span style={val}>YES — CAN BUS</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
