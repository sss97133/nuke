/**
 * Hook to get VIN validation proofs for a vehicle
 * Shows all VIN locations found and their confidence
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface VINProof {
  id: string;
  vin: string;
  source_type: string;
  source_image_id: string | null;
  image_url?: string;
  confidence_score: number;
  extraction_method?: string | null;
  source_url?: string | null;
  is_conclusive: boolean;
  created_at: string;
  notes?: string | null;
}

interface VINProofSummary {
  vin: string;
  proofCount: number;
  conclusiveProofCount: number;
  totalConfidence: number;
  sources: string[];
  proofs: VINProof[];
  hasConclusiveProof: boolean;
}

export function useVINProofs(vehicleId: string | undefined) {
  const [summary, setSummary] = useState<VINProofSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!vehicleId) {
      setLoading(false);
      return;
    }

    async function loadProofs() {
      try {
        // Canonical VIN proof table: data_validation_sources (vin proofs should always cite a source)
        const { data: sourcesRows, error } = await supabase
          .from('data_validation_sources')
          .select(`
            id,
            vehicle_id,
            data_field,
            data_value,
            source_type,
            source_image_id,
            source_url,
            confidence_score,
            extraction_method,
            verification_notes,
            created_at
          `)
          .eq('vehicle_id', vehicleId)
          .eq('data_field', 'vin')
          .order('confidence_score', { ascending: false })
          .order('created_at', { ascending: false });

        // If the migration hasn't been applied yet, PostgREST returns 404 for missing table.
        // Treat that as "no proofs available" rather than a fatal error.
        if (error) {
          const status = (error as any)?.status;
          const message = String((error as any)?.message || '');
          if (status === 404 || message.includes('404')) {
            setSummary(null);
            setLoading(false);
            return;
          }
          throw error;
        }

        if (!sourcesRows || sourcesRows.length === 0) {
          setSummary(null);
          setLoading(false);
          return;
        }

        // Get image URLs for proofs with images
        const imageIds = sourcesRows
          .map((v: any) => v.source_image_id)
          .filter(Boolean) as string[];
        
        let imageUrls: Map<string, string> = new Map();
        if (imageIds.length > 0) {
          const { data: images } = await supabase
            .from('vehicle_images')
            .select('id, thumbnail_url, medium_url, image_url')
            .in('id', imageIds);
          
          images?.forEach(img => {
            imageUrls.set(img.id, img.thumbnail_url || img.medium_url || img.image_url);
          });
        }

        const isConclusiveSourceType = (t: string) => {
          // Anything that ties the VIN to an actual artifact (photo/doc) counts as conclusive.
          // Manual entry does not.
          const type = (t || '').toLowerCase();
          return (
            type === 'image' ||
            type === 'document' ||
            type === 'title' ||
            type === 'registration' ||
            type === 'spid' ||
            type === 'build_sheet' ||
            type === 'receipt'
          );
        };

        // Build summary
        const proofs: VINProof[] = sourcesRows.map((v: any) => {
          const imageUrl = v.source_image_id ? imageUrls.get(v.source_image_id) : undefined;
          const conclusive = isConclusiveSourceType(v.source_type) && (v.confidence_score ?? 0) >= 80 && (!!imageUrl || !!v.source_url);
          return {
            id: v.id,
            vin: (v.data_value || '').toString(),
            source_type: v.source_type || 'unknown',
            source_image_id: v.source_image_id || null,
            image_url: imageUrl,
            source_url: v.source_url || null,
            confidence_score: Number(v.confidence_score ?? 0),
            extraction_method: v.extraction_method || null,
            is_conclusive: conclusive,
            created_at: v.created_at,
            notes: v.verification_notes || null,
          };
        });

        const vin = proofs.find(p => p.vin)?.vin || '';
        const sources = [...new Set(proofs.map(p => p.source_type))];
        
        // Calculate aggregate confidence
        const avgConfidence = Math.round(
          proofs.reduce((sum, v) => sum + (v.confidence_score || 0), 0) / proofs.length
        );
        const conclusiveProofCount = proofs.filter(p => p.is_conclusive).length;
        const multiProofBonus = conclusiveProofCount >= 2 ? 10 : 0;
        const totalConfidence = Math.min(avgConfidence + multiProofBonus, 100);

        setSummary({
          vin,
          proofCount: proofs.length,
          conclusiveProofCount,
          totalConfidence,
          sources,
          proofs,
          hasConclusiveProof: conclusiveProofCount >= 1
        });

      } catch (err) {
        // Avoid noisy logs if the feature isn't deployed.
        console.error('Error loading VIN proofs:', err);
        setSummary(null);
      } finally {
        setLoading(false);
      }
    }

    loadProofs();
  }, [vehicleId]);

  return { summary, loading };
}

