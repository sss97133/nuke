import React, { useState, useEffect, useRef } from 'react';
import VehicleMakeModelService from '../../services/vehicleMakeModelService';
import type { VehicleMake, VehicleModel } from '../../services/vehicleMakeModelService';

interface VehicleMakeModelInputProps {
  make: string;
  model: string;
  onMakeChange: (make: string) => void;
  onModelChange: (model: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

const VehicleMakeModelInput: React.FC<VehicleMakeModelInputProps> = ({
  make,
  model,
  onMakeChange,
  onModelChange,
  disabled = false,
  required = false,
  className = ''
}) => {
  const [makeQuery, setMakeQuery] = useState(make);
  const [modelQuery, setModelQuery] = useState(model);
  const [makeSuggestions, setMakeSuggestions] = useState<VehicleMake[]>([]);
  const [modelSuggestions, setModelSuggestions] = useState<VehicleModel[]>([]);
  const [showMakeSuggestions, setShowMakeSuggestions] = useState(false);
  const [showModelSuggestions, setShowModelSuggestions] = useState(false);
  const [selectedMake, setSelectedMake] = useState<VehicleMake | null>(null);

  const makeInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const makeSuggestionsRef = useRef<HTMLDivElement>(null);
  const modelSuggestionsRef = useRef<HTMLDivElement>(null);

  // Update internal state when props change
  useEffect(() => {
    setMakeQuery(make);
  }, [make]);

  useEffect(() => {
    setModelQuery(model);
  }, [model]);

  // Handle make input changes
  const handleMakeInputChange = (value: string) => {
    setMakeQuery(value);
    
    if (value.length >= 1) {
      const suggestions = VehicleMakeModelService.searchMakes(value, 8);
      setMakeSuggestions(suggestions);
      setShowMakeSuggestions(true);
    } else {
      setMakeSuggestions([]);
      setShowMakeSuggestions(false);
    }

    // Clear model when make changes
    if (value !== make) {
      setModelQuery('');
      onModelChange('');
      setSelectedMake(null);
      setModelSuggestions([]);
      setShowModelSuggestions(false);
    }
  };

  // Handle model input changes
  const handleModelInputChange = (value: string) => {
    setModelQuery(value);
    
    if (selectedMake && value.length >= 1) {
      const suggestions = VehicleMakeModelService.searchModels(selectedMake.id, value, 8);
      setModelSuggestions(suggestions);
      setShowModelSuggestions(true);
    } else {
      setModelSuggestions([]);
      setShowModelSuggestions(false);
    }
  };

  // Handle make selection
  const handleMakeSelect = (selectedMake: VehicleMake) => {
    setMakeQuery(selectedMake.name);
    setSelectedMake(selectedMake);
    onMakeChange(selectedMake.name);
    setShowMakeSuggestions(false);
    
    // Focus model input
    setTimeout(() => {
      modelInputRef.current?.focus();
    }, 100);

    // Load models for selected make
    const models = VehicleMakeModelService.getModelsForMake(selectedMake.id);
    if (models.length > 0) {
      setModelSuggestions(models.slice(0, 8));
    }
  };

  // Handle model selection
  const handleModelSelect = (selectedModel: VehicleModel) => {
    setModelQuery(selectedModel.name);
    onModelChange(selectedModel.name);
    setShowModelSuggestions(false);
  };

  // Handle make blur - validate and normalize
  const handleMakeBlur = () => {
    setTimeout(() => {
      if (!makeSuggestionsRef.current?.contains(document.activeElement)) {
        setShowMakeSuggestions(false);
        
        // Attempt to normalize the input
        const normalized = VehicleMakeModelService.normalizeMake(makeQuery);
        if (normalized && normalized !== makeQuery) {
          setMakeQuery(normalized);
          onMakeChange(normalized);
          
          // Find the make object
          const makeObj = VehicleMakeModelService.getAllMakes().find(m => m.name === normalized);
          if (makeObj) {
            setSelectedMake(makeObj);
          }
        } else if (normalized) {
          onMakeChange(makeQuery);
          const makeObj = VehicleMakeModelService.getAllMakes().find(m => m.name === normalized);
          if (makeObj) {
            setSelectedMake(makeObj);
          }
        }
      }
    }, 150);
  };

  // Handle model blur - validate and normalize
  const handleModelBlur = () => {
    setTimeout(() => {
      if (!modelSuggestionsRef.current?.contains(document.activeElement)) {
        setShowModelSuggestions(false);
        
        // Attempt to normalize the input
        if (selectedMake) {
          const normalized = VehicleMakeModelService.normalizeModel(selectedMake.id, modelQuery);
          if (normalized && normalized !== modelQuery) {
            setModelQuery(normalized);
            onModelChange(normalized);
          } else if (normalized) {
            onModelChange(modelQuery);
          }
        }
      }
    }, 150);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent, type: 'make' | 'model') => {
    if (type === 'make' && showMakeSuggestions && makeSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        // Focus first suggestion
      } else if (e.key === 'Escape') {
        setShowMakeSuggestions(false);
      } else if (e.key === 'Tab') {
        setShowMakeSuggestions(false);
      }
    } else if (type === 'model' && showModelSuggestions && modelSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        // Focus first suggestion
      } else if (e.key === 'Escape') {
        setShowModelSuggestions(false);
      } else if (e.key === 'Tab') {
        setShowModelSuggestions(false);
      }
    }
  };

