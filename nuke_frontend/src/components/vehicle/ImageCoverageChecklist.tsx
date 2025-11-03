import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface CoverageAngle {
  id: string;
  category: string;
  angle_name: string;
  display_name: string;
  is_essential: boolean;
  has_image: boolean;
  image_count: number;
}

interface Props {
  vehicleId: string;
}

const categoryNames: Record<string, string> = {
  exterior: 'Exterior',
  interior: 'Interior',
  undercarriage: 'Undercarriage',
  engine_bay: 'Engine Bay',
  vin_plates: 'VIN Plates',
  details: 'Details'
};

const ImageCoverageChecklist: React.FC<Props> = ({ vehicleId }) => {
  const [coverage, setCoverage] = useState<CoverageAngle[]>([]);
  const [coveragePercent, setCoveragePercent] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCoverage();
  }, [vehicleId]);

  const loadCoverage = async () => {
    try {
      // Get all essential angles with their coverage status
      const { data: angles, error } = await supabase
        .from('image_coverage_angles')
        .select(`
          id,
          category,
          angle_name,
          display_name,
          is_essential,
          vehicle_image_angles!inner (
            id,
            vehicle_id
          )
        `)
        .eq('vehicle_image_angles.vehicle_id', vehicleId)
        .eq('is_essential', true)
        .order('priority_order');

      if (error) throw error;

      // Also get all essential angles (to show missing ones)
      const { data: allEssential } = await supabase
        .from('image_coverage_angles')
        .select('*')
        .eq('is_essential', true)
        .order('priority_order');

      // Merge to show covered + missing
      const coverageMap = new Map<string, CoverageAngle>();
      
      allEssential?.forEach(angle => {
        coverageMap.set(angle.id, {
          ...angle,
          has_image: false,
          image_count: 0
        });
      });

      angles?.forEach((angle: any) => {
        coverageMap.set(angle.id, {
          ...angle,
          has_image: true,
          image_count: angle.vehicle_image_angles?.length || 0
        });
      });

      const coverageArray = Array.from(coverageMap.values());
      setCoverage(coverageArray);

      // Calculate coverage percent
      const covered = coverageArray.filter(a => a.has_image).length;
      const total = coverageArray.length;
      setCoveragePercent(Math.round((covered / total) * 100));

    } catch (error) {
      console.error('Error loading coverage:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '12px', fontSize: '9pt' }}>Loading coverage...</div>;
  }

  // Group by category
  const byCategory = coverage.reduce((acc, angle) => {
    if (!acc[angle.category]) acc[angle.category] = [];
    acc[angle.category].push(angle);
    return acc;
  }, {} as Record<string, CoverageAngle[]>);

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header">
        <h3 style={{ margin: 0, fontSize: '11pt', fontWeight: 700 }}>
          Image Coverage Checklist
        </h3>
        <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>
          Essential angles documented: {coveragePercent}%
        </div>
      </div>
      <div className="card-body">
        {/* Progress bar */}
        <div style={{
          width: '100%',
          height: '8px',
          background: 'var(--background-secondary)',
          borderRadius: '4px',
          marginBottom: '16px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${coveragePercent}%`,
            height: '100%',
            background: coveragePercent >= 80 ? 'var(--color-success)' : 
                       coveragePercent >= 50 ? 'var(--color-warning)' : 
                       'var(--color-danger)',
            transition: 'width 0.3s ease'
          }} />
        </div>

        {/* Category breakdown */}
        {Object.entries(byCategory).map(([category, angles]) => {
          const covered = angles.filter(a => a.has_image).length;
          const total = angles.length;
          const percent = Math.round((covered / total) * 100);

          return (
            <div key={category} style={{ marginBottom: '16px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px'
              }}>
                <div style={{ fontSize: '10pt', fontWeight: 600 }}>
                  {categoryNames[category] || category}
                </div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                  {covered}/{total} ({percent}%)
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {angles.map(angle => (
                  <div
                    key={angle.id}
                    style={{
                      padding: '4px 8px',
                      background: angle.has_image ? 'var(--color-success)' : 'var(--background-secondary)',
                      color: angle.has_image ? '#fff' : 'var(--text-muted)',
                      borderRadius: '2px',
                      fontSize: '8pt',
                      border: angle.has_image ? 'none' : '1px dashed var(--border)'
                    }}
                    title={angle.has_image ? `${angle.image_count} image(s)` : 'Missing'}
                  >
                    {angle.has_image ? '✓' : '○'} {angle.display_name}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Missing angles alert */}
        {coveragePercent < 100 && (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            background: 'rgba(234, 179, 8, 0.1)',
            border: '1px solid var(--color-warning)',
            borderRadius: '4px',
            fontSize: '8pt'
          }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>
              Missing Essential Angles:
            </div>
            <div>
              {coverage.filter(a => !a.has_image).map(a => a.display_name).join(', ')}
            </div>
            <div style={{ marginTop: '8px', fontSize: '7pt', color: 'var(--text-muted)' }}>
              Upload images to fill these gaps and increase documentation quality.
            </div>
          </div>
        )}

        {/* Perspective breakdown (if we have tagged images) */}
        <div style={{
          marginTop: '16px',
          padding: '12px',
          background: 'var(--background-secondary)',
          borderRadius: '4px',
          fontSize: '8pt',
          color: 'var(--text-muted)'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>
            How Coverage Works:
          </div>
          <ul style={{ margin: 0, paddingLeft: '20px' }}>
            <li>Each angle is a blank to fill (just like VIN, engine, etc.)</li>
            <li>Multiple images can fill the same angle (different perspectives/quality)</li>
            <li>Essential angles needed for complete documentation</li>
            <li>AI auto-tags images with angles + perspective type</li>
            <li>Wide angle vs telephoto vs standard all tracked</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ImageCoverageChecklist;

