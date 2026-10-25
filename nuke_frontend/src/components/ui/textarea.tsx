import * as React from "react"

// Nuke Design System — Textarea Component
// Shared system type, readable line height and canonical focus treatment
// Keeps form-input class for base styles, adds explicit overrides

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean
}

const textareaStyle: React.CSSProperties = { fontSize: "max(16px, var(--text-body))",
  fontFamily: "var(--font-family)",
  minHeight: "100px",
  width: "100%",
  backgroundColor: "var(--bg, #f5f5f5)",
  color: "var(--text, #2a2a2a)",
  border: "1px solid var(--border, #cccccc)",
  padding: "var(--space-1, 4px) var(--space-2, 8px)",
  transition: "border-color 0.12s ease",
  boxSizing: "border-box", resize: "vertical",
  lineHeight: 1.5,
}

const textareaFocusStyle: React.CSSProperties = {
  borderColor: "var(--border-focus, #2a2a2a)",
}

const textareaErrorStyle: React.CSSProperties = {
  borderColor: "var(--error, #d13438)",
}

const textareaDisabledStyle: React.CSSProperties = {
  opacity: 0.5,
  cursor: "not-allowed",
  backgroundColor: "var(--surface, #ebebeb)",
  resize: "none",
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ hasError, style, className, onFocus, onBlur, disabled, ...props }, ref) => {
    const [focused, setFocused] = React.useState(false)

    const combinedStyle: React.CSSProperties = {
      ...textareaStyle,
      ...(focused && textareaFocusStyle),
      ...(hasError && textareaErrorStyle),
      ...(disabled && textareaDisabledStyle),
      ...style,
    }

    return (
      <textarea
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

Textarea.displayName = "Textarea"

export default Textarea
