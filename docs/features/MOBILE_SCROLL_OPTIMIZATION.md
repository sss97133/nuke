# Mobile Scroll Sensitivity Optimization

**Issue:** Scrolling on mobile feels too sensitive - small swipes cause large jumps
**Solution:** Reduce scroll momentum and improve scroll control

---

## CSS Solutions

### 1. Reduce Scroll Momentum (Primary Fix)

```css
/* Apply to scrollable containers */
.scrollable-content {
  /* Reduce iOS momentum scrolling */
  -webkit-overflow-scrolling: auto; /* NOT touch - that adds momentum */
  
  /* Smooth scroll behavior */
  scroll-behavior: smooth;
  
  /* Prevent overscroll bounce */
  overscroll-behavior: contain;
  
  /* Reduce scroll snap sensitivity */
  scroll-snap-type: none;
}

/* For main page content */
.page-content,
.vehicle-profile-content,
.dashboard-content {
  -webkit-overflow-scrolling: auto;
  overscroll-behavior-y: contain;
  scroll-behavior: smooth;
}
```

### 2. Control Touch Behavior

```css
/* Reduce touch sensitivity */
body {
  /* Prevent pull-to-refresh on mobile */
  overscroll-behavior-y: contain;
  
  /* Control touch actions */
  touch-action: pan-y pinch-zoom;
  
  /* Prevent momentum on iOS */
  -webkit-overflow-scrolling: auto;
}

/* Scrollable areas */
.content-area {
  /* Only allow vertical scrolling */
  touch-action: pan-y;
  
  /* No momentum scrolling */
  -webkit-overflow-scrolling: auto;
  
  /* Contain scroll within element */
  overscroll-behavior: contain;
}
```

### 3. Disable Smooth Scrolling for More Control

```css
/* If smooth scrolling feels too "floaty" */
.precise-scroll-area {
  scroll-behavior: auto; /* Instant, no animation */
  -webkit-overflow-scrolling: auto;
}
```

---

## JavaScript Solutions

### 1. Throttle Scroll Events (Reduce Event Frequency)

```typescript
// utils/scrollOptimization.ts

/**
 * Throttle scroll events to reduce sensitivity
 */
export const throttleScroll = (callback: () => void, delay: number = 150) => {
  let lastCall = 0;
  
  return () => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      callback();
    }
  };
};

// Usage in component
useEffect(() => {
  const handleScroll = throttleScroll(() => {
    // Your scroll logic here
    console.log('Scrolled');
  }, 150); // Only fire every 150ms instead of every frame
  
  window.addEventListener('scroll', handleScroll);
  return () => window.removeEventListener('scroll', handleScroll);
}, []);
```

### 2. Dampen Scroll Velocity

```typescript
/**
 * Reduce scroll velocity by limiting how fast content can scroll
 */
export const dampScrollVelocity = (element: HTMLElement, dampingFactor: number = 0.5) => {
  let isScrolling = false;
  let lastScrollTop = element.scrollTop;
  let velocity = 0;
  
  element.addEventListener('scroll', () => {
    if (isScrolling) return;
    
    const currentScrollTop = element.scrollTop;
    velocity = currentScrollTop - lastScrollTop;
    
    // If velocity is too high, dampen it
    if (Math.abs(velocity) > 50) {
      isScrolling = true;
      
      const targetScroll = lastScrollTop + (velocity * dampingFactor);
      element.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
      });
      
      setTimeout(() => {
        isScrolling = false;
      }, 100);
    }
    
    lastScrollTop = currentScrollTop;
  });
};
```

### 3. Custom Scroll Handler with Touch Control

```typescript
/**
 * Custom scroll behavior with reduced sensitivity
 */
export const useControlledScroll = (ref: React.RefObject<HTMLElement>) => {
  useEffect(() => {
    if (!ref.current) return;
    
    const element = ref.current;
    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    
    const handleTouchStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      currentY = element.scrollTop;
      isDragging = true;
    };
    
    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging) return;
      
      const touchY = e.touches[0].clientY;
      const deltaY = startY - touchY;
      
      // Reduce sensitivity by dividing delta
      const dampedDelta = deltaY * 0.6; // 40% reduction in sensitivity
      
      element.scrollTop = currentY + dampedDelta;
      
      // Prevent default to stop native scroll
      e.preventDefault();
    };
    
    const handleTouchEnd = () => {
      isDragging = false;
    };
    
    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd);
    
    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [ref]);
};

// Usage in component
const VehicleProfile = () => {
  const contentRef = useRef<HTMLDivElement>(null);
  useControlledScroll(contentRef);
  
  return (
    <div ref={contentRef} className="scrollable-content">
      {/* Content */}
    </div>
  );
};
```

