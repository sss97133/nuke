import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// Import styles in the correct order (global first, then components)
import './index.css'
import './styles/global-css-fixes.css'
import './styles/component-classes.css'
// import './dev-styles.css' // Development-only styles - Merged into index.css

// Import additional styles to ensure proper bundling
import './fixes/style-importer.js'
import './css-fixes/index.js' // Enhanced CSS fixes

createRoot(document.getElementById("root")!).render(<App />);
