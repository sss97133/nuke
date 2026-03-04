import * as React from "react"

// Nuke Design System — Select Component
// FIXED: Removed rounded-md, ring-offset, shadow-md
// Rules: 0px border-radius, height 28px (compact), --fs-9, --bg, 1px border, no ring on focus
// All exports preserved: Select, SelectValue, SelectTrigger, SelectContent, SelectItem, SimpleSelect

// ---------------------------------------------------------------------------
// CSS vars this component relies on (defined in unified-design-system.css):
//   --bg: #f5f5f5
//   --surface: #ebebeb
//   --surface-hover: #e0e0e0
//   --text: #2a2a2a
//   --text-secondary: #666666
//   --border: (e.g. #cccccc)
//   --border-focus: (e.g. #2a2a2a)
//   --fs-9: 9px
//   --space-1: 4px  --space-2: 8px
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Headless context for compound Select
// ---------------------------------------------------------------------------
interface SelectContextValue {
  value: string
  onChange: (val: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
}

const SelectContext = React.createContext<SelectContextValue | null>(null)

function useSelectContext() {
  const ctx = React.useContext(SelectContext)
  if (!ctx) throw new Error("Select compound components must be used inside <Select>")
  return ctx
}

// ---------------------------------------------------------------------------
// ChevronDown icon (inline SVG — no external dep required)
// ---------------------------------------------------------------------------
function ChevronDown({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path
        d="M2.5 4.5L6 8L9.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Select (root)
// ---------------------------------------------------------------------------
export interface SelectProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
  disabled?: boolean
}

export function Select({
  value: controlledValue,
  defaultValue = "",
  onValueChange,
  children,
  disabled,
}: SelectProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue)
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)

  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : internalValue

  const handleChange = React.useCallback(
    (val: string) => {
      if (!isControlled) setInternalValue(val)
      onValueChange?.(val)
      setOpen(false)
    },
    [isControlled, onValueChange]
  )

  // Close on outside click
  React.useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current && !triggerRef.current.closest("[data-select-root]")?.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleOutside)
    return () => document.removeEventListener("mousedown", handleOutside)
  }, [open])

  return (
    <SelectContext.Provider value={{ value, onChange: handleChange, open, setOpen, triggerRef }}>
      <div
        data-select-root
        data-disabled={disabled ? "true" : undefined}
        style={{ position: "relative", display: "inline-block", width: "100%" }}
      >
        {children}
      </div>
    </SelectContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// SelectValue
// ---------------------------------------------------------------------------
export interface SelectValueProps {
  placeholder?: string
}

export function SelectValue({ placeholder = "Select..." }: SelectValueProps) {
  const { value } = useSelectContext()

  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: value ? "var(--text, #2a2a2a)" : "var(--text-secondary, #666666)",
        flex: 1,
        minWidth: 0,
      }}
    >
      {value || placeholder}
    </span>
  )
}

// ---------------------------------------------------------------------------
// SelectTrigger
// ---------------------------------------------------------------------------
export interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode
  placeholder?: string
}

const triggerBaseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-1, 4px)",
  width: "100%",
  height: "28px",
  padding: "0 var(--space-2, 8px)",
  fontFamily: "Arial, sans-serif",
  fontSize: "var(--fs-9, 9px)",
  fontWeight: 400,
  color: "var(--text, #2a2a2a)",
  backgroundColor: "var(--bg, #f5f5f5)",
  border: "1px solid var(--border, #cccccc)",
  borderRadius: 0,
  outline: "none",
  cursor: "pointer",
  textAlign: "left",
  boxShadow: "none",
  transition: "border-color 0.12s ease, background-color 0.12s ease",
  boxSizing: "border-box",
  userSelect: "none",
}

export function SelectTrigger({ children, style, disabled, ...props }: SelectTriggerProps) {
  const { open, setOpen, triggerRef } = useSelectContext()
  const [focused, setFocused] = React.useState(false)

  const combinedStyle: React.CSSProperties = {
    ...triggerBaseStyle,
    ...(focused ? { borderColor: "var(--border-focus, #2a2a2a)" } : {}),
    ...(open ? { borderColor: "var(--border-focus, #2a2a2a)" } : {}),
    ...(disabled ? { opacity: 0.5, cursor: "not-allowed" } : {}),
    ...style,
  }

  return (
    <button
      ref={triggerRef}
      type="button"
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      disabled={disabled}
      style={combinedStyle}
      onClick={() => !disabled && setOpen(!open)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      {...props}
    >
      {children}
      <ChevronDown
        size={10}
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// SelectContent
// ---------------------------------------------------------------------------
export interface SelectContentProps {
  children: React.ReactNode
  style?: React.CSSProperties
  className?: string
}

const contentStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 2px)",
  left: 0,
  right: 0,
  zIndex: 50,
  backgroundColor: "var(--bg, #f5f5f5)",
  border: "1px solid var(--border, #cccccc)",
  borderRadius: 0,
  boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
  maxHeight: "200px",
  overflowY: "auto",
  padding: "2px 0",
}

export function SelectContent({ children, style, className }: SelectContentProps) {
  const { open } = useSelectContext()

  if (!open) return null

  return (
    <div
      role="listbox"
      style={{ ...contentStyle, ...style }}
      className={className}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SelectItem
// ---------------------------------------------------------------------------
export interface SelectItemProps {
  value: string
  children: React.ReactNode
  disabled?: boolean
  style?: React.CSSProperties
  className?: string
}

const itemBaseStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "4px var(--space-2, 8px)",
  fontFamily: "Arial, sans-serif",
  fontSize: "var(--fs-9, 9px)",
  fontWeight: 400,
  color: "var(--text, #2a2a2a)",
  backgroundColor: "transparent",
  border: "none",
  borderRadius: 0,
  cursor: "pointer",
  textAlign: "left",
  outline: "none",
  transition: "background-color 0.12s ease",
  boxSizing: "border-box",
  userSelect: "none",
}

export function SelectItem({
  value: itemValue,
  children,
  disabled,
  style,
  className,
}: SelectItemProps) {
  const { value: selectedValue, onChange } = useSelectContext()
  const isSelected = selectedValue === itemValue
  const [hovered, setHovered] = React.useState(false)

  const combinedStyle: React.CSSProperties = {
    ...itemBaseStyle,
    ...(hovered ? { backgroundColor: "var(--surface-hover, #e0e0e0)" } : {}),
    ...(isSelected
      ? {
          backgroundColor: "var(--surface, #ebebeb)",
          fontWeight: 600,
        }
      : {}),
    ...(disabled ? { opacity: 0.4, cursor: "not-allowed" } : {}),
    ...style,
  }

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      disabled={disabled}
      style={combinedStyle}
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => !disabled && onChange(itemValue)}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// SimpleSelect — uncontrolled native-style wrapper for simple use cases
// ---------------------------------------------------------------------------
export interface SimpleSelectProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  options: { value: string; label: string; disabled?: boolean }[]
  disabled?: boolean
  style?: React.CSSProperties
  className?: string
}

export function SimpleSelect({
  value,
  defaultValue,
  onValueChange,
  placeholder = "Select...",
  options,
  disabled,
  style,
  className,
}: SimpleSelectProps) {
  return (
    <Select
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectTrigger style={style} className={className} disabled={disabled}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default Select
