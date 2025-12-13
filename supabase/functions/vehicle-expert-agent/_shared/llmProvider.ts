/**
 * Unified LLM Provider System
 * Supports OpenAI, Anthropic, and Google Gemini
 * Allows user selection and automatic fallback
 */

export type LLMProvider = 'openai' | 'anthropic' | 'google';
export type AnalysisTier = 'tier1' | 'tier2' | 'tier3' | 'expert';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  source: 'user' | 'system';
}

export interface ProviderModel {
  name: string;
  costPer1kTokens?: number;
  maxTokens?: number;
  supportsVision: boolean;
  speed: 'fast' | 'medium' | 'slow';
  quality: 'basic' | 'good' | 'excellent';
}

export const PROVIDER_MODELS: Record<LLMProvider, ProviderModel[]> = {
  openai: [
    { name: 'gpt-4o-mini', costPer1kTokens: 0.15, maxTokens: 16384, supportsVision: true, speed: 'fast', quality: 'good' },
    { name: 'gpt-4o', costPer1kTokens: 2.50, maxTokens: 128000, supportsVision: true, speed: 'medium', quality: 'excellent' },
    { name: 'gpt-4-turbo', costPer1kTokens: 10.00, maxTokens: 128000, supportsVision: true, speed: 'slow', quality: 'excellent' },
  ],
  anthropic: [
    { name: 'claude-3-5-haiku-20241022', costPer1kTokens: 0.25, maxTokens: 200000, supportsVision: true, speed: 'fast', quality: 'good' },
    { name: 'claude-3-5-sonnet-20241022', costPer1kTokens: 3.00, maxTokens: 200000, supportsVision: true, speed: 'medium', quality: 'excellent' },
    { name: 'claude-3-opus-20240229', costPer1kTokens: 15.00, maxTokens: 200000, supportsVision: true, speed: 'slow', quality: 'excellent' },
  ],
  google: [
    { name: 'gemini-1.5-flash', costPer1kTokens: 0.00, maxTokens: 1000000, supportsVision: true, speed: 'fast', quality: 'good' }, // FREE
    { name: 'gemini-1.5-pro', costPer1kTokens: 0.00, maxTokens: 2000000, supportsVision: true, speed: 'medium', quality: 'excellent' }, // FREE
  ],
};

export const TIER_CONFIGS: Record<AnalysisTier, { provider: LLMProvider; model: string; description: string }> = {
  tier1: { provider: 'google', model: 'gemini-1.5-flash', description: 'Fast, free basic analysis' },
  tier2: { provider: 'openai', model: 'gpt-4o-mini', description: 'Good quality, low cost' },
  tier3: { provider: 'openai', model: 'gpt-4o', description: 'High quality, balanced cost' },
  expert: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', description: 'Highest quality, comprehensive analysis' },
};

/**
 * Get LLM configuration with user preference and fallback
 */
export async function getLLMConfig(
  supabase: any,
  userId: string | null,
  preferredProvider?: LLMProvider,
  preferredModel?: string,
  tier?: AnalysisTier
): Promise<LLMConfig> {
  // If tier specified, use tier config
  if (tier) {
    const tierConfig = TIER_CONFIGS[tier];
    const { getUserApiKey } = await import('./getUserApiKey.ts');
    const apiKeyResult = await getUserApiKey(
      supabase,
      userId,
      tierConfig.provider,
      tierConfig.provider === 'openai' ? 'OPENAI_API_KEY' :
      tierConfig.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' :
      'GOOGLE_AI_API_KEY'
    );
    
    if (apiKeyResult.apiKey) {
      return {
        provider: tierConfig.provider,
        model: tierConfig.model,
        apiKey: apiKeyResult.apiKey,
        source: apiKeyResult.source
      };
    }
  }
  
  // Try preferred provider/model
  if (preferredProvider && preferredModel) {
    const { getUserApiKey } = await import('./getUserApiKey.ts');
    const apiKeyResult = await getUserApiKey(
      supabase,
      userId,
      preferredProvider,
      preferredProvider === 'openai' ? 'OPENAI_API_KEY' :
      preferredProvider === 'anthropic' ? 'ANTHROPIC_API_KEY' :
      'GOOGLE_AI_API_KEY'
    );
    
    if (apiKeyResult.apiKey) {
      return {
        provider: preferredProvider,
        model: preferredModel,
        apiKey: apiKeyResult.apiKey,
        source: apiKeyResult.source
      };
    }
  }
  
  // Fallback: Try providers in order (free first)
  const fallbackOrder: LLMProvider[] = ['google', 'openai', 'anthropic'];
  
  for (const provider of fallbackOrder) {
    const { getUserApiKey } = await import('./getUserApiKey.ts');
    const apiKeyResult = await getUserApiKey(
      supabase,
      userId,
      provider,
      provider === 'openai' ? 'OPENAI_API_KEY' :
      provider === 'anthropic' ? 'ANTHROPIC_API_KEY' :
      'GOOGLE_AI_API_KEY'
    );
    
    if (apiKeyResult.apiKey) {
      // Use cheapest/fastest model for this provider
      const models = PROVIDER_MODELS[provider];
      const model = models.find(m => m.speed === 'fast') || models[0];
      
      return {
        provider,
        model: model.name,
        apiKey: apiKeyResult.apiKey,
        source: apiKeyResult.source
      };
    }
  }
  
  throw new Error('No LLM provider available (no API keys configured)');
}

