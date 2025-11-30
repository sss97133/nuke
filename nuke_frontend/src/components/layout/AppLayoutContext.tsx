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
 * Logs error/warning but doesn't throw to prevent breaking the app
 */
export const usePreventDoubleLayout = () => {
  const { isInsideAppLayout } = useAppLayoutContext();
  
  if (isInsideAppLayout) {
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
    // Don't throw - instead return true so the component can handle it
  }
  
  return isInsideAppLayout;
};

