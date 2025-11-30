import React, { createContext, useContext, ReactNode } from 'react';

interface AppLayoutContextValue {
  isInsideAppLayout: boolean;
}

const AppLayoutContext = createContext<AppLayoutContextValue>({
  isInsideAppLayout: false,
});

export const AppLayoutProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <AppLayoutContext.Provider value={{ isInsideAppLayout: true }}>
      {children}
    </AppLayoutContext.Provider>
  );
};

export const useAppLayoutContext = () => useContext(AppLayoutContext);

/**
 * Hook to check if we're already inside an AppLayout
 * Returns true if already wrapped, false otherwise
 * 
 * CRITICAL: If already wrapped, this prevents duplicate headers/footers in production
 */
export const usePreventDoubleLayout = () => {
  const { isInsideAppLayout } = useAppLayoutContext();
  
  if (isInsideAppLayout) {
    // Only log in development - in production, silently prevent duplicates
    if (process.env.NODE_ENV === 'development') {
      const errorMsg = 
        '🚨 DOUBLE APPLAYOUT DETECTED!\n\n' +
        'AppLayout is already provided at the route level in App.tsx.\n' +
        'Pages should NOT wrap themselves in AppLayout.\n\n' +
        'Fix: Remove the AppLayout wrapper from your page component.\n' +
        'Just return your content directly.\n\n' +
        'Example:\n' +
        '  // ❌ WRONG:\n' +
        '  return <AppLayout><div>Content</div></AppLayout>;\n\n' +
        '  // ✅ CORRECT:\n' +
        '  return <div>Content</div>;';
      
      console.error('⚠️', errorMsg);
    }
    // Return true so AppLayoutInner can return null and prevent duplicate rendering
  }
  
  return isInsideAppLayout;
};

