/**
 * Shared utility to get user API key with fallback to system key
 */

interface ApiKeyResult {
  apiKey: string | null;
  source: 'user' | 'system';
  modelName?: string;
}

export async function getUserApiKey(
  supabase: any,
  userId: string | null,
  provider: 'openai' | 'anthropic' | 'google',
  systemKeyEnvVar: string
): Promise<ApiKeyResult> {
  // If no user ID, use system key
  if (!userId) {
    let systemKey = Deno.env.get(systemKeyEnvVar);
    // Fallback env var names for Google (GOOGLE_AI_API_KEY -> GEMINI_API_KEY)
    if (!systemKey && provider === 'google') {
      systemKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_API_KEY') || null;
    }
    return {
      apiKey: systemKey || null,
      source: 'system'
    };
  }

  // Check if user has active subscription (ignore errors - not critical)
  try {
    const { data: hasAccess, error: accessError } = await supabase
      .rpc('has_active_api_access', { p_user_id: userId });
    // We don't actually use hasAccess - just checking if RPC exists
    // If it fails, we'll still try to get user's key
  } catch (rpcError) {
    // RPC might not exist or might fail - that's okay, continue
    console.warn('RPC has_active_api_access failed (non-critical):', rpcError);
  }

  // Get user's API key directly from table (service role can access)
  const { data: userKeyInfo, error: keyError } = await supabase
    .from('user_ai_providers')
    .select('api_key_encrypted, model_name, is_default')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!keyError && userKeyInfo && userKeyInfo.api_key_encrypted) {
    // User has their own key - use it (even without subscription, they can use their own key)
    // Keys are stored as base64 encoded (simple obfuscation)
    // In production, use proper encryption/decryption
    let decryptedKey: string;
    try {
      // Try to decode as base64
      decryptedKey = atob(userKeyInfo.api_key_encrypted);
    } catch {
      // If not base64, assume it's plain text (for backwards compatibility)
      decryptedKey = userKeyInfo.api_key_encrypted;
    }
    
    return {
      apiKey: decryptedKey,
      source: 'user',
      modelName: userKeyInfo.model_name
    };
  }

  // No user key - use system key
  let systemKey = Deno.env.get(systemKeyEnvVar);
  // Fallback env var names for Google (GOOGLE_AI_API_KEY -> GEMINI_API_KEY)
  if (!systemKey && provider === 'google') {
    systemKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_API_KEY') || null;
  }
  return {
    apiKey: systemKey || null,
    source: 'system'
  };
}

