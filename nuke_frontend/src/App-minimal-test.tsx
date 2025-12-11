// ABSOLUTE MINIMAL TEST - NO fetch calls at module level (they might cause TDZ)
// import React from 'react';

// Inline component - no imports, no router, no React import, no module-level fetch
function CursorHomepage() {
  return <div style={{ padding: '20px' }}>Absolute Minimal Test - No Module-Level Fetch - If you see this, TDZ is resolved</div>;
}

function App() {
  return <CursorHomepage />;
}

export default App;

