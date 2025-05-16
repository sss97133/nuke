
import React from 'react';

interface StreamProviderProps {
  children: React.ReactNode;
}

export const StreamProvider: React.FC<StreamProviderProps> = ({ children }) => {
  return (
    <div>
      {children}
    </div>
  );
};
