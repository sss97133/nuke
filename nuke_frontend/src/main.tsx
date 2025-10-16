import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import MinimalApp from './MinimalApp.tsx'

// Debug: verify that main.tsx is executing in the browser
console.log('[main] starting minimal application bootstrap');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MinimalApp />
  </StrictMode>,
)

console.log('[main] React root render invoked');
