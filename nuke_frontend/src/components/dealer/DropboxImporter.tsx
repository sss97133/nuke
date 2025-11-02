// Dropbox Bulk Import for Dealers
// Connect Dropbox, scan folders, auto-create vehicle profiles

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface DropboxImporterProps {
  organizationId: string;
  isOwner: boolean;
}

export default function DropboxImporter({ organizationId, isOwner }: DropboxImporterProps) {
  const [connected, setConnected] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [importJobs, setImportJobs] = useState<any[]>([]);

  useEffect(() => {
    checkConnection();
    loadImportJobs();
  }, [organizationId]);

  const checkConnection = async () => {
    const { data } = await supabase
      .from('dropbox_connections')
      .select('last_sync')
      .eq('organization_id', organizationId)
      .single();

    if (data) {
      setConnected(true);
      setLastSync(data.last_sync);
    }
  };

  const loadImportJobs = async () => {
    const { data } = await supabase
      .from('dropbox_import_jobs')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (data) setImportJobs(data);
  };

  const connectDropbox = async () => {
    try {
      // Call edge function to get auth URL
      const response = await fetch(`${supabase.supabaseUrl}/functions/v1/dropbox-oauth?action=authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({ organizationId })
      });

      const { authUrl } = await response.json();
      
      // Redirect to Dropbox authorization
      window.location.href = authUrl;
    } catch (error: any) {
      alert(`Failed to connect: ${error.message}`);
    }
  };

  const startImport = async () => {
    if (!confirm('Start bulk import from Dropbox? This will scan all folders and create vehicle profiles.')) {
      return;
    }

    setImporting(true);

    try {
      const response = await fetch(`${supabase.supabaseUrl}/functions/v1/dropbox-bulk-import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({ 
          organizationId,
          dropboxPath: '/Viva Inventory'
        })
      });

      const result = await response.json();

      if (result.success) {
        alert(`Import started! Job ID: ${result.jobId}\nFolders: ${result.totalFolders}\n\nCheck back in a few minutes.`);
        loadImportJobs();
      } else {
        alert(`Import failed: ${result.error}`);
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };

  if (!isOwner) {
    return null;
  }

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
        Dropbox Bulk Import
      </div>
      <div className="card-body">
        {connected ? (
          <div>
            <div style={{ fontSize: '9pt', color: 'var(--success)', marginBottom: '12px' }}>
              ✓ Dropbox connected
            </div>
            {lastSync && (
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '12px' }}>
                Last sync: {new Date(lastSync).toLocaleString()}
              </div>
            )}
            <button
              onClick={startImport}
              disabled={importing}
              className="button button-primary"
              style={{ fontSize: '9pt', marginRight: '8px' }}
            >
              {importing ? 'Importing...' : 'Import from Dropbox'}
            </button>
            <button
              onClick={checkConnection}
              className="button button-secondary"
              style={{ fontSize: '9pt' }}
            >
              Refresh Status
            </button>

            {/* Import History */}
            {importJobs.length > 0 && (
              <div style={{ marginTop: '20px' }}>
                <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>
                  Import History
                </div>
                {importJobs.map(job => (
                  <div
                    key={job.id}
                    style={{
                      padding: '8px 12px',
                      marginBottom: '8px',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      background: 'var(--surface)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '8pt' }}>
                        {new Date(job.created_at).toLocaleString()}
                      </div>
                      <div style={{
                        fontSize: '7pt',
                        padding: '2px 6px',
                        borderRadius: '2px',
                        background: job.status === 'completed' ? '#d4edda' :
                                   job.status === 'failed' ? '#f8d7da' :
                                   '#fff3cd',
                        color: job.status === 'completed' ? '#155724' :
                               job.status === 'failed' ? '#721c24' :
                               '#856404'
                      }}>
                        {job.status}
                      </div>
                    </div>
                    <div style={{ fontSize: '8pt', marginTop: '4px', color: 'var(--text-secondary)' }}>
                      {job.processed_files}/{job.total_files} folders • {job.vehicles_created} vehicles created
                    </div>
                    {job.error_message && (
                      <div style={{ fontSize: '7pt', color: 'var(--error)', marginTop: '4px' }}>
                        Error: {job.error_message}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '9pt', marginBottom: '12px', color: 'var(--text-secondary)' }}>
              Connect your Dropbox to automatically import deal jackets and create vehicle profiles.
            </div>
            <div style={{
              padding: '12px',
              background: '#f8f9fa',
              borderRadius: '4px',
              marginBottom: '12px',
              fontSize: '8pt',
              color: 'var(--text-secondary)'
            }}>
              <div style={{ fontWeight: 700, marginBottom: '8px' }}>Expected folder structure:</div>
              <div style={{ fontFamily: 'monospace', fontSize: '7pt' }}>
                /Viva Inventory/<br />
                &nbsp;&nbsp;├── /In Stock/<br />
                &nbsp;&nbsp;│   ├── /1977 K5 Blazer - #VIN123/<br />
                &nbsp;&nbsp;│   │   ├── photos/<br />
                &nbsp;&nbsp;│   │   └── title.pdf<br />
                &nbsp;&nbsp;├── /Consignment/<br />
                &nbsp;&nbsp;└── /Sold/
              </div>
            </div>
            <button
              onClick={connectDropbox}
              className="button button-primary"
              style={{ fontSize: '9pt' }}
            >
              Connect Dropbox
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

