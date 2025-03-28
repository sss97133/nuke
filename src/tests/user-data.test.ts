import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '../types/database';

type Profile = Database['public']['Tables']['profiles']['Row'];
type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];
type UserPreferences = Database['public']['Tables']['user_preferences']['Row'];
type UserPreferencesInsert = Database['public']['Tables']['user_preferences']['Insert'];
type UserInteractions = Database['public']['Tables']['user_interactions']['Row'];
type UserInteractionsInsert = Database['public']['Tables']['user_interactions']['Insert'];

interface TestUser {
  email: string;
  password: string;
  profile: {
    full_name: string;
    email: string;
  };
}

describe('User Data Management', () => {
  const testUser: TestUser = {
    email: `test-${Date.now()}@example.com`,
    password: 'testPassword123!',
    profile: {
      full_name: 'Test User',
      email: `test-${Date.now()}@example.com`
    }
  };

  let userId: string;

  beforeAll(async () => {
    // Create test user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: testUser.email,
      password: testUser.password
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('Failed to create test user');
    
    userId = authData.user.id;

    // Create profile
    const profileData: ProfileInsert = {
      id: userId,
      email: testUser.email,
      full_name: testUser.profile.full_name
    };

    const { error: profileError } = await supabase
      .from('profiles')
      .upsert(profileData);

    if (profileError) throw profileError;
  });

  afterAll(async () => {
    // Clean up test data
    if (userId) {
      const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userId);

      if (profileError) console.error('Error cleaning up profile:', profileError);

      const { error: userError } = await supabase.auth.admin.deleteUser(userId);
      if (userError) console.error('Error cleaning up user:', userError);
    }
  });

  it('should store user profile data correctly', async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select()
      .eq('id', userId)
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    if (data) {
      expect(data.email).toBe(testUser.email);
      expect(data.full_name).toBe(testUser.profile.full_name);
    }
  });

  it('should update user profile data', async () => {
    const updateData: ProfileUpdate = {
      full_name: 'Updated Name'
    };

    const { error: updateError } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', userId);

    expect(updateError).toBeNull();

    // Verify the update
    const { data, error: fetchError } = await supabase
      .from('profiles')
      .select()
      .eq('id', userId)
      .single();

    expect(fetchError).toBeNull();
    if (data) {
      expect(data.full_name).toBe(updateData.full_name);
    }
  });

  it('should store user preferences', async () => {
    const testPreferences = {
      theme: 'dark',
      fontSize: 1.2,
      spacing: 'compact',
      animations: true,
      colorAccent: '#ff0000'
    };

    const { error: insertError } = await supabase
      .from('user_preferences')
      .upsert({
        id: userId.toString(),
        preferences: testPreferences
      });

    expect(insertError).toBeNull();

    // Verify preferences were stored
    const { data, error: fetchError } = await supabase
      .from('user_preferences')
      .select()
      .eq('id', userId.toString())
      .single();

    expect(fetchError).toBeNull();
    if (data) {
      expect(data.preferences).toEqual(testPreferences);
    }
  });

  it('should track user interactions', async () => {
    const testInteraction = {
      user_id: userId,
      element: 'profile_button',
      action: 'click',
      metadata: { page: 'profile' }
    };

    const { error: insertError } = await supabase
      .from('user_interactions')
      .insert(testInteraction);

    expect(insertError).toBeNull();

    // Verify interaction was stored
    const { data, error: fetchError } = await supabase
      .from('user_interactions')
      .select()
      .eq('user_id', userId)
      .eq('element', 'profile_button')
      .single();

    expect(fetchError).toBeNull();
    if (data) {
      expect(data.action).toBe('click');
      expect(data.metadata).toEqual({ page: 'profile' });
    }
  });
}); 