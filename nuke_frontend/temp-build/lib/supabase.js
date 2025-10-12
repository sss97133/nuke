"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAuthenticated = exports.getCurrentUserId = exports.supabase = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
// Get environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
// Optional environment debug logging
const ENABLE_DEBUG = import.meta.env?.VITE_ENABLE_DEBUG === 'true';
if (ENABLE_DEBUG) {
    // Keep logs opt-in to avoid distracting normal testing
    console.log('Auth system initialized with Supabase configuration');
    console.log('VITE_SUPABASE_URL:', supabaseUrl);
    console.log('VITE_SUPABASE_ANON_KEY present:', !!supabaseAnonKey);
    if (!supabaseUrl)
        console.warn('Missing VITE_SUPABASE_URL - check your .env file');
    if (!supabaseAnonKey)
        console.warn('Missing VITE_SUPABASE_ANON_KEY - check your .env file');
}
// Validate required environment variables
if (!supabaseUrl || !supabaseAnonKey) {
    const missingVars = [];
    if (!supabaseUrl)
        missingVars.push('VITE_SUPABASE_URL');
    if (!supabaseAnonKey)
        missingVars.push('VITE_SUPABASE_ANON_KEY');
    console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Please check your .env file and ensure all Supabase configuration is properly set');
}
// Create and export the Supabase client
exports.supabase = (0, supabase_js_1.createClient)(supabaseUrl || '', // Fallback to empty string to prevent crashes
supabaseAnonKey || '', // Fallback to empty string to prevent crashes
{
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
    }
    // Using default realtime settings to avoid compatibility issues
});
// Helper function to get the current user ID
const getCurrentUserId = async () => {
    try {
        const { data, error } = await exports.supabase.auth.getUser();
        if (error)
            throw error;
        return data.user?.id || null;
    }
    catch (error) {
        console.error('Error getting user ID:', error);
        return null;
    }
};
exports.getCurrentUserId = getCurrentUserId;
// Helper to check if the user is authenticated
const isAuthenticated = async () => {
    const { data } = await exports.supabase.auth.getSession();
    return !!data.session;
};
exports.isAuthenticated = isAuthenticated;
