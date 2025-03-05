
import React from 'react';

export const ConfigInstructions: React.FC = () => {
  return (
    <div className="mt-4">
      <p className="text-sm text-muted-foreground mb-4">
        To use the streaming feature, you need to:
      </p>
      <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>Create a <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noopener noreferrer" className="text-primary underline">Twitch Developer Application</a></li>
        <li>Get your Client ID from the Developer Console</li>
        <li>Add it to your environment variables as VITE_TWITCH_CLIENT_ID</li>
      </ol>
    </div>
  );
};
