/**
 * React Hook for VIN Decoding
 * 
 * Provides easy access to VIN decoding functionality in components
 */

import { useState, useCallback } from 'react';
import vinDecoderService, { VINDecodeResult, RecallInfo, VINValidationResult } from '../services/vinDecoder';

export interface UseVINDecoderReturn {
  // State
  decoding: boolean;
  result: VINDecodeResult | null;
  recalls: RecallInfo | null;
  error: string | null;
  
  // Actions
  decodeVIN: (vin: string) => Promise<VINDecodeResult>;
  validateVIN: (vin: string) => VINValidationResult;
  getRecalls: (vin: string) => Promise<RecallInfo>;
  reset: () => void;
  
  // Batch operations
  batchDecode: (vins: string[]) => Promise<VINDecodeResult[]>;
}

export function useVINDecoder(): UseVINDecoderReturn {
  const [decoding, setDecoding] = useState(false);
  const [result, setResult] = useState<VINDecodeResult | null>(null);
  const [recalls, setRecalls] = useState<RecallInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const decodeVIN = useCallback(async (vin: string): Promise<VINDecodeResult> => {
    setDecoding(true);
    setError(null);
    
    try {
      const decoded = await vinDecoderService.decodeVIN(vin);
      setResult(decoded);
      
      if (!decoded.valid) {
        setError(decoded.error_message || 'Invalid VIN');
      }
      
      return decoded;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'VIN decode failed';
      setError(errorMessage);
      throw err;
    } finally {
      setDecoding(false);
    }
  }, []);
  
  const validateVIN = useCallback((vin: string): VINValidationResult => {
    return vinDecoderService.validateVIN(vin);
  }, []);
  
  const getRecalls = useCallback(async (vin: string): Promise<RecallInfo> => {
    setError(null);
    
    try {
      const recallInfo = await vinDecoderService.getRecalls(vin);
      setRecalls(recallInfo);
      return recallInfo;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Recalls fetch failed';
      setError(errorMessage);
      throw err;
    }
  }, []);
  
  const batchDecode = useCallback(async (vins: string[]): Promise<VINDecodeResult[]> => {
    setDecoding(true);
    setError(null);
    
    try {
      const results = await vinDecoderService.batchDecodeVINs(vins);
      return results;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Batch decode failed';
      setError(errorMessage);
      throw err;
    } finally {
      setDecoding(false);
    }
  }, []);
  
  const reset = useCallback(() => {
    setResult(null);
    setRecalls(null);
    setError(null);
    setDecoding(false);
  }, []);
  
  return {
    decoding,
    result,
    recalls,
    error,
    decodeVIN,
    validateVIN,
    getRecalls,
    reset,
    batchDecode
  };
}

export default useVINDecoder;

