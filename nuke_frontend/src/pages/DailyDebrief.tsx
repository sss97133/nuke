/**
 * Daily Debrief - End of day photo processing experience
 *
 * User opens this at end of day to watch their photos get organized.
 */

import React from 'react';
import LivePhotoProcessor from '../components/profile/LivePhotoProcessor';

export default function DailyDebrief() {
  return (
    <div className="container">
      <div className="main" style={{ paddingTop: 'var(--space-4)' }}>
        <LivePhotoProcessor />
      </div>
    </div>
  );
}
