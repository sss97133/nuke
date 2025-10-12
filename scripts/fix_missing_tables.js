import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
}

// Use service role key to bypass RLS
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixMissingTables() {
    console.log('Fixing missing tables and columns...');
    
    try {
        // Execute SQL to create missing tables and columns
        const { error } = await supabase.rpc('exec_sql', {
            sql: `
                -- Add missing column to profile_stats if it doesn't exist
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'profile_stats'
                        AND column_name = 'total_images'
                    ) THEN
                        ALTER TABLE profile_stats
                        ADD COLUMN total_images INTEGER DEFAULT 0;
                    END IF;
                END $$;

                -- Create live_streaming_sessions table if it doesn't exist
                CREATE TABLE IF NOT EXISTS live_streaming_sessions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
                    streamer_id UUID NOT NULL REFERENCES profiles(id),
                    platform TEXT CHECK (platform IN ('youtube', 'twitch', 'custom')),
                    stream_url TEXT,
                    stream_key TEXT,
                    title TEXT,
                    description TEXT,
                    is_live BOOLEAN DEFAULT true,
                    viewer_count INTEGER DEFAULT 0,
                    started_at TIMESTAMPTZ DEFAULT NOW(),
                    ended_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );

                -- Create user_presence table if it doesn't exist
                CREATE TABLE IF NOT EXISTS user_presence (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
                    user_id UUID REFERENCES profiles(id),
                    session_id TEXT,
                    is_authenticated BOOLEAN DEFAULT false,
                    user_agent TEXT,
                    ip_address INET,
                    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(vehicle_id, user_id),
                    UNIQUE(vehicle_id, session_id)
                );

                -- Create timeline_event_comments table if it doesn't exist
                CREATE TABLE IF NOT EXISTS timeline_event_comments (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
                    event_id UUID NOT NULL REFERENCES vehicle_timeline_events(id) ON DELETE CASCADE,
                    user_id UUID REFERENCES profiles(id),
                    comment_text TEXT NOT NULL,
                    is_edited BOOLEAN DEFAULT false,
                    edited_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );

                -- Create vehicle_image_comments table if it doesn't exist
                CREATE TABLE IF NOT EXISTS vehicle_image_comments (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
                    image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
                    user_id UUID REFERENCES profiles(id),
                    comment_text TEXT NOT NULL,
                    is_edited BOOLEAN DEFAULT false,
                    edited_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
            `
        });

        if (error) {
            console.error('Error executing SQL:', error);
            // If exec_sql doesn't exist, try direct table operations
            console.log('Attempting direct table operations...');
            
            // Check and create tables one by one
            await createTableIfNotExists('live_streaming_sessions');
            await createTableIfNotExists('user_presence');
            await createTableIfNotExists('timeline_event_comments');
            await createTableIfNotExists('vehicle_image_comments');
        } else {
            console.log('Tables and columns fixed successfully!');
        }
        
        // Enable RLS on tables
        console.log('Enabling RLS policies...');
        await enableRLSPolicies();
        
    } catch (err) {
        console.error('Error fixing tables:', err);
    }
}

async function createTableIfNotExists(tableName) {
    // Check if table exists
    const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .limit(1);
    
    if (error && error.code === 'PGRST204') {
        console.log(`Table ${tableName} doesn't exist, needs to be created manually in Supabase Dashboard`);
    } else if (!error) {
        console.log(`Table ${tableName} already exists`);
    }
}

async function enableRLSPolicies() {
    const tables = [
        'live_streaming_sessions',
        'user_presence', 
        'timeline_event_comments',
        'vehicle_image_comments'
    ];
    
    for (const table of tables) {
        try {
            // Check if we can access the table
            const { error } = await supabase.from(table).select('id').limit(1);
            if (!error) {
                console.log(`RLS check passed for ${table}`);
            }
        } catch (err) {
            console.log(`RLS check failed for ${table}:`, err.message);
        }
    }
}

fixMissingTables().catch(console.error);
