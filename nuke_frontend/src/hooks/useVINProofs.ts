/**
 * Hook to get VIN validation proofs for a vehicle
 * Shows all VIN locations found and their confidence
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface VINProof {
  id: string;
  vin: string;
  validation_source: string;
  source_image_id: string | null;
  image_url?: string;
  confidence_score: number;
  validation_method: string;
  is_verified: boolean;
  condition: string;
  created_at: string;
  notes?: string;
}

interface VINProofSummary {
  vin: string;
  proofCount: number;
  totalConfidence: number;
  sources: string[];
  proofs: VINProof[];
  isHighConfidence: boolean; // 3+ proofs
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
        // Get all VIN validations for this vehicle
        const { data: validations, error } = await supabase
          .from('vin_validations')
          .select(`
            id,
            vin,
            validation_source,
            source_image_id,
            confidence_score,
            validation_method,
            is_verified,
            condition,
            created_at,
            notes
          `)
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: true });

        if (error) throw error;

        if (!validations || validations.length === 0) {
          setSummary(null);
          setLoading(false);
          return;
        }

        // Get image URLs for proofs with images
        const imageIds = validations
          .map(v => v.source_image_id)
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

        // Build summary
        const proofs: VINProof[] = validations.map(v => ({
          ...v,
          image_url: v.source_image_id ? imageUrls.get(v.source_image_id) : undefined
        }));

        // Get unique VIN (should all be the same)
        const vin = validations[0].vin;
        const sources = [...new Set(validations.map(v => v.validation_source))];
        
        // Calculate aggregate confidence
        // Multiple proofs increase confidence
        const avgConfidence = Math.round(
          validations.reduce((sum, v) => sum + (v.confidence_score || 0), 0) / validations.length
        );
        const multiProofBonus = validations.length >= 3 ? 15 : validations.length === 2 ? 8 : 0;
        const totalConfidence = Math.min(avgConfidence + multiProofBonus, 100);

        setSummary({
          vin,
          proofCount: validations.length,
          totalConfidence,
          sources,
          proofs,
          isHighConfidence: validations.length >= 3
        });

      } catch (err) {
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

