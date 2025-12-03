import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function LiveProcessingMonitor() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 3000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    try {
      // Images
      const { count: totalImages } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true });

      const { count: analyzedImages } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true })
        .eq('ai_processing_status', 'completed');

      // Catalog
      const { count: totalParts } = await supabase
        .from('catalog_parts')
        .select('*', { count: 'exact', head: true });

      const { data: chunkStatus } = await supabase
        .from('catalog_text_chunks')
        .select('status, parts_extracted');

      const chunksCompleted = chunkStatus?.filter(c => c.status === 'completed').length || 0;
      const chunksPending = chunkStatus?.filter(c => c.status === 'pending').length || 0;

      setData({
        totalImages,
        analyzedImages,
        totalParts,
        chunksCompleted,
        chunksPending,
        lastUpdate: new Date().toLocaleTimeString()
      });
    } catch (error) {
      console.error('Error:', error);
    }
  }

  if (!data) return <div style={{padding: '40px', textAlign: 'center'}}>Loading...</div>;

  return (
    <div style={{padding: '24px', maxWidth: '1200px', margin: '0 auto'}}>
      <h1 style={{fontSize: '18pt', marginBottom: '24px'}}>Live Processing Monitor</h1>
      
      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px'}}>
        
        {/* Image Analysis */}
        <div style={{background: '#1a1a1a', border: '2px solid #333', borderRadius: '8px', padding: '24px'}}>
          <h2 style={{fontSize: '12pt', marginBottom: '16px', color: '#4ade80'}}>Tier 1 Image Analysis</h2>
          <div style={{fontSize: '32pt', fontWeight: 'bold', marginBottom: '8px'}}>
            {data.analyzedImages?.toLocaleString() || 0}
          </div>
          <div style={{fontSize: '10pt', color: '#888'}}>
            of {data.totalImages?.toLocaleString() || 0} total
          </div>
          <div style={{marginTop: '16px', height: '8px', background: '#333', borderRadius: '4px', overflow: 'hidden'}}>
            <div style={{
              width: `${(data.analyzedImages / data.totalImages * 100) || 0}%`,
              height: '100%',
              background: '#4ade80',
              transition: 'width 0.5s ease'
            }} />
          </div>
          <div style={{marginTop: '8px', fontSize: '10pt', color: '#888', textAlign: 'right'}}>
            {((data.analyzedImages / data.totalImages * 100) || 0).toFixed(1)}%
          </div>
        </div>

        {/* Catalog Indexing */}
        <div style={{background: '#1a1a1a', border: '2px solid #333', borderRadius: '8px', padding: '24px'}}>
          <h2 style={{fontSize: '12pt', marginBottom: '16px', color: '#60a5fa'}}>LMC Catalog Indexing</h2>
          <div style={{fontSize: '32pt', fontWeight: 'bold', marginBottom: '8px'}}>
            {data.totalParts?.toLocaleString() || 0}
          </div>
          <div style={{fontSize: '10pt', color: '#888'}}>
            parts indexed
          </div>
          <div style={{marginTop: '16px', fontSize: '10pt'}}>
            <div style={{marginBottom: '8px'}}>
              ✅ {data.chunksCompleted || 0} chunks done
            </div>
            <div>
              ⏳ {data.chunksPending || 0} chunks pending
            </div>
          </div>
        </div>
      </div>

      <div style={{marginTop: '16px', textAlign: 'center', fontSize: '8pt', color: '#666'}}>
        Last update: {data.lastUpdate} • Auto-refreshing every 3s
      </div>
    </div>
  );
}

