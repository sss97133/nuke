import React from 'react';
import { ThemePreference, SpacingPreference } from '../architecture/data-contracts';

/**
 * Vehicle-Centric Design System
 * 
 * This file defines the core components and design tokens for the 
 * vehicle-centric data platform. It serves as both documentation and
 * implementation of the design system.
 */

// =============================
// DESIGN TOKENS
// =============================

export const colors = {
  // Primary palette
  primary: {
    50: '#f0f9ff',
    100: '#e0f2fe',
    200: '#bae6fd',
    300: '#7dd3fc',
    400: '#38bdf8',
    500: '#0ea5e9',
    600: '#0284c7',
    700: '#0369a1',
    800: '#075985',
    900: '#0c4a6e',
    950: '#082f49',
  },
  
  // Gray palette
  gray: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
    950: '#030712',
  },
  
  // Semantic colors
  success: {
    light: '#ecfdf5',
    DEFAULT: '#10b981',
    dark: '#065f46',
  },
  warning: {
    light: '#fffbeb',
    DEFAULT: '#f59e0b',
    dark: '#78350f',
  },
  danger: {
    light: '#fef2f2',
    DEFAULT: '#ef4444',
    dark: '#991b1b',
  },
  info: {
    light: '#eff6ff',
    DEFAULT: '#3b82f6',
    dark: '#1e40af',
  },
  
  // Confidence level colors
  confidence: {
    high: '#10b981',   // Green for high confidence
    medium: '#f59e0b', // Yellow for medium confidence
    low: '#ef4444',    // Red for low confidence
  },
  
  // UI Accents (customizable by user)
  accent: '#3b82f6', // Default accent (can be overridden by user preference)
};

export const typography = {
  fontFamily: {
    sans: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    '4xl': '2.25rem',
    '5xl': '3rem',
  },
  lineHeight: {
    none: 1,
    tight: 1.25,
    snug: 1.375,
    normal: 1.5,
    relaxed: 1.625,
    loose: 2,
  },
  letterSpacing: {
    tighter: '-0.05em',
    tight: '-0.025em',
    normal: '0em',
    wide: '0.025em',
    wider: '0.05em',
    widest: '0.1em',
  },
};

export const spacing = {
  px: '1px',
  0: '0',
  0.5: '0.125rem',
  1: '0.25rem',
  1.5: '0.375rem',
  2: '0.5rem',
  2.5: '0.625rem',
  3: '0.75rem',
  3.5: '0.875rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  7: '1.75rem',
  8: '2rem',
  9: '2.25rem',
  10: '2.5rem',
  11: '2.75rem',
  12: '3rem',
  14: '3.5rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
  28: '7rem',
  32: '8rem',
  36: '9rem',
  40: '10rem',
  44: '11rem',
  48: '12rem',
  52: '13rem',
  56: '14rem',
  60: '15rem',
  64: '16rem',
  72: '18rem',
  80: '20rem',
  96: '24rem',
};

export const shadows = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
  none: 'none',
};

export const radius = {
  none: '0',
  sm: '0.125rem',
  DEFAULT: '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  '2xl': '1rem',
  '3xl': '1.5rem',
  full: '9999px',
};

