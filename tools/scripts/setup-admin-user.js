// Setup Admin User Script
// Run this script to set yourself up as the admin user

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // You'll need to add this to your .env

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables:');
  console.error('- VITE_SUPABASE_URL');
  console.error('- SUPABASE_SERVICE_ROLE_KEY (get this from Supabase dashboard)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupAdminUser() {
  try {
    console.log('Setting up admin user...');
    
    // First, let's find your user ID
    // You'll need to replace this email with your actual email
    const userEmail = 'skylar@gmail.com'; // CHANGE THIS TO YOUR EMAIL
    
    console.log(`Looking for user with email: ${userEmail}`);
    
    // Get user by email (this requires service role key)
    const { data: users, error: userError } = await supabase.auth.admin.listUsers();
    
    if (userError) {
      console.error('Error fetching users:', userError);
      return;
    }
    
    const user = users.users.find(u => u.email === userEmail);
    
    if (!user) {
      console.error(`User with email ${userEmail} not found.`);
      console.log('Available users:');
      users.users.forEach(u => console.log(`- ${u.email} (ID: ${u.id})`));
      return;
    }
    
    console.log(`Found user: ${user.email} (ID: ${user.id})`);
    
    // Check if admin_users table exists and create admin record
    const { data: existingAdmin, error: checkError } = await supabase
      .from('admin_users')
      .select('*')
      .eq('user_id', user.id)
      .single();
    
    if (existingAdmin) {
      console.log('User is already an admin!');
      return;
    }
    
    // Insert admin record
    const { data: adminData, error: adminError } = await supabase
      .from('admin_users')
      .insert({
        user_id: user.id,
        admin_level: 'super_admin',
        permissions: ['approve_ownership', 'approve_vehicle', 'review_fraud', 'system_admin'],
        is_active: true
      })
      .select()
      .single();
    
    if (adminError) {
      console.error('Error creating admin user:', adminError);
      return;
    }
    
    console.log('✅ Successfully set up admin user!');
    console.log('Admin details:', adminData);
    console.log('\nYou can now:');
    console.log('1. See admin notifications in your dashboard');
    console.log('2. Approve/reject ownership verifications');
    console.log('3. Review vehicle verifications');
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// Run the setup
setupAdminUser();
