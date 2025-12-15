/**
 * Hook to detect mobile devices
 */

import { useState, useEffect } from 'react';

export const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      // Primary: viewport width breakpoint.
      const isSmallScreen = window.innerWidth < 768;

      // Secondary: phone UA (catches phone landscape widths > 768).
      // Important: exclude tablets (iPad and many Android tablets do NOT include "Mobile" in UA).
      const ua = navigator.userAgent || '';
      const isPhoneUA =
        /iPhone|iPod|Windows Phone/i.test(ua) ||
        (/Android/i.test(ua) && /Mobile/i.test(ua));

      setIsMobile(isSmallScreen || isPhoneUA);
    };

    // Check on mount
    checkMobile();

    // Check on resize
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
};

