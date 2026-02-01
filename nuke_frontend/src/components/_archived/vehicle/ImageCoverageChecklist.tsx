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
      // Get ALL images for this vehicle
      const { data: allImages, error: imagesError } = await supabase
        .from('vehicle_images')
        .select('id')
        .eq('vehicle_id', vehicleId);

      if (imagesError) throw imagesError;
      const totalImages = allImages?.length || 0;

      // Get ALL labeled images with their angles (not just essential)
      const { data: labeledImages, error: labeledError } = await supabase
        .from('vehicle_image_angles')
        .select(`
          image_id,
          angle_id,
          image_coverage_angles (
            id,
            category,
            angle_name,
            display_name,
            is_essential
          )
        `)
        .eq('vehicle_id', vehicleId);

      if (labeledError) throw labeledError;

      // Count images per angle
      const angleCounts = new Map<string, { angle: any; count: number }>();
      
      labeledImages?.forEach((link: any) => {
        const angle = link.image_coverage_angles;
        if (angle) {
          const key = angle.id;
          if (!angleCounts.has(key)) {
            angleCounts.set(key, { angle, count: 0 });
          }
          angleCounts.get(key)!.count++;
        }
      });

      // Convert to array and sort by count (most images first)
      const coverageArray = Array.from(angleCounts.values())
        .map(({ angle, count }) => ({
          id: angle.id,
          category: angle.category,
          angle_name: angle.angle_name,
          display_name: angle.display_name || angle.angle_name,
          is_essential: angle.is_essential,
          has_image: true,
          image_count: count
        }))
        .sort((a, b) => b.image_count - a.image_count);

      setCoverage(coverageArray);

      // Calculate labeled percentage
      const labeledCount = labeledImages?.length || 0;
      const labeledPercent = totalImages > 0 ? Math.round((labeledCount / totalImages) * 100) : 0;
      setCoveragePercent(labeledPercent);

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
          Image Coverage Analysis
        </h3>
        <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>
          {coverage.length > 0 ? `${coverage.reduce((sum, a) => sum + a.image_count, 0)} images labeled` : 'No images labeled yet'}
        </div>
      </div>
      <div className="card-body">
        {/* Category breakdown - show actual image counts */}
        {Object.entries(byCategory).map(([category, angles]) => {
          const totalImagesInCategory = angles.reduce((sum, a) => sum + a.image_count, 0);
          const uniqueAngles = angles.length;

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
                  {totalImagesInCategory} images across {uniqueAngles} {uniqueAngles === 1 ? 'angle' : 'angles'}
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {angles.map(angle => (
                  <div
                    key={angle.id}
                    style={{
                      padding: '4px 8px',
                      background: 'var(--color-success)',
                      color: '#fff',
                      borderRadius: '2px',
                      fontSize: '8pt',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    title={`${angle.image_count} ${angle.image_count === 1 ? 'image' : 'images'} labeled as ${angle.display_name}`}
                  >
                    <span>{angle.image_count}</span>
                    <span>{angle.display_name}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Info about labeling */}
        {coverage.length === 0 ? (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            background: 'rgba(234, 179, 8, 0.1)',
            border: '1px solid var(--color-warning)',
            borderRadius: '4px',
            fontSize: '8pt'
          }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>
              No images labeled yet
            </div>
            <div style={{ marginTop: '4px', fontSize: '7pt', color: 'var(--text-muted)' }}>
              Run the image labeling script to categorize all images with specific angles (taillight_driver, brake_caliper, etc.)
            </div>
          </div>
        ) : (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            background: 'var(--background-secondary)',
            borderRadius: '4px',
            fontSize: '8pt',
            color: 'var(--text-muted)'
          }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>
              Labeling System:
            </div>
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              <li>Every image is labeled with specific angles (taillight_driver, brake_caliper, etc.)</li>
              <li>Multiple images can share the same angle label</li>
              <li>Granular labels help find specific parts quickly</li>
              <li>AI automatically detects and labels visible parts in each image</li>
              <li>As you import thousands of images, all will be properly categorized</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageCoverageChecklist;

