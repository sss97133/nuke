import * as React from "react"

// Nuke Design System — Label Component
// Rules: ALL CAPS, letter-spacing 0.05em, --fs-8, --text-secondary, 0px border-radius, Arial

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean
}

const labelStyle: React.CSSProperties = {
  display: "inline-block",
  fontFamily: "Arial, sans-serif",
  fontSize: "var(--fs-8, 8px)",
  fontWeight: 600,
  color: "var(--text-secondary, #666666)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  lineHeight: 1.4,
  cursor: "default",
}

const requiredStyle: React.CSSProperties = {
  color: "var(--error, #d13438)",
  marginLeft: "2px",
  fontWeight: 700,
}

export function Label({ required, style, children, ...props }: LabelProps) {
  return (
    <label style={{ ...labelStyle, ...style }} {...props}>
      {children}
      {required && <span style={requiredStyle} aria-hidden="true">*</span>}
    </label>
  )
}

export default Label
