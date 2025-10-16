import React from 'react';
import './design-system.css';

function MinimalApp() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Nuke Frontend</h1>
        <p className="text-lg text-gray-600">Minimal deployment test successful!</p>
        <div className="mt-8">
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
            Build and deployment working correctly
          </div>
        </div>
      </div>
    </div>
  );
}

export default MinimalApp;