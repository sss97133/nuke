import * as React from "react"

// Nuke Design System — Input Component
// Rules: 0px border-radius, --fs-9, height 28px, Arial, 1px border
// Keeps form-input class for base styles, adds explicit overrides

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean
}

const inputStyle: React.CSSProperties = {
  borderRadius: 0,
  fontSize: "var(--fs-9, 9px)",
  fontFamily: "Arial, sans-serif",
  height: "28px",
  width: "100%",
  backgroundColor: "var(--bg, #f5f5f5)",
  color: "var(--text, #2a2a2a)",
  border: "1px solid var(--border, #cccccc)",
  padding: "0 var(--space-2, 8px)",
  outline: "none",
  transition: "border-color 0.12s ease",
  boxSizing: "border-box",
  boxShadow: "none",
  appearance: "none",
  WebkitAppearance: "none",
}

const inputFocusStyle: React.CSSProperties = {
  borderColor: "var(--border-focus, #2a2a2a)",
}

const inputErrorStyle: React.CSSProperties = {
  borderColor: "var(--error, #d13438)",
}

const inputDisabledStyle: React.CSSProperties = {
  opacity: 0.5,
  cursor: "not-allowed",
  backgroundColor: "var(--surface, #ebebeb)",
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ hasError, style, className, onFocus, onBlur, disabled, ...props }, ref) => {
    const [focused, setFocused] = React.useState(false)

    const combinedStyle: React.CSSProperties = {
      ...inputStyle,
      ...(focused && inputFocusStyle),
      ...(hasError && inputErrorStyle),
      ...(disabled && inputDisabledStyle),
      ...style,
    }

    return (
      <input
        ref={ref}
        className={className ? `form-input ${className}` : "form-input"}
        style={combinedStyle}
        disabled={disabled}
        onFocus={(e) => {
          setFocused(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          onBlur?.(e)
        }}
        {...props}
      />
    )
  }
)

Input.displayName = "Input"

export default Input
