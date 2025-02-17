
import React, { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface VideoAnalysisResultsProps {
  jobId: string;
  isStreaming?: boolean;
}

const ITEMS_PER_PAGE = 10;

export const VideoAnalysisResults = ({ jobId, isStreaming }: VideoAnalysisResultsProps) => {
  const [page, setPage] = useState(0);

  const { data: results, isLoading } = useQuery({
    queryKey: ['video-analysis-results', jobId, page],
    queryFn: async () => {
      if (isStreaming) {
        const { data, error } = await supabase
          .from('realtime_video_segments')
          .select('*')
          .eq('job_id', jobId)
          .order('segment_number', { ascending: false })
          .range(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE - 1);

        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from('video_analysis_results')
          .select('*')
          .eq('job_id', jobId)
          .order('timestamp', { ascending: false })
          .range(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE - 1);

        if (error) throw error;
        return data;
      }
    },
    refetchInterval: isStreaming ? 2000 : false,
    placeholderData: (prev) => prev,
    staleTime: 1000, // Data is considered fresh for 1 second
    gcTime: 5 * 60 * 1000 // Garbage collect after 5 minutes (renamed from cacheTime)
  });

  const changePage = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  if (isLoading && !results) {
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
    <div className="space-y-4">
      <ScrollArea className="h-[400px]">
        <div className="space-y-4">
          {results.map((result) => (
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
                      <pre className="text-sm whitespace-pre-wrap overflow-auto max-h-[200px]">
                        {result.segment_data}
                      </pre>
                    ) : (
                      <pre className="text-sm whitespace-pre-wrap overflow-auto max-h-[200px]">
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
      
      <div className="flex justify-between items-center pt-4">
        <Button
          variant="outline"
          onClick={() => changePage(Math.max(0, page - 1))}
          disabled={page === 0}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page + 1}
        </span>
        <Button
          variant="outline"
          onClick={() => changePage(page + 1)}
          disabled={results.length < ITEMS_PER_PAGE}
        >
          Next
        </Button>
      </div>
    </div>
  );
};

