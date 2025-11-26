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
    const systemKey = Deno.env.get(systemKeyEnvVar);
    return {
      apiKey: systemKey || null,
      source: 'system'
    };
  }

  // Check if user has active subscription
  const { data: subscription } = await supabase
    .rpc('has_active_api_access', { p_user_id: userId });

  if (!subscription) {
    // No active subscription - use system key (they'll be charged)
    const systemKey = Deno.env.get(systemKeyEnvVar);
    return {
      apiKey: systemKey || null,
      source: 'system'
    };
  }

  // Get user's API key
  const { data: userKeyInfo, error } = await supabase
    .rpc('get_user_api_key_info', {
      p_user_id: userId,
      p_provider: provider
    });

  if (error || !userKeyInfo || userKeyInfo.length === 0) {
    // User doesn't have their own key - use system key
    const systemKey = Deno.env.get(systemKeyEnvVar);
    return {
      apiKey: systemKey || null,
      source: 'system'
    };
  }

  // Decrypt the key (simple base64 decode for now - in production use proper encryption)
  // For now, we'll assume keys are stored encrypted and need to be decrypted
  // In production, use a proper encryption library
  let decryptedKey: string;
  try {
    // If stored as base64, decode it
    decryptedKey = atob(userKeyInfo[0].api_key_encrypted);
  } catch {
    // If not base64, assume it's plain text (for development)
    decryptedKey = userKeyInfo[0].api_key_encrypted;
  }

  return {
    apiKey: decryptedKey,
    source: 'user',
    modelName: userKeyInfo[0].model_name
  };
}

