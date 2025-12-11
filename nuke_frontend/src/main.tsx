// ULTRA MINIMAL - Wrap everything in try-catch and log to console
console.log('[main.tsx] Starting module execution');

try {
  console.log('[main.tsx] Before imports');
  import('react-dom/client').then((module) => {
    console.log('[main.tsx] react-dom/client imported');
    const { createRoot } = module;
    import('react').then((reactModule) => {
      console.log('[main.tsx] react imported');
      const React = reactModule.default;
      
      const root = document.getElementById('root');
      if (root) {
        console.log('[main.tsx] Root element found, creating root');
        const reactRoot = createRoot(root);
        console.log('[main.tsx] Root created, rendering');
        reactRoot.render(React.createElement('div', null, 'If you see this, dynamic import works'));
        console.log('[main.tsx] Render complete');
      } else {
        console.error('[main.tsx] Root element not found');
      }
    }).catch((err) => {
      console.error('[main.tsx] React import failed:', err);
    });
  }).catch((err) => {
    console.error('[main.tsx] react-dom/client import failed:', err);
  });
} catch (error) {
  console.error('[main.tsx] Top-level error:', error);
  throw error;
}
/* Force Vercel rebuild Mon Oct 20 18:04:13 AST 2025 */
// Force rebuild 1761003103