---

## Component-Specific Fixes

### Mobile Vehicle Profile

```tsx
// MobileVehicleProfile.tsx

const MobileVehicleProfile: React.FC<Props> = ({ vehicleId }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Apply scroll optimizations
  useEffect(() => {
    if (!scrollContainerRef.current) return;
    
    const container = scrollContainerRef.current;
    
    // Disable momentum scrolling
    container.style.webkitOverflowScrolling = 'auto';
    container.style.overscrollBehavior = 'contain';
    container.style.scrollBehavior = 'smooth';
    
  }, []);
  
  return (
    <div className="mobile-vehicle-profile">
      <div 
        ref={scrollContainerRef}
        className="content-scroll-area"
        style={{
          overflowY: 'auto',
          WebkitOverflowScrolling: 'auto', // Key: no momentum
          overscrollBehavior: 'contain',
          touchAction: 'pan-y',
          scrollBehavior: 'smooth'
        }}
      >
        {/* All content */}
      </div>
    </div>
  );
};
```

### Dashboard with Controlled Scroll

```tsx
// MobileDashboard.tsx

const MobileDashboard: React.FC = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Throttle scroll events
  useEffect(() => {
    if (!scrollRef.current) return;
    
    const handleScroll = throttleScroll(() => {
      // Handle scroll events less frequently
      console.log('Scroll position:', scrollRef.current?.scrollTop);
    }, 200); // Only every 200ms
    
    scrollRef.current.addEventListener('scroll', handleScroll);
    
    return () => {
      scrollRef.current?.removeEventListener('scroll', handleScroll);
    };
  }, []);
  
  return (
    <div 
      ref={scrollRef}
      className="dashboard-content"
      style={{
        overflowY: 'auto',
        WebkitOverflowScrolling: 'auto',
        overscrollBehavior: 'contain'
      }}
    >
      {/* Dashboard cards */}
    </div>
  );
};
```

---

## Global CSS Implementation

### Add to `design-system.css`

```css
/* Mobile Scroll Optimization */
@media (max-width: 768px) {
  /* Global scroll behavior */
  html, body {
    /* Prevent bounce/rubber-band effect */
    overscroll-behavior-y: contain;
    
    /* No momentum scrolling */
    -webkit-overflow-scrolling: auto;
    
    /* Only allow vertical pan */
    touch-action: pan-y pinch-zoom;
  }
  
  /* All scrollable containers */
  .scrollable,
  .content,
  .main,
  .page-content,
  [style*="overflow: auto"],
  [style*="overflow-y: auto"] {
    /* Disable momentum */
    -webkit-overflow-scrolling: auto !important;
    
    /* Smooth but not floaty */
    scroll-behavior: smooth;
    
    /* Contain overscroll */
    overscroll-behavior: contain;
    
    /* Control touch */
    touch-action: pan-y;
  }
  
  /* Specific mobile components */
  .mobile-vehicle-profile,
  .mobile-dashboard,
  .mobile-vehicles-list {
    -webkit-overflow-scrolling: auto;
    overscroll-behavior-y: contain;
    scroll-behavior: smooth;
  }
  
  /* Timeline horizontal scroll - keep momentum here */
  .timeline-horizontal-scroll {
    -webkit-overflow-scrolling: touch; /* Exception: horizontal scrolls can have momentum */
    overscroll-behavior-x: contain;
    touch-action: pan-x;
  }
  
  /* Image carousels - keep momentum */
  .image-carousel,
  .swipeable-carousel {
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    touch-action: pan-x;
  }
}
```

---

## React Hook for Scroll Control

### Create `useReducedScrollSensitivity.ts`

