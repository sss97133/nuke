// ABSOLUTE MINIMAL TEST VERSION - Completely clean file to test TDZ issue
import React from 'react';
// Try function declaration instead of const to avoid potential TDZ
function CursorHomepage() {
return <div style={{ padding: '20px' }}>Minimal Test - If you see this, TDZ is resolved</div>;
}
export default CursorHomepage;
