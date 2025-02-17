
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface VideoAnalysisResultsProps {
  jobId: string;
  isStreaming?: boolean;
}

export const VideoAnalysisResults = ({ jobId, isStreaming }: VideoAnalysisResultsProps) => {
  const { data: results, isLoading } = useQuery({
    queryKey: ['video-analysis-results', jobId],
    queryFn: async () => {
      if (isStreaming) {
        const { data, error } = await supabase
          .from('realtime_video_segments')
          .select('*')
          .eq('job_id', jobId)
          .order('segment_number', { ascending: true });

        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from('video_analysis_results')
          .select('*')
          .eq('job_id', jobId)
          .order('timestamp', { ascending: true });

        if (error) throw error;
        return data;
      }
    },
    refetchInterval: isStreaming ? 1000 : false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!results || results.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">
          {isStreaming ? 'Waiting for analysis results...' : 'No analysis results available'}
        </p>
      </Card>
    );
  }

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-4">
        {results.map((result, index) => (
          <Card key={result.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <Badge variant="outline" className="mb-2">
                  {isStreaming 
                    ? `Segment ${result.segment_number}`
                    : new Date(result.timestamp).toLocaleTimeString()
                }
                </Badge>
                <div className="space-y-2">
                  {isStreaming ? (
                    <pre className="text-sm whitespace-pre-wrap">
                      {result.segment_data}
                    </pre>
                  ) : (
                    <pre className="text-sm whitespace-pre-wrap">
                      {JSON.stringify(result.analysis_data, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
};
