/**
 * LLM Provider Constants (Frontend)
 * Shared constants for LLM providers, models, and analysis tiers
 * This is a frontend-safe version of the edge function llmProvider.ts
 */

export type LLMProvider = 'openai' | 'anthropic' | 'google';
export type AnalysisTier = 'tier1' | 'tier2' | 'tier3' | 'expert';

export interface ModelInfo {
  name: string;
  cost: number;
  speed: 'very_fast' | 'fast' | 'medium' | 'slow';
  quality: 'low' | 'medium' | 'good' | 'excellent';
}

export const PROVIDER_MODELS: Record<LLMProvider, ModelInfo[]> = {
  openai: [
    { name: 'gpt-4o-mini', cost: 0.0001, speed: 'fast', quality: 'good' },
    { name: 'gpt-4o', cost: 0.0025, speed: 'medium', quality: 'excellent' },
    { name: 'gpt-4-turbo', cost: 0.01, speed: 'slow', quality: 'excellent' }
  ],
  anthropic: [
    { name: 'claude-3-haiku-20240307', cost: 0.00008, speed: 'fast', quality: 'good' },
    { name: 'claude-3-5-sonnet-20241022', cost: 0.003, speed: 'medium', quality: 'excellent' },
    { name: 'claude-3-opus-20240229', cost: 0.015, speed: 'slow', quality: 'excellent' }
  ],
  google: [
    { name: 'gemini-1.5-flash', cost: 0, speed: 'very_fast', quality: 'medium' },
    { name: 'gemini-1.5-pro', cost: 0.00035, speed: 'fast', quality: 'good' }
  ]
};

export interface TierConfig {
  provider: LLMProvider;
  model: string;
  description: string;
}

export const TIER_CONFIGS: Record<AnalysisTier, TierConfig> = {
  tier1: {
    provider: 'google',
    model: 'gemini-1.5-flash',
    description: 'Free, fast, basic analysis'
  },
  tier2: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    description: 'Low cost, good quality, fast'
  },
  tier3: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    description: 'High quality, balanced cost/speed'
  },
  expert: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    description: 'Highest quality, comprehensive analysis'
  }
};