export const animation = {
  duration: {
    75: '75ms',
    100: '100ms',
    150: '150ms',
    200: '200ms',
    300: '300ms',
    500: '500ms',
    700: '700ms',
    1000: '1000ms',
  },
  easing: {
    linear: 'linear',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
};

// =============================
// COMPONENT DEFINITIONS
// =============================

// Theme context for adaptive UI
export interface ThemeContextProps {
  theme: ThemePreference;
  spacing: SpacingPreference;
  fontSize: number;
  animations: boolean;
  colorAccent: string;
  setTheme: (theme: ThemePreference) => void;
  setSpacing: (spacing: SpacingPreference) => void;
  setFontSize: (scale: number) => void;
  setAnimations: (enabled: boolean) => void;
  setColorAccent: (color: string) => void;
}

export const ThemeContext = React.createContext<ThemeContextProps>({
  theme: ThemePreference.SYSTEM,
  spacing: SpacingPreference.NORMAL,
  fontSize: 1,
  animations: true,
  colorAccent: colors.accent,
  setTheme: () => {},
  setSpacing: () => {},
  setFontSize: () => {},
  setAnimations: () => {},
  setColorAccent: () => {},
});

// Theme provider component
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<ThemePreference>(ThemePreference.SYSTEM);
  const [spacing, setSpacing] = React.useState<SpacingPreference>(SpacingPreference.NORMAL);
  const [fontSize, setFontSize] = React.useState<number>(1);
  const [animations, setAnimations] = React.useState<boolean>(true);
  const [colorAccent, setColorAccent] = React.useState<string>(colors.accent);
  
  React.useEffect(() => {
    // Apply theme class to body
    const body = document.body;
    body.classList.remove('theme-light', 'theme-dark');
    
    if (theme === ThemePreference.SYSTEM) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      body.classList.add(prefersDark ? 'theme-dark' : 'theme-light');
    } else {
      body.classList.add(`theme-${theme}`);
    }
    
    // Apply spacing class
    body.classList.remove('spacing-compact', 'spacing-normal', 'spacing-spacious');
    body.classList.add(`spacing-${spacing}`);
    
    // Apply font size
    body.style.setProperty('--font-size-factor', fontSize.toString());
    
    // Apply accent color
    body.style.setProperty('--color-accent', colorAccent);
    
    // Apply animation setting
    body.classList.toggle('reduce-animations', !animations);
  }, [theme, spacing, fontSize, animations, colorAccent]);
  
  return (
    <ThemeContext.Provider value={{
      theme,
      spacing,
      fontSize,
      animations,
      colorAccent,
      setTheme,
      setSpacing,
      setFontSize,
      setAnimations,
      setColorAccent,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Hook for using theme context
export function useTheme() {
  return React.useContext(ThemeContext);
}

// =============================
// CONFIDENCE COMPONENTS
// =============================

// These components are used to visualize data confidence levels

interface ConfidenceProps {
  score: number;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function ConfidenceBadge({ score, showLabel = true, size = 'md', className = '' }: ConfidenceProps) {
  let color = colors.confidence.low;
  let label = 'Low';
  
  if (score >= 0.9) {
    color = colors.confidence.high;
    label = 'High';
  } else if (score >= 0.7) {
    color = colors.confidence.medium;
    label = 'Medium';
  }
  
  const sizeClasses = {
    sm: 'h-1.5 w-1.5 text-xs',
    md: 'h-2 w-2 text-sm',
    lg: 'h-2.5 w-2.5 text-base',
  };
  
  return (
    <span className={`flex items-center gap-1 ${className}`}>
      <span className={`rounded-full ${sizeClasses[size]}`} style={{ backgroundColor: color }}></span>
      {showLabel && (
        <span>{label} confidence ({Math.round(score * 100)}%)</span>
      )}
    </span>
  );
}

// =============================
// TIMELINE COMPONENTS
// =============================

// These components are used to visualize vehicle timelines

interface TimelineEventProps {
  date: string;
  title: string;
  description?: string;
  source?: string;
  confidence?: number;
  type?: string;
  metadata?: Record<string, unknown>;
  children?: React.ReactNode;
}

export function TimelineEvent({ 
  date, 
  title, 
  description, 
  source, 
  confidence = 1.0,
  type,
  metadata,
  children 
}: TimelineEventProps) {
  // Get type-specific color
  const getEventColor = () => {
    switch (type) {
      case 'service':
        return colors.primary[500];
      case 'ownership_change':
        return colors.success.DEFAULT;
      case 'accident':
        return colors.danger.DEFAULT;
      case 'recall':
        return colors.warning.DEFAULT;
      default:
        return colors.gray[400];
    }
  };

  return (
    <div className="relative pl-10 pb-8">
      {/* Timeline connector line */}
      <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700"></div>
      
      {/* Timeline event dot */}
      <div 
        className="absolute left-4 top-1.5 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white dark:border-gray-800"
        style={{ backgroundColor: getEventColor() }}
      ></div>
      
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <div className="flex justify-between">
          <div className="font-medium">{title}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {new Date(date).toLocaleDateString()}
          </div>
        </div>
        
        {description && (
          <div className="mt-2">{description}</div>
        )}
        
        {children && (
          <div className="mt-3">
            {children}
          </div>
        )}
        
        <div className="mt-2 flex justify-between items-center text-xs">
          {source && (
            <div className="text-gray-500 dark:text-gray-400">
              Source: {source}
            </div>
          )}
          {confidence !== undefined && (
            <ConfidenceBadge score={confidence} size="sm" />
          )}
        </div>
      </div>
    </div>
  );
}

export function Timeline({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative pt-2">
      {children}
    </div>
  );
}

// =============================
// DATA SOURCE COMPONENTS
// =============================

// These components are used to visualize data sources

interface DataSourceBadgeProps {
  id: string;
  name: string;
  isConnected?: boolean;
  icon?: string;
  className?: string;
}

export function DataSourceBadge({ 
  id, 
  name, 
  isConnected = false, 
  icon = '🔌',
  className = ''
}: DataSourceBadgeProps) {
  return (
    <div 
      className={`p-4 rounded-lg border ${
        isConnected
          ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
          : 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-700'
      } ${className}`}
    >
      <div className="flex items-center gap-3">
        <div className="text-xl">{icon}</div>
        <div>
          <div className="font-medium">{name}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {isConnected ? 'Connected' : 'Not connected'}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================
// ADAPTIVE LAYOUT COMPONENTS
// =============================

// These components adapt to user preferences and usage patterns

interface AdaptiveCardProps {
  title: string;
  icon?: string;
  importance?: number; // 0-10 scale, higher means more important
  usageFrequency?: number; // 0-10 scale, higher means more frequently used
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function AdaptiveCard({ 
  title, 
  icon, 
  importance = 5,
  usageFrequency = 5,
  collapsible = false,
  defaultCollapsed = false,
  className = '',
  children 
}: AdaptiveCardProps) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const { spacing } = useTheme();
  
  // Calculate visual prominence based on importance and usage
  const getPromience = () => {
    // This would normally be calculated from actual usage data
    // For now, we'll just use the provided values
    const score = (importance + usageFrequency) / 2;
    
    if (score >= 8) return 'high';
    if (score >= 5) return 'medium';
    return 'low';
  };
  
  const prominence = getPromience();
  
  // Adjust padding based on spacing preference
  const getPadding = () => {
    switch (spacing) {
      case SpacingPreference.COMPACT:
        return 'p-3';
      case SpacingPreference.SPACIOUS:
        return 'p-6';
      default:
        return 'p-4';
    }
  };
  
  // Adjust visual prominence
  const getProminenceStyles = () => {
    switch (prominence) {
      case 'high':
        return 'border-l-4 border-l-primary-500';
      case 'medium':
        return 'border-l-2 border-l-primary-400';
      default:
        return '';
    }
  };
  
  return (
    <div 
      className={`bg-white dark:bg-gray-800 rounded-lg shadow ${getPadding()} ${getProminenceStyles()} ${className}`}
      data-importance={importance}
      data-usage-frequency={usageFrequency}
    >
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          {icon && <span className="text-lg">{icon}</span>}
          <h3 className="font-semibold">{title}</h3>
        </div>
        
        {collapsible && (
          <button 
            onClick={() => setCollapsed(!collapsed)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          >
            {collapsed ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"></path>
              </svg>
            )}
          </button>
        )}
      </div>
      
      {!collapsed && children}
    </div>
  );
}

// =============================
// VEHICLE RECORD COMPONENTS
// =============================

interface VehicleCardProps {
  id: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  additional?: Record<string, unknown>;
  dataSource?: string;
  confidence?: number;
  onClick?: () => void;
  isSelected?: boolean;
  className?: string;
}

export function VehicleCard({ 
  id, 
  vin, 
  make, 
  model, 
  year, 
  additional,
  dataSource,
  confidence = 1.0,
  onClick,
  isSelected = false,
  className = ''
}: VehicleCardProps) {
  return (
    <div
      className={`p-4 rounded-lg cursor-pointer transition-colors ${
        isSelected 
          ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
          : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700'
      } ${className}`}
      onClick={onClick}
    >
      <div className="font-medium">{year} {make} {model}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">VIN: {vin}</div>
      
      {additional && Object.keys(additional).length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 text-sm">
          {Object.entries(additional).map(([key, value]) => (
            <div key={key} className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">{key.replace(/_/g, ' ')}:</span>
              <span>{String(value)}</span>
            </div>
          ))}
        </div>
      )}
      
      {(dataSource || confidence !== undefined) && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
          {dataSource && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Source: {dataSource}
            </div>
          )}
          {confidence !== undefined && (
            <ConfidenceBadge score={confidence} size="sm" />
          )}
        </div>
      )}
    </div>
  );
}

interface VehicleDetailProps {
  id: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  trim?: string;
  color?: string;
  mileage?: number;
  lastUpdated?: string;
  dataSource?: string;
  confidence?: number;
  additional?: Record<string, unknown>;
  children?: React.ReactNode;
  className?: string;
}

export function VehicleDetail({
  id,
  vin,
  make,
  model,
  year,
  trim,
  color,
  mileage,
  lastUpdated,
  dataSource,
  confidence = 1.0,
  additional,
  children,
  className = ''
}: VehicleDetailProps) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow ${className}`}>
      <div className="p-6 border-b border-gray-100 dark:border-gray-700">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold">
              {year} {make} {model} {trim}
            </h2>
            <div className="mt-1 text-gray-500 dark:text-gray-400">
              VIN: {vin}
            </div>
          </div>
          
          <div className="flex flex-col items-end">
            {dataSource && (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Source: {dataSource}
              </div>
            )}
            {confidence !== undefined && (
              <ConfidenceBadge score={confidence} />
            )}
          </div>
        </div>
        
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {color && (
            <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded">
              <div className="text-xs text-gray-500 dark:text-gray-400">Color</div>
              <div>{color}</div>
            </div>
          )}
          
          {mileage !== undefined && (
            <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded">
              <div className="text-xs text-gray-500 dark:text-gray-400">Mileage</div>
              <div>{mileage.toLocaleString()} mi</div>
            </div>
          )}
          
          {lastUpdated && (
            <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded">
              <div className="text-xs text-gray-500 dark:text-gray-400">Last Updated</div>
              <div>{new Date(lastUpdated).toLocaleDateString()}</div>
            </div>
          )}
          
          {additional && Object.keys(additional).length > 0 && (
            Object.entries(additional).map(([key, value]) => (
              <div key={key} className="bg-gray-50 dark:bg-gray-700 p-3 rounded">
                <div className="text-xs text-gray-500 dark:text-gray-400">{key.replace(/_/g, ' ')}</div>
                <div>{String(value)}</div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {children && (
        <div className="p-6">
          {children}
        </div>
      )}
    </div>
  );
}

// =============================
// USAGE EXAMPLES
// =============================

/**
 * Example of how to use these components:
 * 
 * ```tsx
 * import { 
 *   ThemeProvider, 
 *   ConfidenceBadge,
 *   Timeline, 
 *   TimelineEvent,
 *   DataSourceBadge,
 *   AdaptiveCard,
 *   VehicleCard,
 *   VehicleDetail
 * } from '@/design/DesignSystem';
 * 
 * function MyComponent() {
 *   return (
 *     <ThemeProvider>
 *       <div className="p-6">
 *         <VehicleDetail
 *           id="123"
 *           vin="1HGCM82633A123456"
 *           make="Honda"
 *           model="Accord"
 *           year={2022}
 *           color="Blue"
 *           mileage={12500}
 *           confidence={0.95}
 *           dataSource="vin_decoder"
 *         >
 *           <Timeline>
 *             <TimelineEvent
 *               date="2022-05-10"
 *               title="Regular Maintenance"
 *               description="Oil change and tire rotation"
 *               source="service_records"
 *               confidence={0.98}
 *               type="service"
 *             />
 *             <TimelineEvent
 *               date="2022-02-15"
 *               title="Purchase"
 *               description="Vehicle purchased from dealer"
 *               source="ownership_records"
 *               confidence={1.0}
 *               type="ownership_change"
 *             />
 *           </Timeline>
 *         </VehicleDetail>
 *       </div>
 *     </ThemeProvider>
 *   );
 * }
 * ```
 */
