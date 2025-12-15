// BRAND NEW MINIMAL ENTRY POINT - No dependencies on old code
// Add visible marker to confirm this file is being used
document.body.style.backgroundColor = '#ff0000'; // Red background to confirm this file loads
console.log('[main-new] Starting - RED BACKGROUND CONFIRMS THIS FILE IS LOADED');

const rootEl = document.getElementById('root');
if (!rootEl) {
  console.error('[main-new] Root element not found');
  document.body.innerHTML = '<div style="color: white; padding: 20px; background: red;">ERROR: Root element not found</div>';
} else {
  console.log('[main-new] Root element found');
  
  // Use dynamic import to avoid any static import issues
  Promise.all([
    import('react'),
    import('react-dom/client')
  ]).then(([reactModule, reactDomModule]) => {
    console.log('[main-new] Both modules imported successfully');
    const React = reactModule.default;
    const { createRoot } = reactDomModule;
    
    console.log('[main-new] Creating root');
    const root = createRoot(rootEl);
    
    console.log('[main-new] Rendering');
    root.render(React.createElement('div', { 
      style: { 
        padding: '20px', 
        fontSize: '16px',
        backgroundColor: 'var(--surface)',
        color: 'black',
        border: '2px solid green'
      } 
    }, 'NEW ENTRY POINT - If you see this, the minimal test works'));
    
    console.log('[main-new] Render complete - SUCCESS');
  }).catch((err) => {
    console.error('[main-new] Import or render failed:', err);
    console.error('[main-new] Error details:', {
      name: err?.name,
      message: err?.message,
      stack: err?.stack
    });
    rootEl.innerHTML = '<div style="color: white; padding: 20px; background: red;">Error: ' + (err?.message || 'Unknown error') + '</div>';
  });
}

