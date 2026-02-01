import React from 'react';

interface CursorButtonProps {
  onClick?: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  fullWidth?: boolean;
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit' | 'reset';
  title?: string;
  className?: string;
}

const CursorButton: React.FC<CursorButtonProps> = ({
  onClick,
  children,
  variant = 'primary',
  disabled = false,
  fullWidth = false,
  size = 'md',
  type = 'button',
  title,
  className,
}) => {
  const getBackgroundColor = () => {
    switch (variant) {
      case 'primary':
        return '#dbeafe';
      case 'danger':
        return '#fee2e2';
      default:
        return '#f5f5f5';
    }
  };

  const getBorderColor = () => {
    switch (variant) {
      case 'primary':
        return '#0ea5e9';
      case 'danger':
        return '#ef4444';
      default:
        return '#bdbdbd';
    }
  };

  const getTextColor = () => {
    switch (variant) {
      case 'primary':
        return '#0ea5e9';
      case 'danger':
        return '#ef4444';
      default:
        return '#424242';
    }
  };

  const getPadding = () => {
    switch (size) {
      case 'sm':
        return '4px 8px';
      case 'lg':
        return '12px 16px';
      default:
        return '8px 12px';
    }
  };

  const getFontSize = () => {
    switch (size) {
      case 'sm':
        return '9px';
      case 'lg':
        return '12px';
      default:
        return '11px';
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      type={type}
      title={title}
      className={className}
      style={{
        // Cursor thick border (2px)
        border: `2px solid ${getBorderColor()}`,

        // Colors
        background: getBackgroundColor(),
        color: getTextColor(),

        // Sizing
        padding: getPadding(),
        width: fullWidth ? '100%' : 'auto',
        fontSize: getFontSize(),
        fontWeight: 600,
        fontFamily: 'Arial, sans-serif',

        // Cursor interactions
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.12s ease', // Cursor's fast transition
        borderRadius: '4px',

        // Disabled state
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',

        // Remove default button styles
        appearance: 'none',
        WebkitAppearance: 'none',
        outline: 'none',
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.style.borderColor = getBorderColor();
          btn.style.boxShadow = `0 0 0 3px ${getBorderColor()}22`;
          btn.style.transform = 'translateY(-2px)'; // Lift effect
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.style.borderColor = getBorderColor();
          btn.style.boxShadow = 'none';
          btn.style.transform = 'translateY(0)';
        }
      }}
      onMouseDown={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)'; // Compress
        }
      }}
      onMouseUp={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
        }
      }}
      onFocus={(e) => {
        if (!disabled) {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.style.outline = `2px solid ${getBorderColor()}`;
          btn.style.outlineOffset = '2px';
          btn.style.boxShadow = `0 0 0 4px ${getBorderColor()}22`;
        }
      }}
      onBlur={(e) => {
        if (!disabled) {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.style.outline = 'none';
          btn.style.boxShadow = 'none';
        }
      }}
    >
      {children}
    </button>
  );
};

export default CursorButton;
