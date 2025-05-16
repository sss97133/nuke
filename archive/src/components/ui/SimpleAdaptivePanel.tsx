import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Simple interface for user preferences
interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  spacing: 'compact' | 'normal' | 'spacious';
}

// Default preferences
const defaultPreferences: UserPreferences = {
  theme: 'system',
  fontSize: 1,
  spacing: 'normal'
};

/**
 * A simplified adaptive UI panel that connects to Supabase
 * This is a streamlined version for testing with real data
 */
export function SimpleAdaptivePanel() {
  const [preferences, setPreferences] = useState<UserPreferences>(defaultPreferences);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'error'>('checking');

  // Load preferences from Supabase on mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        // Check Supabase connection
        // const { data: connectionTest, error: connectionError } = await supabase
        //   .from('test_connection')
        //   .select('*')
        //   .limit(1);
        
        // if (connectionError) {
        //   console.error('Supabase connection test failed:', connectionError);
        //   setConnectionStatus('error');
        // } else {
        //   console.log('Supabase connection successful');
        //   setConnectionStatus('connected');
          
          // Try to load user preferences
          const { data, error } = await supabase
            .from('user_preferences')
            .select('*')
            .limit(1);
            
          if (error) {
            console.error('Error loading preferences:', error);
          } else if (data && data.length > 0) {
            console.log('Loaded preferences:', data[0]);
            setPreferences(data[0].preferences || defaultPreferences);
          }
        // }
      } catch (err) {
        console.error('Error in preferences loading:', err);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadPreferences();
  }, []);
  
  // Save preferences to Supabase
  const savePreferences = async (newPrefs: UserPreferences) => {
    try {
      setPreferences(newPrefs);
      
      if (connectionStatus === 'connected') {
        const { error } = await supabase
          .from('user_preferences')
          .upsert([
            { 
              id: 'current_user',
              preferences: newPrefs,
              updated_at: new Date().toISOString()
            }
          ]);
          
        if (error) {
          console.error('Error saving preferences:', error);
        } else {
          console.log('Saved preferences to Supabase');
        }
      }
    } catch (err) {
      console.error('Error in savePreferences:', err);
    }
  };
  
  // Toggle theme
  const toggleTheme = () => {
    const newTheme = preferences.theme === 'light' ? 'dark' : 'light';
    savePreferences({ ...preferences, theme: newTheme });
    
    // Apply theme to document
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
  };
  
  // Change font size
  const changeFontSize = (size: number) => {
    savePreferences({ ...preferences, fontSize: size });
    
    // Apply font size to document
    document.documentElement.style.fontSize = `${size}rem`;
  };
  
  // Change spacing
  const changeSpacing = (spacing: 'compact' | 'normal' | 'spacious') => {
    savePreferences({ ...preferences, spacing });
  };
  
  // Track user interaction with Supabase (simplified)
  const trackInteraction = async (element: string, action: string) => {
    if (connectionStatus === 'connected') {
      try {
        const { error } = await supabase
          .from('user_interactions')
          .insert([
            { 
              element, 
              action, 
              timestamp: new Date().toISOString() 
            }
          ]);
          
        if (error) {
          console.error('Error tracking interaction:', error);
        }
      } catch (err) {
        console.error('Error in trackInteraction:', err);
      }
    }
  };
  
  if (isLoading) {
    return (
      <div className="fixed bottom-4 right-4 p-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
        Loading...
      </div>
    );
  }
  
  if (!isOpen) {
    return (
      <button 
        onClick={() => {
          setIsOpen(true);
          trackInteraction('settings_button', 'click');
        }}
        className="fixed bottom-4 right-4 p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    );
  }
  
  return (
    <div className="fixed bottom-4 right-4 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
      <div className="p-3 bg-blue-500 text-white flex justify-between items-center">
        <h3 className="font-medium">Adaptive UI Settings</h3>
        <button onClick={() => setIsOpen(false)} className="text-white">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
      
      <div className="p-4">
        {connectionStatus === 'error' ? (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            <p className="text-sm">Supabase connection error. Some features may not work.</p>
          </div>
        ) : connectionStatus === 'connected' ? (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-2 rounded mb-4">
            <p className="text-sm">Connected to Supabase</p>
          </div>
        ) : null}
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Theme
            </label>
            <button
              onClick={toggleTheme}
              className="w-full px-4 py-2 bg-blue-100 dark:bg-blue-700 text-blue-800 dark:text-blue-100 rounded"
            >
              {preferences.theme === 'light' ? 'Switch to Dark Theme' : 'Switch to Light Theme'}
            </button>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Font Size: {preferences.fontSize}x
            </label>
            <div className="flex items-center justify-between">
              <button 
                onClick={() => changeFontSize(Math.max(0.8, preferences.fontSize - 0.1))}
                className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded"
              >
                -
              </button>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mx-4">
                <div 
                  className="bg-blue-600 h-2.5 rounded-full" 
                  style={{ width: `${((preferences.fontSize - 0.8) / 0.6) * 100}%` }}
                ></div>
              </div>
              <button 
                onClick={() => changeFontSize(Math.min(1.4, preferences.fontSize + 0.1))}
                className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded"
              >
                +
              </button>
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              UI Density
            </label>
            <select
              value={preferences.spacing}
              onChange={(e) => changeSpacing(e.target.value as any)}
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md"
            >
              <option value="compact">Compact</option>
              <option value="normal">Normal</option>
              <option value="spacious">Spacious</option>
            </select>
          </div>
        </div>
        
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Your preferences are saved automatically and will be applied each time you use the app.
          </p>
        </div>
      </div>
    </div>
  );
}
