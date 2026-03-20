import * as React from "react"

// Nuke Design System — Badge Component
// Rules: 0px border-radius, ALL CAPS, CSS vars only, no Tailwind text-*, no rounded-*

export type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "danger"
export type BadgeSize = "sm" | "md" | "lg"

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  size?: BadgeSize
}

const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
  default: {
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    borderColor: "var(--border)",
  },
  secondary: {
    backgroundColor: "var(--surface)",
    color: "var(--text-secondary)",
    borderColor: "var(--border)",
  },
  outline: {
    backgroundColor: "transparent",
    color: "var(--text)",
    borderColor: "var(--border)",
  },
  success: {
    backgroundColor: "var(--success-dim, rgba(22,130,93,0.12))",
    color: "var(--success, #16825d)",
    borderColor: "var(--success, #16825d)",
  },
  warning: {
    backgroundColor: "var(--warning-dim, rgba(176,90,0,0.12))",
    color: "var(--warning, #b05a00)",
    borderColor: "var(--warning, #b05a00)",
  },
  danger: {
    backgroundColor: "var(--error-dim, rgba(209,52,56,0.12))",
    color: "var(--error, #d13438)",
    borderColor: "var(--error, #d13438)",
  },
}

const sizeStyles: Record<BadgeSize, React.CSSProperties> = {
  sm: {
    padding: "2px 6px",
    fontSize: "var(--fs-8, 8px)",
  },
  md: {
    padding: "2px 8px",
    fontSize: "var(--fs-9, 9px)",
  },
  lg: {
    padding: "4px 10px",
    fontSize: "var(--fs-10, 10px)",
  },
}

const baseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "Arial, sans-serif",
  fontWeight: 600,
  letterSpacing: "0.05em",
  textTransform: "uppercase", border: "1px solid",
  lineHeight: 1.4,
  whiteSpace: "nowrap",
  userSelect: "none",
  transition: "color 0.12s ease, background-color 0.12s ease, border-color 0.12s ease",
}

export function Badge({
  variant = "default",
  size = "md",
  style,
  children,
  ...props
}: BadgeProps) {
  const combinedStyle: React.CSSProperties = {
    ...baseStyle,
    ...variantStyles[variant],
    ...sizeStyles[size],
    ...style,
  }

  return (
    <span style={combinedStyle} {...props}>
      {children}
    </span>
  )
}

export default Badge
