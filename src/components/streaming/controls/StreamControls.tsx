
import React from 'react';
import { useStreamControl } from './hooks/useStreamControl';
import { StreamControlButtons } from './components/StreamControlButtons';
import { StreamShareButton } from './components/StreamShareButton';

export const StreamControls = () => {
  const {
    isLive,
    isLoading,
    username,
    handleStartStream,
    handleStopStream
  } = useStreamControl();

  return (
    <div className="flex space-x-2">
      <StreamControlButtons 
        isLive={isLive}
        isLoading={isLoading}
        onStartStream={handleStartStream}
        onStopStream={handleStopStream}
      />
      
      <StreamShareButton username={username} />
    </div>
  );
};
