import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface ScrapeResult {
  url: string;
  success: boolean;
  vehicleId?: string;
  created?: boolean;
  error?: string;
  data?: any;
}

interface ScrapeSummary {
  imported: number;
  skipped: number;
  errors: number;
}

export default function KSLScraper() {
  const [searchUrl, setSearchUrl] = useState('https://cars.ksl.com/v2/search/make/Chevrolet/yearFrom/1970/yearTo/1991');
  const [maxListings, setMaxListings] = useState(20);
  const [importToDb, setImportToDb] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [results, setResults] = useState<ScrapeResult[]>([]);
  const [summary, setSummary] = useState<ScrapeSummary | null>(null);
  const [progress, setProgress] = useState('');

  const handleScrape = async () => {
    if (!searchUrl.trim()) {
      alert('Please enter a KSL search URL');
      return;
    }

    setScraping(true);
    setProgress('Starting scrape...');
    setResults([]);
    setSummary(null);

    try {
      // Call the scrape-ksl-listings edge function
      // Note: Since Edge Functions can't run Playwright, we'll need to call a script
      // For now, we'll use a workaround - call a serverless function or use the script directly
      
      setProgress('Scraping KSL listings...');
      
      // Option 1: Call edge function (which will need to trigger external service)
      // Option 2: For now, we'll show instructions to run the script
      // In production, you'd set up a Vercel serverless function or similar
      
      const { data, error } = await supabase.functions.invoke('scrape-ksl-listings', {
        body: {
          searchUrl: searchUrl.trim(),
          maxListings,
          importToDb
        }
      });

      if (error) {
        throw new Error(error.message || 'Scrape failed');
      }

      setProgress('Processing results...');
      
      // For now, show a message that the script needs to be run
      // In production, this would return actual results
      alert('KSL scraping initiated. Since Edge Functions cannot run Playwright, please run:\n\nnode scripts/scrape-ksl-parallel.js "' + searchUrl + '" ' + maxListings + ' ' + (importToDb ? 'true' : 'false'));
      
      setProgress('Complete');
      
    } catch (error: any) {
      console.error('Scrape error:', error);
      setProgress('Error: ' + error.message);
      alert('Error: ' + error.message);
    } finally {
      setScraping(false);
    }
  };

  const handleQuickTest = () => {
    setSearchUrl('https://cars.ksl.com/v2/search/make/Chevrolet/yearFrom/1970/yearTo/1991');
    setMaxListings(20);
    setImportToDb(true);
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '8px' }}>KSL Scraper</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
          Scrape and import truck listings from KSL Cars
        </p>
      </div>

      <div className="rh-card" style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Scrape Configuration</h2>
        
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
            KSL Search URL
          </label>
          <input
            type="text"
            value={searchUrl}
            onChange={(e) => setSearchUrl(e.target.value)}
            placeholder="https://cars.ksl.com/v2/search/make/Chevrolet/yearFrom/1970/yearTo/1991"
            style={{
              width: '100%',
              padding: '12px',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
            Max Listings
          </label>
          <input
            type="number"
            value={maxListings}
            onChange={(e) => setMaxListings(parseInt(e.target.value) || 20)}
            min="1"
            max="100"
            style={{
              width: '100px',
              padding: '12px',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={importToDb}
              onChange={(e) => setImportToDb(e.target.checked)}
            />
            <span style={{ fontSize: '14px' }}>Import to database</span>
          </label>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleScrape}
            disabled={scraping}
            style={{
              padding: '12px 24px',
              backgroundColor: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: scraping ? 'not-allowed' : 'pointer',
              opacity: scraping ? 0.6 : 1
            }}
          >
            {scraping ? 'Scraping...' : 'Start Scrape'}
          </button>
          
          <button
            onClick={handleQuickTest}
            disabled={scraping}
            style={{
              padding: '12px 24px',
              backgroundColor: 'var(--background-secondary)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: scraping ? 'not-allowed' : 'pointer'
            }}
          >
            Quick Test (20 Trucks)
          </button>
        </div>

        {progress && (
          <div style={{ marginTop: '16px', padding: '12px', backgroundColor: 'var(--background-secondary)', borderRadius: '4px', fontSize: '14px' }}>
            {progress}
          </div>
        )}
      </div>

      {summary && (
        <div className="rh-card" style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Summary</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '24px', fontWeight: '600', color: 'var(--success)' }}>
                {summary.imported}
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Imported</div>
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-muted)' }}>
                {summary.skipped}
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Skipped</div>
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: '600', color: 'var(--error)' }}>
                {summary.errors}
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Errors</div>
            </div>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="rh-card">
          <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Results</h2>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {results.map((result, i) => (
              <div
                key={i}
                style={{
                  padding: '12px',
                  marginBottom: '8px',
                  backgroundColor: result.success ? 'var(--background-secondary)' : 'var(--error-background)',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              >
                <div style={{ fontWeight: '500', marginBottom: '4px' }}>
                  {result.success ? '✅' : '❌'} {result.url}
                </div>
                {result.vehicleId && (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Vehicle ID: {result.vehicleId} {result.created ? '(Created)' : '(Existed)'}
                  </div>
                )}
                {result.error && (
                  <div style={{ fontSize: '12px', color: 'var(--error)' }}>
                    Error: {result.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rh-card" style={{ marginTop: '24px', backgroundColor: 'var(--background-secondary)' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>Instructions</h3>
        <div style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
          <p style={{ marginBottom: '8px' }}>
            <strong>Note:</strong> Since Supabase Edge Functions cannot run Playwright, you have two options:
          </p>
          <ol style={{ paddingLeft: '20px', marginBottom: '16px' }}>
            <li style={{ marginBottom: '8px' }}>
              <strong>Run locally:</strong> Use the script directly:
              <pre style={{ 
                marginTop: '8px', 
                padding: '12px', 
                backgroundColor: 'var(--background)', 
                borderRadius: '4px',
                fontSize: '12px',
                overflow: 'auto'
              }}>
                node scripts/scrape-ksl-parallel.js "{searchUrl}" {maxListings} {importToDb ? 'true' : 'false'}
              </pre>
            </li>
            <li style={{ marginBottom: '8px' }}>
              <strong>Production:</strong> Set up a Vercel serverless function or similar service that can run Playwright
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}

