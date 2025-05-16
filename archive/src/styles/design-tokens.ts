/**
 * Nuke Design System - Core Design Tokens
 * 
 * This file defines the design tokens that form the foundation of the
 * vehicle-centric UI system. These values are used throughout the application
 * to ensure consistent, modern design that emphasizes the digital identity
 * of vehicles.
 */

// Color System: Based on automotive-inspired palette
export const colors = {
  // Primary palette - inspired by vehicle lifecycle stages
  primary: {
    50: '#e6f5fc',
    100: '#cceaf9',
    200: '#99d5f3',
    300: '#66c0ed',
    400: '#33abe7',
    500: '#0096e1', // Primary brand color
    600: '#0078b5',
    700: '#005a88',
    800: '#003c5b',
    900: '#001e2e',
  },
  
  // Secondary palette - inspired by vehicle verification levels
  secondary: {
    50: '#edf5ed',
    100: '#dbeadb',
    200: '#b7d5b7',
    300: '#93c093',
    400: '#6fac6f',
    500: '#4b974b', // Secondary brand color
    600: '#3c793c',
    700: '#2d5b2d',
    800: '#1e3d1e',
    900: '#0f1e0f',
  },
  
  // Accent palette - for key interactions and highlights
  accent: {
    50: '#fff2e5',
    100: '#ffe5cc',
    200: '#ffcb99',
    300: '#ffb166',
    400: '#ff9833',
    500: '#ff7e00', // Accent brand color
    600: '#cc6500',
    700: '#994c00',
    800: '#663300',
    900: '#331900',
  },
  
  // Neutrals - for text, backgrounds, and UI elements
  neutral: {
    50: '#f8f9fa',
    100: '#f1f3f5',
    200: '#e9ecef',
    300: '#dee2e6',
    400: '#ced4da',
    500: '#adb5bd',
    600: '#6c757d',
    700: '#495057',
    800: '#343a40',
    900: '#212529',
  },
  
  // Semantic colors for statuses
  status: {
    info: '#0096e1',
    success: '#4b974b',
    warning: '#ff7e00',
    error: '#dc3545',
    verified: '#4b974b',
    unverified: '#6c757d',
    blockchain: '#ff7e00', // For blockchain-verified records
  },
  
  // Background colors
  background: {
    light: '#ffffff',
    subtle: '#f8f9fa',
    muted: '#f1f3f5',
    dark: '#212529',
  }
};

// Typography
export const typography = {
  fonts: {
    body: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    heading: '"Montserrat", "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"Roboto Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  fontSizes: {
    xs: '0.75rem',    // 12px
    sm: '0.875rem',   // 14px
    md: '1rem',       // 16px
    lg: '1.125rem',   // 18px
    xl: '1.25rem',    // 20px
    '2xl': '1.5rem',  // 24px
    '3xl': '1.875rem', // 30px
    '4xl': '2.25rem',  // 36px
    '5xl': '3rem',     // 48px
    '6xl': '3.75rem',  // 60px
  },
  fontWeights: {
    light: 300,
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeights: {
    none: 1,
    tight: 1.25,
    snug: 1.375,
    normal: 1.5,
    relaxed: 1.625,
    loose: 2,
  },
  letterSpacings: {
    tighter: '-0.05em',
    tight: '-0.025em',
    normal: '0',
    wide: '0.025em',
    wider: '0.05em',
    widest: '0.1em',
  },
};

// Spacing system (based on 4px grid)
export const spacing = {
  px: '1px',
  0.5: '0.125rem', // 2px
  1: '0.25rem',    // 4px
  1.5: '0.375rem', // 6px
  2: '0.5rem',     // 8px
  2.5: '0.625rem', // 10px
  3: '0.75rem',    // 12px
  3.5: '0.875rem', // 14px
  4: '1rem',       // 16px
  5: '1.25rem',    // 20px
  6: '1.5rem',     // 24px
  7: '1.75rem',    // 28px
  8: '2rem',       // 32px
  9: '2.25rem',    // 36px
  10: '2.5rem',    // 40px
  12: '3rem',      // 48px
  14: '3.5rem',    // 56px
  16: '4rem',      // 64px
  20: '5rem',      // 80px
  24: '6rem',      // 96px
  28: '7rem',      // 112px
  32: '8rem',      // 128px
  36: '9rem',      // 144px
  40: '10rem',     // 160px
  44: '11rem',     // 176px
  48: '12rem',     // 192px
  52: '13rem',     // 208px
  56: '14rem',     // 224px
  60: '15rem',     // 240px
  64: '16rem',     // 256px
  72: '18rem',     // 288px
  80: '20rem',     // 320px
  96: '24rem',     // 384px
};

// Border radius
export const borderRadius = {
  none: '0',
  sm: '0.125rem',    // 2px
  DEFAULT: '0.25rem', // 4px
  md: '0.375rem',    // 6px
  lg: '0.5rem',      // 8px
  xl: '0.75rem',     // 12px
  '2xl': '1rem',     // 16px
  '3xl': '1.5rem',   // 24px
  full: '9999px',
};

// Shadows
export const shadows = {
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  DEFAULT: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)',
  outline: '0 0 0 3px rgba(0, 150, 225, 0.5)',
  none: 'none',
};

// Animation and transitions
export const animation = {
  durations: {
    fastest: '50ms',
    fast: '100ms',
    normal: '200ms',
    slow: '300ms',
    slowest: '500ms',
  },
  timingFunctions: {
    linear: 'linear',
    ease: 'ease',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
};

// Z-index scale
export const zIndices = {
  hide: -1,
  auto: 'auto',
  base: 0,
  dropdown: 1000,
  sticky: 1100,
  banner: 1200,
  overlay: 1300,
  modal: 1400,
  popover: 1500,
  skipLink: 1600,
  toast: 1700,
  tooltip: 1800,
};

// Device breakpoints
export const breakpoints = {
  xs: '0px',
  sm: '576px',
  md: '768px',
  lg: '992px',
  xl: '1200px',
  '2xl': '1400px',
};

// Container max widths
export const containerSizes = {
  sm: '540px',
  md: '720px',
  lg: '960px',
  xl: '1140px',
  '2xl': '1320px',
};

// Data verification levels for UI indicators
export const verificationLevels = {
  BLOCKCHAIN: 'blockchain',
  PTZ_VERIFIED: 'ptz_verified',
  PROFESSIONAL: 'professional',
  MULTI_SOURCE: 'multi_source',
  SINGLE_SOURCE: 'single_source',
  UNVERIFIED: 'unverified',
};

// Export all tokens
export const tokens = {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
  animation,
  zIndices,
  breakpoints,
  containerSizes,
  verificationLevels,
};

export default tokens;
