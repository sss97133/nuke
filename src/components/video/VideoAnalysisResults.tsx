
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistance } from 'date-fns';

interface VideoAnalysisResult {
  id: string;
  object_type: string | null;
  confidence_score: number | null;
  classification_labels: string[] | null;
  created_at: string;
  normalized_data: any;
  spatial_data: any;
  timestamp_start: string | null;
  timestamp_end: string | null;
}

export const VideoAnalysisResults = ({ jobId }: { jobId: string }) => {
  const { data: results, isLoading, error } = useQuery({
    queryKey: ['video-analysis', jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('video_analysis_results')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as VideoAnalysisResult[];
    }
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-red-500">
        Error loading analysis results: {error.message}
      </div>
    );
  }

  if (!results?.length) {
    return (
      <div className="p-4 text-muted-foreground">
        No analysis results available yet.
      </div>
    );
  }

  return (
    <ScrollArea className="h-[600px] w-full rounded-md border p-4">
      <div className="space-y-4">
        {results.map((result) => (
          <Card key={result.id} className="p-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="font-medium">
                  {result.object_type || 'Unknown Object'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {formatDistance(new Date(result.created_at), new Date(), { addSuffix: true })}
                </p>
              </div>
              {result.confidence_score && (
                <Badge variant={result.confidence_score > 0.7 ? "default" : "secondary"}>
                  {Math.round(result.confidence_score * 100)}% confidence
                </Badge>
              )}
            </div>
            
            {result.classification_labels && result.classification_labels.length > 0 && (
              <div className="mt-2">
                <p className="text-sm font-medium mb-1">Classifications:</p>
                <div className="flex flex-wrap gap-2">
                  {result.classification_labels.map((label, index) => (
                    <Badge key={index} variant="outline">
                      {label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            
            {result.normalized_data && (
              <div className="mt-2">
                <p className="text-sm font-medium mb-1">Normalized Data:</p>
                <pre className="text-xs bg-muted p-2 rounded-md overflow-x-auto">
                  {JSON.stringify(result.normalized_data, null, 2)}
                </pre>
              </div>
            )}
            
            {result.timestamp_start && result.timestamp_end && (
              <div className="mt-2 text-sm text-muted-foreground">
                Time Range: {result.timestamp_start} - {result.timestamp_end}
              </div>
            )}
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
};
