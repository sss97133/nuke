import * as React from "react"
import { useState, useCallback } from "react"

// Nuke Design System — Canonical Badge Component
// Spec: docs/architecture/BADGE_ONTOLOGY.md
// Rules: 0px border-radius, ALL CAPS, CSS vars only, Courier New for values, Arial for labels
// Every badge is clickable. No dead badges. No decorative badges.

// ---------------------------------------------------------------------------
// Dimension type — the ontology of every data point that can be a badge
// ---------------------------------------------------------------------------

export type BadgeDimension =
  | 'make' | 'model' | 'year' | 'body' | 'source' | 'drive' | 'trans'
  | 'price' | 'estimate' | 'bids' | 'comments' | 'watchers' | 'images'
  | 'mileage' | 'deal_score' | 'heat'
  | 'live' | 'sold' | 'for_sale' | 'verified' | 'viewed' | 'ends'

// ---------------------------------------------------------------------------
// Variant — auto-derived from dimension, or manually specified
// ---------------------------------------------------------------------------

export type BadgeVariant =
  | 'dimension'  // navigational: make, model, year, body, source, drive, trans
  | 'metric'     // data display: price, estimate, bids, comments, watchers, images, mileage, deal_score, heat
  | 'status'     // state indicator: live, sold, for_sale, verified, viewed, ends
  // Legacy variants (backward compat with old Badge API)
  | 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'danger'

export type BadgeSize = 'sm' | 'md' | 'lg'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Ontology dimension this badge represents. When set, drives variant/styling automatically. */
  dimension?: BadgeDimension
  /** Display value (label text for dimension badges, formatted number for metrics) */
  value?: string | number
  /** Optional count shown as secondary text */
  count?: number
  /** Click handler — every badge should be clickable per spec */
  onClick?: (e: React.MouseEvent<HTMLSpanElement>) => void
  /** Size preset mapping to the sizing table in BADGE_ONTOLOGY.md */
  size?: BadgeSize
  /** Explicit variant override. Auto-derived from dimension if not set. */
  variant?: BadgeVariant
  /** Children — for backward compatibility with old Badge API */
  children?: React.ReactNode
}

// ---------------------------------------------------------------------------
// Dimension -> variant mapping
// ---------------------------------------------------------------------------

const DIMENSION_DIMENSIONS: BadgeDimension[] = [
  'make', 'model', 'year', 'body', 'source', 'drive', 'trans',
]
const METRIC_DIMENSIONS: BadgeDimension[] = [
  'price', 'estimate', 'bids', 'comments', 'watchers', 'images',
  'mileage', 'deal_score', 'heat',
]
const STATUS_DIMENSIONS: BadgeDimension[] = [
  'live', 'sold', 'for_sale', 'verified', 'viewed', 'ends',
]

function variantFromDimension(dim: BadgeDimension): 'dimension' | 'metric' | 'status' {
  if (DIMENSION_DIMENSIONS.includes(dim)) return 'dimension'
  if (METRIC_DIMENSIONS.includes(dim)) return 'metric'
  if (STATUS_DIMENSIONS.includes(dim)) return 'status'
  return 'dimension'
}

// ---------------------------------------------------------------------------
// Dimension labels (7px uppercase label shown above value in metric badges)
// ---------------------------------------------------------------------------

const DIMENSION_LABELS: Partial<Record<BadgeDimension, string>> = {
  price: 'PRICE',
  estimate: 'EST',
  bids: 'BIDS',
  comments: 'COMMENTS',
  watchers: 'WATCHERS',
  images: 'PHOTOS',
  mileage: 'MI',
  deal_score: 'DEAL',
  heat: 'HEAT',
}

// ---------------------------------------------------------------------------
// Status indicator colors
// ---------------------------------------------------------------------------

const STATUS_COLORS: Partial<Record<BadgeDimension, string>> = {
  live: '#16825d',
  sold: '#16825d',
  for_sale: 'var(--text, #1a1a1a)',
  verified: '#16825d',
  viewed: 'var(--text-secondary, #888)',
  ends: 'var(--warning, #b05a00)',
}

// ---------------------------------------------------------------------------
// Size presets per BADGE_ONTOLOGY.md sizing table
// ---------------------------------------------------------------------------

interface SizeTokens {
  labelSize: number
  valueSize: number
  padding: string
}

