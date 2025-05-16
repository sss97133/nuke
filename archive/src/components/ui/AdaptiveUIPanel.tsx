import React, { useState } from 'react';
import { useAdaptiveUI } from '@/hooks/useAdaptiveUI';

/**
 * Adaptive UI Panel
 * 
 * This component provides a UI for users to customize their experience 
 * and view AI-driven recommendations based on their behavior.
 */
export function AdaptiveUIPanel() {
  const {
    preferences,
    isLoading,
    hasRecommendations,
    setTheme,
    setDensity,
    setAccentColor,
    setFontScale,
    toggleAnimations,
    applyRecommendations
  } = useAdaptiveUI();
  
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'preferences' | 'recommendations'>('preferences');
  
  if (isLoading) {
    return <div className="fixed bottom-4 right-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg shadow-lg">
      Loading UI preferences...
    </div>;
  }
  
  // Handle recommendation notification
  if (!isOpen && hasRecommendations) {
    return (
      <div className="fixed bottom-4 right-4 p-4 bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100 rounded-lg shadow-lg animate-pulse">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <span>AI has UI suggestions for you</span>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button 
            onClick={() => { setIsOpen(true); setActiveTab('recommendations'); }}
            className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded"
          >
            View
          </button>
          <button 
            onClick={() => applyRecommendations()}
            className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-sm rounded"
          >
            Apply
          </button>
        </div>
      </div>
    );
  }
  
  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 p-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-full shadow-lg"
        aria-label="Open UI settings"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    );
  }
  
  return (
    <div className="fixed bottom-4 right-4 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden transition-all duration-300">
      <div className="p-4 bg-gray-100 dark:bg-gray-700 flex justify-between items-center">
        <h3 className="font-medium">Adaptive UI Settings</h3>
        <button 
          onClick={() => setIsOpen(false)}
          className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
      
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          className={`flex-1 py-2 text-sm font-medium ${
            activeTab === 'preferences' 
              ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400' 
              : 'text-gray-500 dark:text-gray-400'
          }`}
          onClick={() => setActiveTab('preferences')}
        >
          Preferences
        </button>
        <button
          className={`flex-1 py-2 text-sm font-medium ${
            activeTab === 'recommendations' 
              ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400' 
              : 'text-gray-500 dark:text-gray-400'
          } ${hasRecommendations ? 'relative' : ''}`}
          onClick={() => setActiveTab('recommendations')}
        >
          AI Recommendations
          {hasRecommendations && (
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-500"></span>
          )}
        </button>
      </div>
      
      <div className="p-4 max-h-80 overflow-y-auto">
        {activeTab === 'preferences' ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Theme
              </label>
              <select
                value={preferences.theme}
                onChange={(e) => setTheme(e.target.value as any)}
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm"
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Density
              </label>
              <select
                value={preferences.density}
                onChange={(e) => setDensity(e.target.value as any)}
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm"
              >
                <option value="compact">Compact</option>
                <option value="comfortable">Comfortable</option>
                <option value="spacious">Spacious</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Accent Color
              </label>
              <input
                type="color"
                value={preferences.colorAccent || '#2563eb'}
                onChange={(e) => setAccentColor(e.target.value)}
                className="w-full h-10 rounded cursor-pointer"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Font Size: {preferences.fontScale || 1}x
              </label>
              <input
                type="range"
                min="0.8"
                max="1.4"
                step="0.05"
                value={preferences.fontScale || 1}
                onChange={(e) => setFontScale(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Animations
              </label>
              <button
                onClick={toggleAnimations}
                className={`relative inline-flex h-6 w-11 items-center rounded-full ${
                  preferences.animations ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`${
                    preferences.animations ? 'translate-x-6' : 'translate-x-1'
                  } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                />
              </button>
            </div>
          </div>
        ) : (
          <div>
            {hasRecommendations ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Based on your usage patterns, we recommend the following UI adjustments:
                </p>
                
                <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-md">
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span>Optimize layout for your most used features</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span>Adjust color scheme for better usability</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span>Customize button placement for your workflow</span>
                    </li>
                  </ul>
                </div>
                
                <button
                  onClick={applyRecommendations}
                  className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium"
                >
                  Apply Recommendations
                </button>
              </div>
            ) : (
              <div className="text-center py-6">
                <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <p className="mt-2 text-gray-600 dark:text-gray-400">
                  No recommendations yet. Keep using the app and we'll learn your preferences.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
