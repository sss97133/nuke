import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { batRateLimiter } from '../../utils/rateLimiter';

interface Props {
  organizationId: string;
  organizationName: string;
  onComplete?: () => void;
  onClose?: () => void;
}

interface ImportResult {
  url: string;
  success: boolean;
  vehicleId?: string;
  listing?: any;
  error?: string;
}

const BaTBulkImporter: React.FC<Props> = ({ 
  organizationId, 
  organizationName,
  onComplete,
  onClose 
}) => {
  const [batMemberUrl, setBatMemberUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const extractListingsFromMemberPage = async (memberUrl: string): Promise<string[]> => {
    try {
      // Use a CORS proxy or Edge Function to fetch the BaT member page
      const { data, error } = await supabase.functions.invoke('scrape-bat-member', {
        body: { memberUrl }
      });

      if (error) throw error;

      return data.listings || [];
    } catch (error) {
      console.error('Error extracting listings:', error);
      // Fallback: return empty array, user can paste URLs manually
      return [];
    }
  };

  const importSingleListing = async (batUrl: string): Promise<ImportResult> => {
    return batRateLimiter.execute(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('import-bat-listing', {
          body: {
            batUrl,
            organizationId
          }
        });

        if (error) {
          return { url: batUrl, success: false, error: error.message };
        }

        return {
          url: batUrl,
          success: true,
          vehicleId: data.vehicleId,
          listing: data.listing
        };
      } catch (error: any) {
        return { url: batUrl, success: false, error: error.message };
      }
    }, 1); // High priority for user-initiated imports
  };

  const handleBulkImport = async () => {
    if (!batMemberUrl.trim()) {
      alert('Please enter a BaT member URL or paste listing URLs');
      return;
    }

    setImporting(true);
    setResults([]);
    setProgress({ current: 0, total: 0 });

    try {
      let listingUrls: string[] = [];

      // Check if user pasted a member page URL or individual listing URLs
      if (batMemberUrl.includes('/member/')) {
        // Extract all listings from member page
        listingUrls = await extractListingsFromMemberPage(batMemberUrl);
      } else {
        // User pasted individual URLs (one per line)
        listingUrls = batMemberUrl
          .split('\n')
          .map(url => url.trim())
          .filter(url => url && url.includes('bringatrailer.com/listing/'));
      }

      if (listingUrls.length === 0) {
        alert('No BaT listing URLs found. Please check your input.');
        setImporting(false);
        return;
      }

      setProgress({ current: 0, total: listingUrls.length });

      const importResults: ImportResult[] = [];

      for (let i = 0; i < listingUrls.length; i++) {
        const url = listingUrls[i];
        setProgress({ current: i + 1, total: listingUrls.length });

        const result = await importSingleListing(url);
        importResults.push(result);
        setResults([...importResults]);

        // Rate limit: 2 seconds between requests
        if (i < listingUrls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      const successCount = importResults.filter(r => r.success).length;
      alert(`Import complete! ${successCount}/${listingUrls.length} vehicles imported successfully.`);

      if (onComplete) {
        onComplete();
      }
    } catch (error: any) {
      console.error('Bulk import error:', error);
      alert(`Import failed: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };

  const successCount = results.filter(r => r.success).length;
  const errorCount = results.filter(r => !r.success).length;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: '90%', maxWidth: '800px', maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '11pt', fontWeight: 700 }}>
            Import BaT Sales for {organizationName}
          </h3>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '18px',
                cursor: 'pointer',
                padding: '4px 8px'
              }}
            >
              ×
            </button>
          )}
        </div>

        <div className="card-body">
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '9pt', fontWeight: 600 }}>
              BaT Member URL or Listing URLs (one per line)
            </label>
            <textarea
              value={batMemberUrl}
              onChange={(e) => setBatMemberUrl(e.target.value)}
              placeholder="https://bringatrailer.com/member/yourshop/&#10;or paste listing URLs:&#10;https://bringatrailer.com/listing/...&#10;https://bringatrailer.com/listing/..."
              rows={8}
              style={{
                width: '100%',
                padding: '8px',
                fontSize: '9pt',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                fontFamily: 'monospace'
              }}
              disabled={importing}
            />
            <div style={{ marginTop: '8px', fontSize: '8pt', color: 'var(--text-muted)' }}>
              Tip: Visit your BaT member page (e.g., bringatrailer.com/member/vivalasvegasautos), 
              copy the URL, and paste it here. We'll automatically extract all your sold listings.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              onClick={handleBulkImport}
              disabled={importing || !batMemberUrl.trim()}
              className="button button-primary"
              style={{ fontSize: '9pt' }}
            >
              {importing ? 'Importing...' : 'Start Import'}
            </button>
            {onClose && (
              <button
                onClick={onClose}
                disabled={importing}
                className="button button-secondary"
                style={{ fontSize: '9pt' }}
              >
                Cancel
              </button>
            )}
          </div>

          {importing && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '9pt', marginBottom: '8px' }}>
                Progress: {progress.current} / {progress.total} listings
              </div>
              <div style={{ 
                width: '100%', 
                height: '8px', 
                background: 'var(--background-secondary)', 
                borderRadius: '4px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${(progress.current / progress.total) * 100}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
          )}

          {results.length > 0 && (
            <div>
              <div style={{ 
                display: 'flex', 
                gap: '16px', 
                marginBottom: '12px',
                padding: '12px',
                background: 'var(--background-secondary)',
                borderRadius: '4px'
              }}>
                <div>
                  <span style={{ fontSize: '10pt', fontWeight: 700, color: 'var(--color-success)' }}>
                    ✓ {successCount}
                  </span>
                  <span style={{ fontSize: '8pt', color: 'var(--text-muted)', marginLeft: '4px' }}>
                    imported
                  </span>
                </div>
                {errorCount > 0 && (
                  <div>
                    <span style={{ fontSize: '10pt', fontWeight: 700, color: 'var(--color-danger)' }}>
                      ✗ {errorCount}
                    </span>
                    <span style={{ fontSize: '8pt', color: 'var(--text-muted)', marginLeft: '4px' }}>
                      failed
                    </span>
                  </div>
                )}
              </div>

              <div style={{ maxHeight: '300px', overflow: 'auto' }}>
                {results.map((result, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '8px',
                      marginBottom: '4px',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      fontSize: '8pt',
                      background: result.success ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        {result.success ? (
                          <>
                            <span style={{ color: 'var(--color-success)', marginRight: '8px' }}>✓</span>
                            <strong>
                              {result.listing?.year} {result.listing?.make} {result.listing?.model}
                            </strong>
                            <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
                              ${result.listing?.salePrice?.toLocaleString()}
                            </span>
                          </>
                        ) : (
                          <>
                            <span style={{ color: 'var(--color-danger)', marginRight: '8px' }}>✗</span>
                            <span style={{ color: 'var(--text-muted)' }}>{result.url}</span>
                            <div style={{ color: 'var(--color-danger)', marginLeft: '20px', marginTop: '4px' }}>
                              {result.error}
                            </div>
                          </>
                        )}
                      </div>
                      {result.success && result.vehicleId && (
                        <a
                          href={`/vehicle/${result.vehicleId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: '8pt',
                            color: 'var(--accent)',
                            textDecoration: 'none',
                            marginLeft: '8px'
                          }}
                        >
                          View →
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ 
            marginTop: '16px', 
            padding: '12px', 
            background: 'var(--background-secondary)', 
            borderRadius: '4px',
            fontSize: '8pt',
            color: 'var(--text-muted)'
          }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>What this does:</div>
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              <li>Extracts year, make, model, VIN, sale price, sale date from each BaT listing</li>
              <li>Matches to existing vehicles in your inventory (by VIN or fuzzy match)</li>
              <li>Creates new vehicle profiles if no match found</li>
              <li>Marks vehicles as "SOLD" with BaT-verified pricing</li>
              <li>Adds data validation entries (100% confidence from BaT)</li>
            </ul>
          </div>

          <div style={{ 
            marginTop: '12px', 
            padding: '12px', 
            background: 'rgba(59, 130, 246, 0.1)', 
            borderRadius: '4px',
            fontSize: '8pt',
            color: 'var(--text-muted)',
            border: '1px solid rgba(59, 130, 246, 0.3)'
          }}>
            <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--accent)' }}>
              🚀 Coming Soon: Reverse Flow
            </div>
            <div>
              Once your profiles are complete, you'll be able to submit vehicles TO BaT with one click.
              We'll pre-fill their forms with your data, handle the submission, and take a commission on successful sales.
              N-Zero becomes your central inventory hub with two-way BaT integration.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BaTBulkImporter;