/**
 * Call LLM with unified interface
 */
export async function callLLM(
  config: LLMConfig,
  messages: any[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    vision?: boolean;
  }
): Promise<any> {
  const logPrefix = `[LLM:${config.provider}/${config.model}]`;
  console.log(`${logPrefix} Calling LLM with ${messages.length} messages`);
  
  const startTime = Date.now();
  
  try {
    let response: any;
    
    if (config.provider === 'openai') {
      response = await callOpenAI(config, messages, options);
    } else if (config.provider === 'anthropic') {
      response = await callAnthropic(config, messages, options);
    } else if (config.provider === 'google') {
      response = await callGoogle(config, messages, options);
    } else {
      throw new Error(`Unknown provider: ${config.provider}`);
    }
    
    const duration = Date.now() - startTime;
    console.log(`${logPrefix} ✅ Success (${duration}ms)`);
    
    return {
      ...response,
      provider: config.provider,
      model: config.model,
      duration_ms: duration,
      source: config.source
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`${logPrefix} ❌ Failed (${duration}ms):`, error.message);
    throw error;
  }
}

async function callOpenAI(config: LLMConfig, messages: any[], options?: any): Promise<any> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }
  
  const data = await response.json();
  return {
    content: data.choices[0]?.message?.content || '',
    usage: data.usage,
    finish_reason: data.choices[0]?.finish_reason,
  };
}

async function callAnthropic(config: LLMConfig, messages: any[], options?: any): Promise<any> {
  // Convert messages format for Anthropic
  const systemMessage = messages.find(m => m.role === 'system')?.content || '';
  const conversationMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      system: systemMessage,
      messages: conversationMessages,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${error}`);
  }
  
  const data = await response.json();
  return {
    content: data.content[0]?.text || '',
    usage: data.usage,
    finish_reason: data.stop_reason,
  };
}

async function callGoogle(config: LLMConfig, messages: any[], options?: any): Promise<any> {
  // Convert messages format for Google
  const parts = messages
    .filter(m => m.role !== 'system')
    .flatMap(m => {
      if (typeof m.content === 'string') {
        return [{ text: m.content }];
      } else if (Array.isArray(m.content)) {
        return m.content.map(c => {
          if (c.type === 'text') return { text: c.text };
          if (c.type === 'image_url') {
            return {
              inline_data: {
                mime_type: 'image/jpeg',
                data: c.image_url.url.split(',')[1] || c.image_url.url,
              },
            };
          }
          return { text: JSON.stringify(c) };
        });
      }
      return [{ text: JSON.stringify(m.content) }];
    });
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxTokens,
        },
      }),
    }
  );
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google API error: ${response.status} - ${error}`);
  }
  
  const data = await response.json();
  return {
    content: data.candidates[0]?.content?.parts[0]?.text || '',
    usage: data.usageMetadata,
    finish_reason: data.candidates[0]?.finishReason,
  };
}


