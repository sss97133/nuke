
import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { VideoAnalysisResults } from '@/components/video/VideoAnalysisResults';
import { Badge } from '@/components/ui/badge';

export const VideoAnalysis = () => {
  const { jobId } = useParams();

  const { data: job, isLoading } = useQuery({
    queryKey: ['video-job', jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('video_processing_jobs')
        .select('*, live_streams(*)')
        .eq('id', jobId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!jobId,
  });

  if (!jobId) {
    return <div className="p-4">No job ID provided</div>;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!job) {
    return <div className="p-4">Video processing job not found</div>;
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">
            {job.streaming_analysis ? 'Live Analysis' : 'Video Analysis'} Results
          </h1>
          <Badge variant={
            job.status === 'completed' ? 'default' :
            job.status === 'processing' ? 'secondary' :
            job.status === 'error' ? 'destructive' : 'outline'
          }>
            {job.status}
          </Badge>
        </div>
        {job.streaming_analysis ? (
          <div className="bg-black rounded-lg aspect-video relative">
            {job.live_streams?.stream_url ? (
              <video
                src={job.live_streams.stream_url}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-white">
                Waiting for stream...
              </div>
            )}
          </div>
        ) : (
          job.video_url && (
            <video
              src={job.video_url}
              controls
              className="w-full max-h-[400px] object-contain bg-black rounded-lg"
            />
          )
        )}
      </div>
      
      <VideoAnalysisResults jobId={jobId} isStreaming={job.streaming_analysis} />
    </div>
  );
};
