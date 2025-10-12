// Admin utility to grant consigner access (for development/setup purposes)
// Usage: Run this in the browser console as a site admin

async function grantConsignerAccess(vehicleId, userId, note = 'Admin granted access') {
  // Check if we're in development or if user has admin privileges
  if (typeof supabase === 'undefined') {
    console.error('Supabase not available. Run this in the browser on the site.');
    return false;
  }

  try {
    const { data, error } = await supabase
      .from('vehicle_contributors')
      .insert({
        vehicle_id: vehicleId,
        user_id: userId,
        role: 'consigner',
        notes: note
      });

    if (error) {
      if (error.code === '23505') {
        console.log('✅ User is already a consigner for this vehicle');
        return true;
      }
      console.error('❌ Failed to grant access:', error);
      return false;
    }

    console.log('✅ Consigner access granted successfully');
    return true;
  } catch (err) {
    console.error('❌ Unexpected error:', err);
    return false;
  }
}

// Example usage:
// grantConsignerAccess('21ee373f-765e-4e24-a69d-e59e2af4f467', 'a4f0c46c-e9b2-460a-8ce4-6220a42bbea7')

console.log('Admin consigner utility loaded. Use: grantConsignerAccess(vehicleId, userId)');