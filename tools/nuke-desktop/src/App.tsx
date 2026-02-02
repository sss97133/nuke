import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { createClient } from '@supabase/supabase-js';

// Supabase client
const supabase = createClient(
  'https://qkgaybvrernstplzjaam.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgxNTkxMDMsImV4cCI6MjA1MzczNTEwM30.XrBq1AZ7QJ3J7wABv-0I2e2v_5xA_1L7bvs7n5yfmNU'
);

interface ScanResult {
  path: string;
  filename: string;
  file_type: string;
  category: string;
  size: number;
  modified: string;
  potential_vehicle?: {
    year?: string;
    make?: string;
    model?: string;
    vin?: string;
    confidence: number;
  };
}

interface User {
  id: string;
  email: string;
}

type Page = 'scan' | 'results' | 'sync' | 'settings';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [currentPage, setCurrentPage] = useState<Page>('scan');
  const [scanPaths, setScanPaths] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [ollamaOnline, setOllamaOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [apiKey, setApiKey] = useState('');

  // Check auth on load
  useEffect(() => {
    checkAuth();
    checkOllama();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUser({ id: session.user.id, email: session.user.email || '' });
    }
    setLoading(false);
  };

  const checkOllama = async () => {
    try {
      const online = await invoke<boolean>('check_ollama');
      setOllamaOnline(online);
    } catch {
      setOllamaOnline(false);
    }
  };

  const handleLogin = async () => {
    setLoginError('');
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setLoginError(error.message);
    } else if (data.user) {
      setUser({ id: data.user.id, email: data.user.email || '' });
    }
  };

  const handleSignup = async () => {
    setLoginError('');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) {
      setLoginError(error.message);
    } else {
      setLoginError('Check your email for verification link');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const selectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: true,
      });
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        setScanPaths(prev => [...new Set([...prev, ...paths])]);
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
    }
  };

  const removePath = (path: string) => {
    setScanPaths(prev => prev.filter(p => p !== path));
  };

  const startScan = async () => {
    if (scanPaths.length === 0) return;

    setScanning(true);
    setScanProgress(0);
    setScanResults([]);

    try {
      const results = await invoke<ScanResult[]>('scan_directories', {
        config: {
          paths: scanPaths,
          include_hidden: false,
          max_depth: 10,
          include_images: true,
          include_documents: true,
          include_spreadsheets: true,
        },
      });

      setScanResults(results);
      setScanProgress(100);
      setCurrentPage('results');
    } catch (error) {
      console.error('Scan failed:', error);
    } finally {
      setScanning(false);
    }
  };

  const syncToCloud = async () => {
    if (!apiKey && !user) {
      alert('Please enter an API key or sign in');
      return;
    }

    setSyncing(true);
    setSyncResult(null);

    try {
      // Get auth token
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const result = await invoke<any>('sync_to_cloud', {
        files: scanResults.filter(r => r.potential_vehicle),
        apiKey: apiKey || token || '',
        batchSize: 50,
      });

      setSyncResult(result);
    } catch (error: any) {
      setSyncResult({ error: error.message });
    } finally {
      setSyncing(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (category: string) => {
    switch (category) {
      case 'image': return 'IMG';
      case 'document': return 'DOC';
      case 'spreadsheet': return 'XLS';
      default: return 'FILE';
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="login-container">
        <div className="login-box">
          <div className="login-title">NUKE</div>
          <div className="login-subtitle">Loading...</div>
        </div>
      </div>
    );
  }

  // Login screen
  if (!user) {
    return (
      <div className="login-container">
        <div className="login-box">
          <div className="login-title">NUKE</div>
          <div className="login-subtitle">Vehicle Data Scanner</div>

          <div style={{ marginBottom: 16 }}>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label className="label">Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            />
          </div>

          {loginError && (
            <div style={{ color: 'var(--error)', fontSize: 11, marginBottom: 16 }}>
              {loginError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleLogin}>
              Sign In
            </button>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleSignup}>
              Sign Up
            </button>
          </div>

          <div style={{ marginTop: 24, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            Create an account at nuke.com to sync your vehicle data
          </div>
        </div>
      </div>
    );
  }

  // Main app
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo">NUKE</div>
        <div className="user-info">
          {user.email}
          <button
            onClick={handleLogout}
            style={{
              marginLeft: 12,
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Sign Out
          </button>
        </div>
      </header>

      <div className="main">
        {/* Sidebar */}
        <nav className="sidebar">
          <div
            className={`nav-item ${currentPage === 'scan' ? 'active' : ''}`}
            onClick={() => setCurrentPage('scan')}
          >
            Scan
          </div>
          <div
            className={`nav-item ${currentPage === 'results' ? 'active' : ''}`}
            onClick={() => setCurrentPage('results')}
          >
            Results ({scanResults.length})
          </div>
          <div
            className={`nav-item ${currentPage === 'sync' ? 'active' : ''}`}
            onClick={() => setCurrentPage('sync')}
          >
            Sync
          </div>
          <div
            className={`nav-item ${currentPage === 'settings' ? 'active' : ''}`}
            onClick={() => setCurrentPage('settings')}
          >
            Settings
          </div>

          {/* Ollama Status */}
          <div style={{ marginTop: 'auto', paddingTop: 16 }}>
            <div className="ollama-status">
              <div className={`ollama-dot ${ollamaOnline ? 'online' : 'offline'}`} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Ollama {ollamaOnline ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
        </nav>

        {/* Content */}
        <main className="content">
          {/* Scan Page */}
          {currentPage === 'scan' && (
            <>
              <div className="card">
                <div className="card-title">Scan Folders</div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
                  Select folders to scan for vehicle-related files (images, documents, spreadsheets)
                </p>

                <button className="btn btn-secondary" onClick={selectFolder}>
                  + Add Folder
                </button>

                {scanPaths.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    {scanPaths.map((path) => (
                      <div
                        key={path}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          background: 'var(--bg)',
                          borderRadius: 4,
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ fontSize: 11 }}>{path}</span>
                        <button
                          onClick={() => removePath(path)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                          }}
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {scanning && (
                <div className="card">
                  <div className="card-title">Scanning...</div>
                  <div className="progress">
                    <div className="progress-bar" style={{ width: `${scanProgress}%` }} />
                  </div>
                </div>
              )}

              <button
                className="btn btn-primary"
                onClick={startScan}
                disabled={scanPaths.length === 0 || scanning}
              >
                {scanning ? 'Scanning...' : 'Start Scan'}
              </button>
            </>
          )}

          {/* Results Page */}
          {currentPage === 'results' && (
            <>
              <div className="card">
                <div className="card-title">
                  Scan Results
                  <span style={{ fontWeight: 'normal', color: 'var(--text-muted)', marginLeft: 8 }}>
                    {scanResults.length} files found, {scanResults.filter(r => r.potential_vehicle).length} with vehicle data
                  </span>
                </div>

                {scanResults.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">[ ]</div>
                    <div>No files scanned yet</div>
                    <div style={{ fontSize: 11, marginTop: 8 }}>
                      Go to Scan tab to select folders
                    </div>
                  </div>
                ) : (
                  <div className="file-list">
                    {scanResults.map((result, index) => (
                      <div key={index} className="file-item">
                        <div className="file-icon">{getFileIcon(result.category)}</div>
                        <div className="file-info">
                          <div className="file-name">{result.filename}</div>
                          <div className="file-path">{result.path}</div>
                          {result.potential_vehicle && (
                            <div className="file-vehicle">
                              {[
                                result.potential_vehicle.year,
                                result.potential_vehicle.make,
                                result.potential_vehicle.model,
                              ].filter(Boolean).join(' ')}
                              {result.potential_vehicle.vin && ` (${result.potential_vehicle.vin})`}
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {formatBytes(result.size)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Sync Page */}
          {currentPage === 'sync' && (
            <>
              <div className="card">
                <div className="card-title">Sync to Nuke Cloud</div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
                  Upload detected vehicle data to your Nuke account
                </p>

                <div style={{ marginBottom: 16 }}>
                  <label className="label">API Key (optional - uses login if empty)</label>
                  <input
                    type="text"
                    className="input"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="nk_live_xxxxxxxxxxxxxxxx"
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 12 }}>
                    {scanResults.filter(r => r.potential_vehicle).length} vehicles ready to sync
                  </span>
                </div>

                <button
                  className="btn btn-primary"
                  onClick={syncToCloud}
                  disabled={syncing || scanResults.filter(r => r.potential_vehicle).length === 0}
                >
                  {syncing ? 'Syncing...' : 'Sync Now'}
                </button>

                {syncResult && (
                  <div style={{ marginTop: 16, padding: 12, background: 'var(--bg)', borderRadius: 4 }}>
                    {syncResult.error ? (
                      <div style={{ color: 'var(--error)' }}>Error: {syncResult.error}</div>
                    ) : (
                      <div>
                        <div style={{ color: 'var(--success)' }}>
                          Synced: {syncResult.synced}
                        </div>
                        {syncResult.failed > 0 && (
                          <div style={{ color: 'var(--error)' }}>
                            Failed: {syncResult.failed}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Settings Page */}
          {currentPage === 'settings' && (
            <>
              <div className="card">
                <div className="card-title">Settings</div>

                <div style={{ marginBottom: 16 }}>
                  <label className="label">Ollama URL</label>
                  <input
                    type="text"
                    className="input"
                    defaultValue="http://localhost:11434"
                    disabled
                  />
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                    {ollamaOnline ? 'Connected' : 'Not running - install Ollama for local AI processing'}
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label className="label">Account</label>
                  <div style={{ fontSize: 12 }}>{user.email}</div>
                </div>

                <button className="btn btn-secondary" onClick={() => window.open('https://nuke.com/settings', '_blank')}>
                  Manage Account on Web
                </button>
              </div>

              <div className="card">
                <div className="card-title">About</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Nuke Desktop v0.1.0<br />
                  Built with Tauri + React
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
