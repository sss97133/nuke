import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface VehicleMakeModelInputProps {
  make: string;
  model: string;
  onMakeChange: (make: string) => void;
  onModelChange: (model: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  variant?: 'autocomplete' | 'buttons';
}

type EcrMake = {
  ecr_make_slug: string;
  make_name: string;
  make_url?: string | null;
  logo_url: string | null;
  model_count: number | null;
  car_count: number | null;
};

type EcrModel = {
  ecr_make_slug: string;
  ecr_model_slug: string;
  model_name: string;
  variants_count: number | null;
  image_url: string | null;
};

const VehicleMakeModelInput: React.FC<VehicleMakeModelInputProps> = ({
  make,
  model,
  onMakeChange,
  onModelChange,
  disabled = false,
  required = false,
  className = '',
  variant = 'autocomplete'
}) => {
  const [makeQuery, setMakeQuery] = useState(make);
  const [modelQuery, setModelQuery] = useState(model);
  const [allMakes, setAllMakes] = useState<EcrMake[]>([]);
  const [makeSuggestions, setMakeSuggestions] = useState<EcrMake[]>([]);
  const [modelsForMake, setModelsForMake] = useState<EcrModel[]>([]);
  const [modelSuggestions, setModelSuggestions] = useState<EcrModel[]>([]);
  const [showMakeSuggestions, setShowMakeSuggestions] = useState(false);
  const [showModelSuggestions, setShowModelSuggestions] = useState(false);
  const [selectedMake, setSelectedMake] = useState<EcrMake | null>(null);
  const [loadingMakes, setLoadingMakes] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  const makeInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const makeSuggestionsRef = useRef<HTMLDivElement>(null);
  const modelSuggestionsRef = useRef<HTMLDivElement>(null);

  // Button-mode UI state
  const [showAllMakeButtons, setShowAllMakeButtons] = useState(false);
  const [showAllModelButtons, setShowAllModelButtons] = useState(false);
  const [makeButtonsFilter, setMakeButtonsFilter] = useState('');
  const [modelButtonsFilter, setModelButtonsFilter] = useState('');

  // Hover counts cache (vehicles in Nuke) for tooltips
  const [vehicleCountsByMakeSlug, setVehicleCountsByMakeSlug] = useState<Record<string, number | null>>({});
  const [vehicleCountsByModelKey, setVehicleCountsByModelKey] = useState<Record<string, number | null>>({});
  const inFlightCountsRef = useRef<Set<string>>(new Set());

  // Load all ECR makes (includes logo_url) once.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoadingMakes(true);
        const { data, error } = await supabase
          .from('ecr_makes')
          .select('ecr_make_slug, make_name, make_url, logo_url, model_count, car_count')
          .eq('is_active', true)
          .order('make_name', { ascending: true });

        if (cancelled) return;
        if (error) {
          console.error('Failed to load ECR makes:', error);
          setAllMakes([]);
          return;
        }

        setAllMakes((data ?? []) as EcrMake[]);
      } catch (err) {
        console.error('Failed to load ECR makes:', err);
        setAllMakes([]);
      } finally {
        if (!cancelled) setLoadingMakes(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Update internal state when props change
  useEffect(() => {
    setMakeQuery(make);
  }, [make]);

  useEffect(() => {
    setModelQuery(model);
  }, [model]);

  // Sync selectedMake from the provided make value (edit forms / URL-import fills).
  useEffect(() => {
    const makeValue = String(make || '').trim();
    if (!makeValue || allMakes.length === 0) {
      setSelectedMake(null);
      return;
    }

    const exact = allMakes.find(
      (m) => m.make_name.toLowerCase() === makeValue.toLowerCase()
    );
    setSelectedMake(exact ?? null);
  }, [make, allMakes]);

  // Load models for selected make.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!selectedMake) {
        setModelsForMake([]);
        return;
      }

      try {
        setLoadingModels(true);
        const { data, error } = await supabase
          .from('ecr_models')
          .select('ecr_make_slug, ecr_model_slug, model_name, variants_count, image_url')
          .eq('ecr_make_slug', selectedMake.ecr_make_slug)
          .eq('is_active', true)
          .order('model_name', { ascending: true });

        if (cancelled) return;
        if (error) {
          console.error('Failed to load ECR models:', error);
          setModelsForMake([]);
          return;
        }

        setModelsForMake((data ?? []) as EcrModel[]);
      } catch (err) {
        console.error('Failed to load ECR models:', err);
        setModelsForMake([]);
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedMake?.ecr_make_slug]);

  const getMakeSuggestions = (query: string): EcrMake[] => {
    const q = query.trim().toLowerCase();
    if (!q) return allMakes;
    return allMakes.filter((m) => {
      const name = m.make_name.toLowerCase();
      const slug = m.ecr_make_slug.toLowerCase();
      return name.includes(q) || slug.includes(q);
    });
  };

  const getModelSuggestions = (query: string): EcrModel[] => {
    if (!selectedMake) return [];
    const q = query.trim().toLowerCase();
    if (!q) return modelsForMake;
    return modelsForMake.filter((m) => m.model_name.toLowerCase().includes(q));
  };

  // Handle make input changes
  const handleMakeInputChange = (value: string) => {
    setMakeQuery(value);

    // If the user cleared the field, immediately clear upstream make/model too.
    if (!value.trim()) {
      onMakeChange('');
      setSelectedMake(null);
      setModelsForMake([]);
      setModelQuery('');
      onModelChange('');
      setMakeSuggestions(getMakeSuggestions(''));
      setShowMakeSuggestions(true);
      setModelSuggestions([]);
      setShowModelSuggestions(false);
      return;
    }

    // Clear model when make changes
    if (value !== make) {
      setModelQuery('');
      onModelChange('');
      setSelectedMake(null);
      setModelsForMake([]);
      setModelSuggestions([]);
      setShowModelSuggestions(false);
    }

    setMakeSuggestions(getMakeSuggestions(value));
    setShowMakeSuggestions(true);
  };

  // Handle model input changes
  const handleModelInputChange = (value: string) => {
    setModelQuery(value);
    
    if (!selectedMake) {
      setModelSuggestions([]);
      setShowModelSuggestions(false);
      return;
    }

    setModelSuggestions(getModelSuggestions(value));
    setShowModelSuggestions(true);
  };

  // Handle make selection
  const handleMakeSelect = (makeRow: EcrMake) => {
    setMakeQuery(makeRow.make_name);
    onMakeChange(makeRow.make_name);
    setSelectedMake(makeRow);
    setShowMakeSuggestions(false);

    // Clear model on make selection (model list is make-scoped).
    setModelQuery('');
    onModelChange('');
    setModelsForMake([]);
    setModelSuggestions([]);
    setShowModelSuggestions(false);

    // Button-mode: collapse filters/panels to keep UI tidy
    setShowAllModelButtons(false);
    setModelButtonsFilter('');
    setShowAllMakeButtons(false);
    setMakeButtonsFilter('');
    
    // Focus model input
    setTimeout(() => {
      modelInputRef.current?.focus();
    }, 100);

  };

  // Handle model selection
  const handleModelSelect = (selectedModel: EcrModel) => {
    setModelQuery(selectedModel.model_name);
    onModelChange(selectedModel.model_name);
    setShowModelSuggestions(false);

    // Button-mode: collapse list after choosing a model
    setShowAllModelButtons(false);
    setModelButtonsFilter('');
  };

  // Handle make blur - validate and normalize
  const handleMakeBlur = () => {
    setTimeout(() => {
      if (!makeSuggestionsRef.current?.contains(document.activeElement)) {
        setShowMakeSuggestions(false);
        
        const value = makeQuery.trim();
        if (!value) {
          onMakeChange('');
          setSelectedMake(null);
          setModelsForMake([]);
          setModelQuery('');
          onModelChange('');
          return;
        }

        const exact = allMakes.find(
          (m) => m.make_name.toLowerCase() === value.toLowerCase()
        );

        // Canonicalize case if we find an exact match.
        if (exact) {
          if (exact.make_name !== makeQuery) {
            setMakeQuery(exact.make_name);
          }
          onMakeChange(exact.make_name);
          setSelectedMake(exact);
          return;
        }

        // Persist whatever user typed (custom make).
        onMakeChange(value);
      }
    }, 150);
  };

  // Handle model blur - just save what user typed, don't auto-normalize
  const handleModelBlur = () => {
    setTimeout(() => {
      if (!modelSuggestionsRef.current?.contains(document.activeElement)) {
        setShowModelSuggestions(false);
        
        // Just save whatever the user typed.
        if (modelQuery !== model) onModelChange(modelQuery);
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

  const isMakeModelKnown = useMemo(() => {
    const makeValue = makeQuery.trim();
    const modelValue = modelQuery.trim();
    if (!makeValue || !modelValue) return true; // no warning until both are present
    const exactMake = allMakes.find((m) => m.make_name.toLowerCase() === makeValue.toLowerCase());
    if (!exactMake) return false;
    if (!selectedMake || selectedMake.ecr_make_slug !== exactMake.ecr_make_slug) return false;
    return modelsForMake.some((m) => m.model_name.toLowerCase() === modelValue.toLowerCase());
  }, [allMakes, makeQuery, modelQuery, modelsForMake, selectedMake]);

  const ensureVehicleCountForMake = async (makeRow: EcrMake) => {
    const key = `make:${makeRow.ecr_make_slug}`;
    if (Object.prototype.hasOwnProperty.call(vehicleCountsByMakeSlug, makeRow.ecr_make_slug)) return;
    if (inFlightCountsRef.current.has(key)) return;
    inFlightCountsRef.current.add(key);

    try {
      const { data, error } = await supabase.rpc('get_total_vehicle_count', {
        make_prefix: makeRow.make_name,
        model_contains: null
      });

      if (error) {
        console.warn('Failed to load vehicle count for make:', makeRow.make_name, error);
        setVehicleCountsByMakeSlug((prev) => ({ ...prev, [makeRow.ecr_make_slug]: null }));
        return;
      }

      const n = data == null ? 0 : Number(data);
      setVehicleCountsByMakeSlug((prev) => ({ ...prev, [makeRow.ecr_make_slug]: Number.isFinite(n) ? n : 0 }));
    } catch (err) {
      console.warn('Failed to load vehicle count for make:', makeRow.make_name, err);
      setVehicleCountsByMakeSlug((prev) => ({ ...prev, [makeRow.ecr_make_slug]: null }));
    } finally {
      inFlightCountsRef.current.delete(key);
    }
  };

  const ensureVehicleCountForModel = async (modelRow: EcrModel) => {
    // Model counts are scoped to selected make to avoid ambiguous models like "GT".
    if (!selectedMake) return;
    const modelKey = `${selectedMake.ecr_make_slug}:${modelRow.ecr_model_slug}`;
    const key = `model:${modelKey}`;
    if (Object.prototype.hasOwnProperty.call(vehicleCountsByModelKey, modelKey)) return;
    if (inFlightCountsRef.current.has(key)) return;
    inFlightCountsRef.current.add(key);

    try {
      const { data, error } = await supabase.rpc('get_total_vehicle_count', {
        make_prefix: selectedMake.make_name,
        model_contains: modelRow.model_name
      });

      if (error) {
        console.warn('Failed to load vehicle count for model:', modelRow.model_name, error);
        setVehicleCountsByModelKey((prev) => ({ ...prev, [modelKey]: null }));
        return;
      }

      const n = data == null ? 0 : Number(data);
      setVehicleCountsByModelKey((prev) => ({ ...prev, [modelKey]: Number.isFinite(n) ? n : 0 }));
    } catch (err) {
      console.warn('Failed to load vehicle count for model:', modelRow.model_name, err);
      setVehicleCountsByModelKey((prev) => ({ ...prev, [modelKey]: null }));
    } finally {
      inFlightCountsRef.current.delete(key);
    }
  };

  const makeButtons = useMemo(() => {
    const q = makeButtonsFilter.trim().toLowerCase();
    const base = [...allMakes].sort((a, b) => {
      const ac = a.car_count ?? 0;
      const bc = b.car_count ?? 0;
      if (bc !== ac) return bc - ac;
      return a.make_name.localeCompare(b.make_name);
    });

    const shouldShowAll = showAllMakeButtons || Boolean(q);
    const limited = shouldShowAll ? base : base.slice(0, 14);
    if (!q) return limited;
    return limited.filter((m) => {
      const name = m.make_name.toLowerCase();
      const slug = m.ecr_make_slug.toLowerCase();
      return name.includes(q) || slug.includes(q);
    });
  }, [allMakes, makeButtonsFilter, showAllMakeButtons]);

  const modelButtons = useMemo(() => {
    const q = modelButtonsFilter.trim().toLowerCase();
    const shouldShowAll = showAllModelButtons || Boolean(q);
    const base = shouldShowAll ? modelsForMake : modelsForMake.slice(0, 18);
    if (!q) return base;
    return base.filter((m) => {
      const name = m.model_name.toLowerCase();
      const slug = m.ecr_model_slug.toLowerCase();
      return name.includes(q) || slug.includes(q);
    });
  }, [modelsForMake, modelButtonsFilter, showAllModelButtons]);

  if (variant === 'buttons') {
    return (
      <div className={`space-y-4 ${className}`}>
        {/* Make Buttons */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Make {required && <span className="text-red-500">*</span>}
          </label>

          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              value={makeButtonsFilter}
              onChange={(e) => setMakeButtonsFilter(e.target.value)}
              placeholder={loadingMakes ? 'Loading makes…' : 'Filter makes…'}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              disabled={disabled || loadingMakes}
            />

            <button
              type="button"
              onClick={() => setShowAllMakeButtons((v) => !v)}
              disabled={disabled || loadingMakes}
              className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
              title={showAllMakeButtons ? 'Collapse' : 'Show all makes'}
            >
              {showAllMakeButtons ? '–' : '+'}
            </button>
          </div>

          <div className={`flex flex-wrap gap-2 ${showAllMakeButtons ? 'max-h-56 overflow-auto pr-1' : ''}`}>
            {makeButtons.map((m) => {
              const isSelected = selectedMake?.ecr_make_slug === m.ecr_make_slug;
              const countKnown = Object.prototype.hasOwnProperty.call(vehicleCountsByMakeSlug, m.ecr_make_slug);
              const count = vehicleCountsByMakeSlug[m.ecr_make_slug];
              const tooltip =
                !countKnown ? 'Loading vehicle count…' : count == null ? 'Vehicles: —' : `${count.toLocaleString()} vehicles`;

              return (
                <button
                  key={m.ecr_make_slug}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleMakeSelect(m)}
                  onMouseEnter={() => ensureVehicleCountForMake(m)}
                  className={`group relative flex items-center gap-2 rounded-full border px-3 py-2 text-sm shadow-sm transition-colors ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
                  } disabled:bg-gray-100 disabled:text-gray-400`}
                >
                  {m.logo_url ? (
                    <img
                      src={m.logo_url}
                      alt=""
                      className="h-5 w-5 object-contain"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-5 w-5 rounded bg-gray-100 border border-gray-200" />
                  )}
                  <span className="max-w-[11rem] truncate">{m.make_name}</span>

                  {/* Hover tooltip */}
                  <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[10px] text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                    {tooltip}
                  </span>
                </button>
              );
            })}

            {makeButtons.length === 0 && (
              <div className="text-xs text-gray-500">
                {loadingMakes ? 'Loading makes…' : 'No makes found.'}
              </div>
            )}
          </div>
        </div>

        {/* Model Buttons */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Model {required && <span className="text-red-500">*</span>}
          </label>

          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              value={modelButtonsFilter}
              onChange={(e) => setModelButtonsFilter(e.target.value)}
              placeholder={
                !selectedMake
                  ? 'Select make first…'
                  : loadingModels
                    ? 'Loading models…'
                    : `Filter ${selectedMake.make_name} models…`
              }
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              disabled={disabled || loadingModels || !selectedMake}
            />

            <button
              type="button"
              onClick={() => setShowAllModelButtons((v) => !v)}
              disabled={disabled || loadingModels || !selectedMake}
              className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
              title={!selectedMake ? 'Select make first' : showAllModelButtons ? 'Collapse' : 'Show all models'}
            >
              {showAllModelButtons ? '–' : '+'}
            </button>
          </div>

          {!selectedMake ? (
            <div className="text-xs text-gray-500">Model buttons unlock once a make is selected.</div>
          ) : (
            <div className={`flex flex-wrap gap-2 ${showAllModelButtons ? 'max-h-56 overflow-auto pr-1' : ''}`}>
              {modelButtons.map((m) => {
                const isSelected = modelQuery.trim().toLowerCase() === m.model_name.trim().toLowerCase();
                const key = `${selectedMake.ecr_make_slug}:${m.ecr_model_slug}`;
                const countKnown = Object.prototype.hasOwnProperty.call(vehicleCountsByModelKey, key);
                const count = vehicleCountsByModelKey[key];
                const tooltip =
                  !countKnown ? 'Loading vehicle count…' : count == null ? 'Vehicles: —' : `${count.toLocaleString()} vehicles`;

                return (
                  <button
                    key={`${m.ecr_make_slug}:${m.ecr_model_slug}`}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleModelSelect(m)}
                    onMouseEnter={() => ensureVehicleCountForModel(m)}
                    className={`group relative rounded-full border px-3 py-2 text-sm shadow-sm transition-colors ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
                    } disabled:bg-gray-100 disabled:text-gray-400`}
                  >
                    <span className="max-w-[12rem] truncate">{m.model_name}</span>

                    {/* Hover tooltip */}
                    <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[10px] text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                      {tooltip}
                    </span>
                  </button>
                );
              })}

              {modelButtons.length === 0 && (
                <div className="text-xs text-gray-500">
                  {loadingModels ? 'Loading models…' : 'No models found for this make.'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Validation Status - Only show warning, not success */}
        {makeQuery && modelQuery && !isMakeModelKnown && (
          <div className="mt-1">
            <div className="text-xs text-amber-600 flex items-center">
              <svg className="w-3 h-3 mr-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Custom entry (not in database)</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-2 gap-4 ${className}`}>
      {/* Make Input */}
      <div className="relative">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Make {required && <span className="text-red-500">*</span>}
        </label>
        <div className="relative">
          {selectedMake?.logo_url && (
            <img
              src={selectedMake.logo_url}
              alt={`${selectedMake.make_name} logo`}
              className="absolute left-2 top-1/2 -translate-y-1/2 h-5 w-5 object-contain"
              loading="lazy"
            />
          )}
          <input
            ref={makeInputRef}
            type="text"
            value={makeQuery}
            onChange={(e) => handleMakeInputChange(e.target.value)}
            onFocus={() => {
              if (disabled) return;
              setMakeSuggestions(getMakeSuggestions(makeQuery));
              setShowMakeSuggestions(true);
            }}
            onBlur={handleMakeBlur}
            onKeyDown={(e) => handleKeyDown(e, 'make')}
            disabled={disabled}
            required={required}
            placeholder="e.g., Chevrolet, Ford, Toyota"
            className={`block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm ${selectedMake?.logo_url ? 'pl-9' : ''}`}
          />
          
          {/* Make Suggestions Dropdown */}
          {showMakeSuggestions && makeSuggestions.length > 0 && (
            <div
              ref={makeSuggestionsRef}
              className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto"
            >
              {makeSuggestions.map((make) => (
                <button
                  key={make.ecr_make_slug}
                  type="button"
                  onClick={() => handleMakeSelect(make)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none border-b border-gray-100 last:border-b-0"
                >
                  <div className="flex items-center gap-3">
                    {make.logo_url ? (
                      <img
                        src={make.logo_url}
                        alt={`${make.make_name} logo`}
                        className="h-6 w-6 object-contain flex-shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-6 w-6 bg-gray-100 border border-gray-200 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{make.make_name}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {make.model_count != null ? `${make.model_count.toLocaleString()} models` : 'Models: —'}
                        {make.car_count != null ? ` • ${make.car_count.toLocaleString()} cars` : ''}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {showMakeSuggestions && makeSuggestions.length === 0 && (
            <div className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg p-3 text-xs text-gray-500">
              {loadingMakes ? 'Loading makes…' : 'No makes found.'}
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
            onFocus={() => {
              if (disabled) return;
              if (!selectedMake) return;
              setModelSuggestions(getModelSuggestions(modelQuery));
              setShowModelSuggestions(true);
            }}
            onBlur={handleModelBlur}
            onKeyDown={(e) => handleKeyDown(e, 'model')}
            disabled={disabled || !makeQuery.trim()}
            required={required}
            placeholder={selectedMake ? "e.g., Suburban, Corvette, F-150" : "Select make (or type one) first"}
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
                  key={`${model.ecr_make_slug}:${model.ecr_model_slug}`}
                  type="button"
                  onClick={() => handleModelSelect(model)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none border-b border-gray-100 last:border-b-0"
                >
                  <div className="flex items-center gap-3">
                    {model.image_url ? (
                      <img
                        src={model.image_url}
                        alt=""
                        className="h-8 w-10 object-cover border border-gray-200 flex-shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-8 w-10 bg-gray-100 border border-gray-200 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{model.model_name}</div>
                      {model.variants_count != null && (
                        <div className="text-xs text-gray-500 truncate">
                          {model.variants_count.toLocaleString()} variant{model.variants_count === 1 ? '' : 's'}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {showModelSuggestions && modelSuggestions.length === 0 && selectedMake && (
            <div className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg p-3 text-xs text-gray-500">
              {loadingModels ? 'Loading models…' : 'No models found for this make.'}
            </div>
          )}
        </div>
      </div>

      {/* Validation Status - Only show warning, not success */}
      {makeQuery && modelQuery && !isMakeModelKnown && (
        <div className="col-span-2 mt-1">
          <div className="text-xs text-amber-600 flex items-center">
            <svg className="w-3 h-3 mr-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>Custom entry (not in database)</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default VehicleMakeModelInput;