  return (
    <div className={`grid grid-cols-2 gap-4 ${className}`}>
      {/* Make Input */}
      <div className="relative">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Make {required && <span className="text-red-500">*</span>}
        </label>
        <div className="relative">
          <input
            ref={makeInputRef}
            type="text"
            value={makeQuery}
            onChange={(e) => handleMakeInputChange(e.target.value)}
            onBlur={handleMakeBlur}
            onKeyDown={(e) => handleKeyDown(e, 'make')}
            disabled={disabled}
            required={required}
            placeholder="e.g., Chevrolet, Ford, Toyota"
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          />
          
          {/* Make Suggestions Dropdown */}
          {showMakeSuggestions && makeSuggestions.length > 0 && (
            <div
              ref={makeSuggestionsRef}
              className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto"
            >
              {makeSuggestions.map((make) => (
                <button
                  key={make.id}
                  type="button"
                  onClick={() => handleMakeSelect(make)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none border-b border-gray-100 last:border-b-0"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">{make.name}</span>
                    <span className="text-xs text-gray-500">{make.country}</span>
                  </div>
                  {make.aliases.length > 0 && (
                    <div className="text-xs text-gray-500 mt-1">
                      Also: {make.aliases.join(', ')}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Model Input */}
      <div className="relative">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Model {required && <span className="text-red-500">*</span>}
        </label>
        <div className="relative">
          <input
            ref={modelInputRef}
            type="text"
            value={modelQuery}
            onChange={(e) => handleModelInputChange(e.target.value)}
            onBlur={handleModelBlur}
            onKeyDown={(e) => handleKeyDown(e, 'model')}
            disabled={disabled || !selectedMake}
            required={required}
            placeholder={selectedMake ? "e.g., Suburban, Corvette, F-150" : "Select make first"}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm disabled:bg-gray-100 disabled:text-gray-500"
          />
          
          {/* Model Suggestions Dropdown */}
          {showModelSuggestions && modelSuggestions.length > 0 && (
            <div
              ref={modelSuggestionsRef}
              className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto"
            >
              {modelSuggestions.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => handleModelSelect(model)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none border-b border-gray-100 last:border-b-0"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">{model.name}</span>
                    <span className="text-xs text-gray-500">
                      {model.years.start}{model.years.end ? `-${model.years.end}` : '+'}
                    </span>
                  </div>
                  {model.aliases.length > 0 && (
                    <div className="text-xs text-gray-500 mt-1">
                      Also: {model.aliases.join(', ')}
                    </div>
                  )}
                  <div className="text-xs text-gray-400 mt-1">
                    {model.body_styles.join(', ')}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Validation Status */}
      {makeQuery && modelQuery && (
        <div className="col-span-2">
          {VehicleMakeModelService.validateMakeModel(makeQuery, modelQuery) ? (
            <div className="text-sm text-green-600 flex items-center">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Valid make/model combination
            </div>
          ) : (
            <div className="text-sm text-amber-600 flex items-center">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              Unrecognized make/model - will be added as custom entry
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VehicleMakeModelInput;
