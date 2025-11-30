import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/util/ErrorBoundary'

// Debug: verify that main.tsx is executing in the browser
console.log('[main] starting application bootstrap');

createRoot(document.getElementById('root')!).render(
  // StrictMode disabled to prevent double-rendering in development
  // Re-enable if needed for catching side effects
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)

console.log('[main] React root render invoked');
/* Force Vercel rebuild Mon Oct 20 18:04:13 AST 2025 */
// Force rebuild 1761003103
