
import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { VideoAnalysisResults } from '@/components/video/VideoAnalysisResults';
import { Badge } from '@/components/ui/badge';

interface LiveStream {
  id: string;
  stream_url: string;
}

interface VideoProcessingJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  video_url: string;
  streaming_analysis: boolean;
  live_streams?: LiveStream | null;
}

export const VideoAnalysis = () => {
  const { jobId } = useParams();

  const { data: job, isLoading, error } = useQuery<VideoProcessingJob>({
    queryKey: ['video-job', jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('video_processing_jobs')
        .select('*, live_streams(id, stream_url)')
        .eq('id', jobId)
        .maybeSingle();

      if (error) throw error;
      
      if (!data) throw new Error('Video processing job not found');
      
      // Ensure the response matches our expected type
      const processedData: VideoProcessingJob = {
        id: data.id,
        status: data.status as VideoProcessingJob['status'],
        video_url: data.video_url,
        streaming_analysis: data.streaming_analysis,
        live_streams: data.live_streams as LiveStream
      };
      
      return processedData;
    },
    enabled: !!jobId,
    refetchInterval: (data) => 
      data?.status === 'processing' ? 5000 : false,
    staleTime: 2000,
    gcTime: 10 * 60 * 1000
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

  if (error) {
    return <div className="p-4 text-red-500">Error: {(error as Error).message}</div>;
  }

  if (!job) {
    return <div className="p-4">Video processing job not found</div>;
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">
            {job?.streaming_analysis ? 'Live Analysis' : 'Video Analysis'} Results
          </h1>
          <Badge variant={
            job?.status === 'completed' ? 'default' :
            job?.status === 'processing' ? 'secondary' :
            job?.status === 'error' ? 'destructive' : 'outline'
          }>
            {job?.status}
          </Badge>
        </div>
        {job?.streaming_analysis ? (
          <div className="bg-black rounded-lg aspect-video relative">
            {job.live_streams?.stream_url ? (
              <video
                src={job.live_streams.stream_url}
                controls
                autoPlay
                className="w-full h-full object-contain"
                playsInline
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-white">
                Waiting for stream...
              </div>
            )}
          </div>
        ) : (
          job?.video_url && (
            <video
              src={job.video_url}
              controls
              playsInline
              className="w-full max-h-[400px] object-contain bg-black rounded-lg"
            />
          )
        )}
      </div>
      
      <VideoAnalysisResults jobId={jobId} isStreaming={job?.streaming_analysis} />
    </div>
  );
};
