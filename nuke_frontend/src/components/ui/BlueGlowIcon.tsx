import * as React from "react"

// Nuke Design System — BlueGlowIcon Component
// FIXED: Removed all gradients, glow filters, and feGaussianBlur
// Now renders a clean solid circle using var(--accent) with a 1px border
// No box-shadow glow, no radialGradient, no filter effects

export interface BlueGlowIconProps {
  children?: React.ReactNode
  size?: number
  color?: string
  className?: string
  style?: React.CSSProperties
  "aria-label"?: string
}

export function BlueGlowIcon({
  children,
  size = 32,
  color,
  className,
  style,
  "aria-label": ariaLabel,
}: BlueGlowIconProps) {
  const radius = size / 2
  const accentColor = color ?? "var(--accent, #2a2a2a)"

  const containerStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size,
    height: size,
    flexShrink: 0,
    position: "relative",
    ...style,
  }

  return (
    <span
      className={className}
      style={containerStyle}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ display: "block" }}
      >
        <circle
          cx={radius}
          cy={radius}
          r={radius - 0.5}
          fill={accentColor}
          stroke={accentColor}
          strokeWidth="1"
        />
      </svg>
      {children && (
        <span
          style={{
            position: "absolute",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: size,
            height: size,
            color: "var(--bg, #f5f5f5)",
            pointerEvents: "none",
          }}
        >
          {children}
        </span>
      )}
    </span>
  )
}

export default BlueGlowIcon
