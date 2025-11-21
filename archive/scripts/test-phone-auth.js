// Quick test script for phone authentication
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testPhoneAuth() {
    console.log('Testing phone authentication...');

    try {
        // Test with properly formatted phone number
        const phone = '+17026246793';
        console.log(`Sending OTP to: ${phone}`);

        const { data, error } = await supabase.auth.signInWithOtp({
            phone: phone,
        });

        if (error) {
            console.error('Error sending OTP:', error);
            console.error('Error details:', {
                message: error.message,
                status: error.status,
                details: error
            });
        } else {
            console.log('OTP sent successfully:', data);
        }

    } catch (err) {
        console.error('Caught error:', err);
    }
}

testPhoneAuth();