const SIZE_TOKENS: Record<BadgeSize, SizeTokens> = {
  sm: { labelSize: 7, valueSize: 9, padding: '2px 4px' },
  md: { labelSize: 8, valueSize: 11, padding: '4px 8px' },
  lg: { labelSize: 8, valueSize: 10, padding: '4px 8px' },
}

// ---------------------------------------------------------------------------
// Legacy variant styles (backward compat)
// ---------------------------------------------------------------------------

const LEGACY_VARIANT_STYLES: Record<string, React.CSSProperties> = {
  default: {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    borderColor: 'var(--border)',
  },
  secondary: {
    backgroundColor: 'var(--surface)',
    color: 'var(--text-secondary)',
    borderColor: 'var(--border)',
  },
  outline: {
    backgroundColor: 'transparent',
    color: 'var(--text)',
    borderColor: 'var(--border)',
  },
  success: {
    backgroundColor: 'var(--success-dim, rgba(22,130,93,0.12))',
    color: 'var(--success, #16825d)',
    borderColor: 'var(--success, #16825d)',
  },
  warning: {
    backgroundColor: 'var(--warning-dim, rgba(176,90,0,0.12))',
    color: 'var(--warning, #b05a00)',
    borderColor: 'var(--warning, #b05a00)',
  },
  danger: {
    backgroundColor: 'var(--error-dim, rgba(209,52,56,0.12))',
    color: 'var(--error, #d13438)',
    borderColor: 'var(--error, #d13438)',
  },
}

