# Nuke Design System

## Overview

The Nuke Design System is based on Windows 95 / macOS 10 aesthetic principles, providing a classic, functional, and easily modifiable interface.

## Design Principles

- **Typography**: Arial font family, 8pt text size
- **Colors**: Light grey and white backgrounds, black text only
- **Spacing**: Compact spacing system for tight layouts
- **Aesthetic**: Windows 95 / macOS 10 classic UI patterns
- **No AI Design**: Based on vetted, classic UI patterns

## Color Palette

### Background Colors
- `--white`: #ffffff
- `--grey-50`: #fafafa
- `--grey-100`: #f5f5f5
- `--grey-200`: #eeeeee
- `--grey-300`: #e0e0e0
- `--grey-400`: #bdbdbd
- `--grey-500`: #9e9e9e
- `--grey-600`: #757575
- `--grey-700`: #616161
- `--grey-800`: #424242
- `--grey-900`: #212121

### Text Colors
- `--text`: #000000 (Black)
- `--text-muted`: #424242 (Dark grey)

### Border Colors
- `--border-light`: #e0e0e0
- `--border-medium`: #bdbdbd
- `--border-dark`: #9e9e9e

## Typography

### Font Family
- **Primary**: Arial, sans-serif

### Font Sizes
- **Small**: 8pt (`--font-size-small`)
- **Regular**: 8pt (`--font-size`)

### Line Heights
- **Tight**: 1.2 (`--leading-tight`)
- **Normal**: 1.3 (`--leading-normal`)

## Spacing System

### Compact Spacing Scale
- `--space-1`: 4px
- `--space-2`: 6px
- `--space-3`: 8px
- `--space-4`: 12px
- `--space-5`: 16px
- `--space-6`: 20px
- `--space-8`: 24px
- `--space-10`: 32px
- `--space-12`: 40px

## Components

### Layout
- `.layout` - Main layout container
- `.container` - Content container with max-width
- `.header` - Page header
- `.main` - Main content area
- `.section` - Content section

### Navigation
- `.nav` - Navigation container
- `.nav-brand` - Brand/logo link
- `.nav-menu` - Navigation menu list
- `.nav-item` - Navigation item

### Buttons
- `.button` - Base button
- `.button-primary` - Primary button
- `.button-secondary` - Secondary button
- `.button-small` - Small button

### Cards
- `.card` - Base card
- `.card-header` - Card header
- `.card-body` - Card content
- `.card-footer` - Card footer

### Forms
- `.form-group` - Form field group
- `.form-label` - Form label
- `.form-input` - Text input
- `.form-select` - Select dropdown

### Tables
- `.table` - Base table
- `.table th` - Table header
- `.table td` - Table cell

### Badges
- `.badge` - Base badge
- `.badge-primary` - Primary badge
- `.badge-success` - Success badge
- `.badge-warning` - Warning badge
- `.badge-error` - Error badge

### Alerts
- `.alert` - Base alert
- `.alert-info` - Info alert
- `.alert-success` - Success alert
- `.alert-warning` - Warning alert
- `.alert-error` - Error alert

### Vehicle Components
- `.vehicle-card` - Vehicle card
- `.vehicle-image` - Vehicle image container
- `.vehicle-content` - Vehicle content
- `.vehicle-title` - Vehicle title
- `.vehicle-details` - Vehicle details
- `.vehicle-detail` - Individual detail row
- `.vehicle-actions` - Vehicle action buttons

### Status Indicators
- `.status` - Status container
- `.status-dot` - Status indicator dot
- `.status-online` - Online status
- `.status-offline` - Offline status
- `.status-warning` - Warning status
- `.status-error` - Error status

## Utility Classes

### Typography
- `.text` - Regular text (8pt)
- `.text-small` - Small text (8pt)
- `.font-normal` - Normal font weight
- `.font-bold` - Bold font weight
- `.text-primary` - Primary text color
- `.text-muted` - Muted text color

### Spacing (8pt Grid)
- `.p-1` to `.p-6` - Padding utilities (8px to 48px)
- `.m-1` to `.m-6` - Margin utilities (8px to 48px)

### Layout
- `.flex` - Flexbox container
- `.flex-col` - Column flexbox
- `.items-center` - Center align items
- `.justify-center` - Center justify content
- `.justify-between` - Space between justify
- `.gap-1` to `.gap-6` - Gap utilities

### Grid
- `.grid` - Grid container
- `.grid-cols-1` to `.grid-cols-6` - Grid columns

### Text Alignment
- `.text-center` - Center text
- `.text-left` - Left text
- `.text-right` - Right text

### Display
- `.hidden` - Hide element
- `.block` - Block display
- `.inline-block` - Inline block display

### Position
- `.relative` - Relative positioning
- `.absolute` - Absolute positioning
- `.fixed` - Fixed positioning

## Animations

- `.fade-in` - Fade in animation (0.1s ease)

## Responsive Design

The design system includes responsive breakpoints for mobile devices (max-width: 768px) that adjust spacing and layout accordingly.

## Usage

1. Import the design system CSS:
```css
@import './design-system.css';
```

2. Use the component classes in your HTML/JSX:
```jsx
<div className="layout">
  <header className="header">
    <div className="container">
      <nav className="nav">
        <a href="#" className="nav-brand">Nuke Platform</a>
      </nav>
    </div>
  </header>
  <main className="main">
    <div className="container">
      <section className="section">
        <div className="card">
          <div className="card-header">
            <h2 className="text font-bold">Title</h2>
          </div>
          <div className="card-body">
            <p className="text">Content</p>
          </div>
        </div>
      </section>
    </div>
  </main>
</div>
```

## Modifying the Design System

The design system is built with CSS custom properties (variables) for easy modification. To change colors, spacing, or typography, simply update the corresponding CSS variables in the `:root` selector.

## Browser Support

- Modern browsers with CSS Grid and Flexbox support
- IE11+ (with polyfills for CSS Grid) 