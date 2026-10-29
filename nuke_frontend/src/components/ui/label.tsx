import * as React from "react"

// Nuke Design System — Label Component
// Readable form labels use the shared system face.

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean
}

const labelStyle: React.CSSProperties = {
  display: "inline-block",
  fontFamily: "var(--font-family)",
  fontSize: "var(--text-callout)",
  fontWeight: 600,
  color: "var(--text-secondary, #666666)",
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
