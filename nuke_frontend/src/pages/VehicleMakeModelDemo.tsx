import React, { useState } from 'react';
import AppLayout from '../components/layout/AppLayout';
import VehicleMakeModelInput from '../components/forms/VehicleMakeModelInput';
import type { VehicleDataNormalizationService } from '../services/vehicleDataNormalizationService';

const VehicleMakeModelDemo: React.FC = () => {
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [normalizationResult, setNormalizationResult] = useState<any>(null);

  const testNormalization = () => {
    if (make && model) {
      const result = VehicleDataNormalizationService.normalizeVehicleData(make, model);
      setNormalizationResult(result);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto py-8 px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Vehicle Make/Model Standardization Demo
          </h1>
          <p className="text-gray-600">
            Test the intelligent make/model autocomplete and data normalization system.
          </p>
        </div>

        {/* Demo Section */}
        <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Smart Autocomplete Demo
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            Try typing common abbreviations like "CHEV", "VW", "MERC" to see intelligent suggestions.
          </p>

          <VehicleMakeModelInput
            make={make}
            model={model}
            onMakeChange={setMake}
            onModelChange={setModel}
            required={false}
            className="mb-6"
          />

          <div className="flex gap-4">
            <button
              onClick={testNormalization}
              disabled={!make || !model}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Test Normalization
            </button>
            <button
              onClick={() => {
                setMake('');
                setModel('');
                setNormalizationResult(null);
              }}
              className="bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-md"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Results Section */}
        {normalizationResult && (
          <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Normalization Results
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium text-gray-900 mb-2">Input Data</h3>
                <div className="bg-gray-50 rounded-md p-3 space-y-1">
                  <div className="text-sm">
                    <span className="font-medium">Make:</span> "{normalizationResult.originalMake}"
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Model:</span> "{normalizationResult.originalModel}"
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-medium text-gray-900 mb-2">Normalized Data</h3>
                <div className="bg-green-50 rounded-md p-3 space-y-1">
                  <div className="text-sm">
                    <span className="font-medium">Make:</span> {normalizationResult.normalizedMake || 'N/A'}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Model:</span> {normalizationResult.normalizedModel || 'N/A'}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Confidence:</span> 
                    <span className={`ml-1 px-2 py-1 rounded-full text-xs font-medium ${
                      normalizationResult.confidence === 'high' ? 'bg-green-100 text-green-800' :
                      normalizationResult.confidence === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                      normalizationResult.confidence === 'low' ? 'bg-orange-100 text-orange-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {normalizationResult.confidence.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {normalizationResult.suggestions && normalizationResult.suggestions.length > 0 && (
              <div className="mt-4">
                <h3 className="font-medium text-gray-900 mb-2">Suggestions</h3>
                <div className="space-y-2">
                  {normalizationResult.suggestions.map((suggestion: any, index: number) => (
                    <div key={index} className="bg-blue-50 rounded-md p-3 flex justify-between items-center">
                      <span className="text-sm">
                        {suggestion.make} {suggestion.model}
                      </span>
                      <button
                        onClick={() => {
                          setMake(suggestion.make);
                          setModel(suggestion.model);
                          setNormalizationResult(null);
                        }}
                        className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-md"
                      >
                        Use This
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Examples Section */}
        <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Try These Examples
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            Click any example to test the normalization system:
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { make: 'CHEV', model: 'SUBURBAN' },
              { make: 'VW', model: 'Thing' },
              { make: 'MERC', model: 'SL' },
              { make: 'Chevy', model: 'Corvette' },
              { make: 'FORD', model: 'F-150' },
              { make: 'GMC', model: 'K10' }
            ].map((example, index) => (
              <button
                key={index}
                onClick={() => {
                  setMake(example.make);
                  setModel(example.model);
                  setNormalizationResult(null);
                }}
                className="text-left p-3 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
              >
                <div className="text-sm font-medium text-gray-900">
                  {example.make} {example.model}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Click to test normalization
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default VehicleMakeModelDemo;