```typescript
import { useEffect, RefObject } from 'react';

interface ScrollOptions {
  dampingFactor?: number; // 0-1, lower = less sensitive
  throttleMs?: number;     // Milliseconds between scroll events
  disableMomentum?: boolean;
}

export const useReducedScrollSensitivity = (
  ref: RefObject<HTMLElement>,
  options: ScrollOptions = {}
) => {
  const {
    dampingFactor = 0.7,
    throttleMs = 150,
    disableMomentum = true
  } = options;
  
  useEffect(() => {
    if (!ref.current) return;
    
    const element = ref.current;
    
    // Apply CSS properties
    if (disableMomentum) {
      element.style.webkitOverflowScrolling = 'auto';
    }
    element.style.overscrollBehavior = 'contain';
    element.style.scrollBehavior = 'smooth';
    element.style.touchAction = 'pan-y';
    
    // Optional: Add touch damping
    if (dampingFactor < 1) {
      let lastY = 0;
      let startY = 0;
      let startScrollTop = 0;
      
      const handleTouchStart = (e: TouchEvent) => {
        startY = e.touches[0].clientY;
        startScrollTop = element.scrollTop;
        lastY = startY;
      };
      
      const handleTouchMove = (e: TouchEvent) => {
        const currentY = e.touches[0].clientY;
        const deltaY = lastY - currentY;
        const dampedDelta = deltaY * dampingFactor;
        
        element.scrollTop = startScrollTop + ((startY - currentY) * dampingFactor);
        lastY = currentY;
      };
      
      element.addEventListener('touchstart', handleTouchStart, { passive: true });
      element.addEventListener('touchmove', handleTouchMove, { passive: false });
      
      return () => {
        element.removeEventListener('touchstart', handleTouchStart);
        element.removeEventListener('touchmove', handleTouchMove);
      };
    }
    
  }, [ref, dampingFactor, disableMomentum]);
};

// Usage
const MyComponent = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  useReducedScrollSensitivity(scrollRef, {
    dampingFactor: 0.6,  // 40% less sensitive
    throttleMs: 200,
    disableMomentum: true
  });
  
  return (
    <div ref={scrollRef} style={{ overflowY: 'auto', height: '100vh' }}>
      {/* Content */}
    </div>
  );
};
```

---

## Testing & Tuning

### Test on Real Devices

```typescript
// Test different damping factors
const SENSITIVITY_PRESETS = {
  verySensitive: 1.0,   // No reduction
  normal: 0.8,          // 20% reduction
  reduced: 0.6,         // 40% reduction
  veryReduced: 0.4,     // 60% reduction
  minimal: 0.2          // 80% reduction
};

// Allow user to adjust (dev mode)
const [sensitivity, setSensitivity] = useState(0.6);

useReducedScrollSensitivity(scrollRef, {
  dampingFactor: sensitivity
});
```

### Debug Scroll Behavior

```typescript
// Add to component for testing
useEffect(() => {
  if (!scrollRef.current) return;
  
  let lastScrollTop = 0;
  let lastTime = Date.now();
  
  const handleScroll = () => {
    const currentScrollTop = scrollRef.current!.scrollTop;
    const currentTime = Date.now();
    
    const distance = Math.abs(currentScrollTop - lastScrollTop);
    const time = currentTime - lastTime;
    const velocity = distance / time;
    
    console.log('Scroll velocity:', velocity.toFixed(2), 'px/ms');
    
    lastScrollTop = currentScrollTop;
    lastTime = currentTime;
  };
  
  scrollRef.current.addEventListener('scroll', handleScroll);
  
  return () => {
    scrollRef.current?.removeEventListener('scroll', handleScroll);
  };
}, []);
```

---

## Quick Fix Checklist

Apply these in order until scrolling feels right:

1. **[ ] Add to CSS (Global)**
   ```css
   -webkit-overflow-scrolling: auto;
   overscroll-behavior: contain;
   scroll-behavior: smooth;
   ```

2. **[ ] Reduce Touch Momentum**
   ```css
   touch-action: pan-y;
   ```

3. **[ ] Throttle Scroll Events**
   ```typescript
   // Only fire every 150-200ms
   throttleScroll(callback, 150)
   ```

4. **[ ] Add Damping (if still too sensitive)**
   ```typescript
   useReducedScrollSensitivity(ref, { dampingFactor: 0.6 })
   ```

5. **[ ] Test on Real Device**
   - iOS Safari
   - Android Chrome
   - Different screen sizes

---

## Recommended Settings

### For Vehicle Profile (Lots of content)
```typescript
useReducedScrollSensitivity(scrollRef, {
  dampingFactor: 0.6,      // 40% reduction
  throttleMs: 200,
  disableMomentum: true
});
```

### For Dashboard (Card-based)
```typescript
useReducedScrollSensitivity(scrollRef, {
  dampingFactor: 0.7,      // 30% reduction
  throttleMs: 150,
  disableMomentum: true
});
```

### For Image Gallery (Keep momentum)
```typescript
useReducedScrollSensitivity(scrollRef, {
  dampingFactor: 1.0,      // No reduction
  throttleMs: 100,
  disableMomentum: false   // Keep native feel
});
```

---

## Summary

**Primary Fix (CSS):**
```css
-webkit-overflow-scrolling: auto;  /* NOT 'touch' */
overscroll-behavior: contain;
touch-action: pan-y;
```

**Secondary Fix (JS):**
```typescript
useReducedScrollSensitivity(ref, { dampingFactor: 0.6 });
```

**Result:** Scrolling will feel more controlled and less "jumpy" on mobile devices.

