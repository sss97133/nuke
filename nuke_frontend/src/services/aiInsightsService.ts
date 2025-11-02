import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../lib/supabase';

export interface ImageInsightRequest {
  batchId: string;
  vehicleId: string | null;
  date: string;
  vehicleName?: string | null;
  userId: string;
  images: Array<{
    id: string;
    url: string;
    takenAt?: string | null;
    description?: string | null;
  }>;
}

export interface ImageInsightResult {
  batchId: string;
  summary: string;
  conditionScore: number | null;
  conditionLabel: string | null;
  estimatedValueUsd: number | null;
  laborHours: number | null;
  confidence: number | null;
  keyFindings: Array<{ title: string; detail: string; severity?: string | null }>;
  recommendations: string[];
}

interface InsightResponse {
  results: ImageInsightResult[];
}

const getFunctionsUrl = () => {
  if (!SUPABASE_URL) {
    throw new Error('Missing VITE_SUPABASE_URL environment variable');
  }
  return `${SUPABASE_URL}/functions/v1/profile-image-analyst`;
};

export const AIInsightsService = {
  async analyzeImageGroups(batches: ImageInsightRequest[]): Promise<ImageInsightResult[]> {
    if (!batches.length) return [];

    const endpoint = getFunctionsUrl();

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY || '',
        Authorization: `Bearer ${SUPABASE_ANON_KEY || ''}`
      },
      body: JSON.stringify({ batches })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI insight request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as InsightResponse;
    return data.results || [];
  }
};

