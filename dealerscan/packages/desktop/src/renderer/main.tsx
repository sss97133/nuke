import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { initSupabase } from '@dealerscan/shared'
import App from './App'
import './index.css'

// Default Supabase config - can be overridden from stored config
const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY4MTYyNjUsImV4cCI6MjA1MjM5MjI2NX0.R4xvnmMeNQJjUOHYbVE4Bq5s8O0wYBWctR4g6bOG1bM'

async function init() {
  // Try to load stored config, fallback to defaults
  let config = { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }

  if (window.electronAPI) {
    const stored = await window.electronAPI.getStoredConfig()
    if (stored) {
      config = { url: stored.supabaseUrl, anonKey: stored.supabaseAnonKey }
    }
  }

  initSupabase(config)

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <HashRouter>
        <App />
        <Toaster position="bottom-right" />
      </HashRouter>
    </React.StrictMode>,
  )
}

init()