const LEGACY_VARIANTS = new Set(['default', 'secondary', 'outline', 'success', 'warning', 'danger'])

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Badge({
  dimension,
  value,
  count,
  onClick,
  size = 'md',
  variant: explicitVariant,
  style,
  children,
  ...props
}: BadgeProps) {
  const [hovered, setHovered] = useState(false)
  const [active, setActive] = useState(false)

  // Resolve variant
  const resolvedVariant: BadgeVariant = explicitVariant
    ?? (dimension ? variantFromDimension(dimension) : 'default')
  const isLegacy = LEGACY_VARIANTS.has(resolvedVariant)
  const isOntology = !isLegacy && (resolvedVariant === 'dimension' || resolvedVariant === 'metric' || resolvedVariant === 'status')

  const tokens = SIZE_TOKENS[size]

  // ---- Build style based on variant type ----

  let baseStyle: React.CSSProperties

  if (isLegacy) {
    // Backward-compatible: old Badge API with children
    const legacyVS = LEGACY_VARIANT_STYLES[resolvedVariant] ?? LEGACY_VARIANT_STYLES.default
    baseStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Arial, sans-serif',
      fontWeight: 600,
      letterSpacing: '0.05em',
      textTransform: 'uppercase' as const,
      border: '2px solid',
      borderRadius: 0,
      lineHeight: 1.4,
      whiteSpace: 'nowrap' as const,
      userSelect: 'none' as const,
      cursor: onClick ? 'pointer' : 'default',
      transition: 'color 150ms ease, background-color 150ms ease, border-color 150ms ease',
      padding: tokens.padding,
      fontSize: tokens.valueSize,
      ...legacyVS,
    }
  } else if (resolvedVariant === 'dimension') {
    // Dimension badge: var(--surface) bg, var(--border) border, 8px Courier UPPERCASE
    baseStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      fontFamily: '"Courier New", Courier, monospace',
      fontSize: tokens.valueSize,
      fontWeight: 700,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.06em',
      lineHeight: 1,
      padding: tokens.padding,
      border: '2px solid var(--border)',
      borderRadius: 0,
      backgroundColor: 'var(--surface)',
      color: 'var(--text)',
      whiteSpace: 'nowrap' as const,
      cursor: 'pointer',
      flexShrink: 0,
      userSelect: 'none' as const,
      transition: 'border-color 150ms ease, background-color 150ms ease, color 150ms ease',
    }
  } else if (resolvedVariant === 'metric') {
    // Metric badge: var(--bg) bg, var(--border) border, label 7px + value 11px Courier
    baseStyle = {
      display: 'inline-flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      padding: tokens.padding,
      border: '2px solid var(--border)',
      borderRadius: 0,
      backgroundColor: 'var(--bg, var(--surface))',
      color: 'var(--text)',
      whiteSpace: 'nowrap' as const,
      cursor: 'pointer',
      flexShrink: 0,
      userSelect: 'none' as const,
      transition: 'border-color 150ms ease, background-color 150ms ease, color 150ms ease',
    }
  } else {
    // Status badge: no bg, colored indicator only
    const statusColor = (dimension && STATUS_COLORS[dimension]) || 'var(--text-secondary)'
    baseStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontFamily: 'Arial, sans-serif',
      fontSize: tokens.valueSize,
      fontWeight: 700,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.06em',
      lineHeight: 1,
      padding: tokens.padding,
      border: '2px solid transparent',
      borderRadius: 0,
      backgroundColor: 'transparent',
      color: statusColor,
      whiteSpace: 'nowrap' as const,
      cursor: 'pointer',
      flexShrink: 0,
      userSelect: 'none' as const,
      transition: 'border-color 150ms ease, background-color 150ms ease, color 150ms ease',
    }
  }

  // ---- Interaction states (ontology badges only) ----

  if (isOntology) {
    if (active) {
      baseStyle = {
        ...baseStyle,
        backgroundColor: 'var(--text)',
        borderColor: 'var(--text)',
        color: 'var(--bg, var(--surface))',
      }
    } else if (hovered) {
      baseStyle = {
        ...baseStyle,
        borderColor: 'var(--text)',
      }
    }
  }

  // Merge caller style overrides
  const finalStyle: React.CSSProperties = { ...baseStyle, ...style }

  // ---- Event handlers ----

  const handleMouseEnter = useCallback(() => setHovered(true), [])
  const handleMouseLeave = useCallback(() => { setHovered(false); setActive(false) }, [])
  const handleMouseDown = useCallback(() => setActive(true), [])
  const handleMouseUp = useCallback(() => setActive(false), [])

  const handleClick = useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    if (onClick) onClick(e)
  }, [onClick])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onClick(e as unknown as React.MouseEvent<HTMLSpanElement>)
    }
  }, [onClick])

  // ---- Render ----

  // Legacy mode: just render children like the old Badge
  if (isLegacy && !dimension) {
    return (
      <span
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        style={finalStyle}
        onClick={onClick ? handleClick : undefined}
        onKeyDown={onClick ? handleKeyDown : undefined}
        {...props}
      >
        {children}
      </span>
    )
  }

  // Ontology: metric badge with label + value stacked
  if (resolvedVariant === 'metric') {
    const label = dimension ? DIMENSION_LABELS[dimension] : undefined
    const displayValue = value != null ? String(value) : (children ?? '')

    return (
      <span
        role="button"
        tabIndex={0}
        style={finalStyle}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        {...props}
      >
        {label && (
          <span style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: tokens.labelSize,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
            color: active ? 'var(--bg, var(--surface))' : 'var(--text-secondary, #888)',
            lineHeight: 1,
          }}>
            {label}
          </span>
        )}
        <span style={{
          fontFamily: '"Courier New", Courier, monospace',
          fontSize: tokens.valueSize,
          fontWeight: 700,
          lineHeight: 1.2,
        }}>
          {displayValue}
          {count != null && (
            <span style={{
              fontWeight: 400,
              fontSize: tokens.labelSize,
              marginLeft: 3,
              opacity: 0.6,
            }}>
              {count}
            </span>
          )}
        </span>
      </span>
    )
  }

  // Ontology: status badge with colored indicator
  if (resolvedVariant === 'status') {
    const displayValue = value != null ? String(value) : (children ?? '')
    const showDot = dimension === 'live'

    return (
      <span
        role="button"
        tabIndex={0}
        style={finalStyle}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        {...props}
      >
        {showDot && (
          <span style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            backgroundColor: STATUS_COLORS.live,
            flexShrink: 0,
          }} />
        )}
        {displayValue}
        {count != null && (
          <span style={{
            fontFamily: '"Courier New", Courier, monospace',
            fontSize: tokens.labelSize,
            fontWeight: 400,
            opacity: 0.6,
            marginLeft: 3,
          }}>
            {count}
          </span>
        )}
      </span>
    )
  }

  // Ontology: dimension badge (default for ontology)
  const displayValue = value != null ? String(value) : (children ?? '')

  return (
    <span
      role="button"
      tabIndex={0}
      style={finalStyle}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      {...props}
    >
      {displayValue}
      {count != null && (
        <span style={{
          fontFamily: '"Courier New", Courier, monospace',
          fontSize: tokens.labelSize,
          fontWeight: 400,
          opacity: 0.6,
          marginLeft: 3,
        }}>
          {count}
        </span>
      )}
    </span>
  )
}

export default Badge
