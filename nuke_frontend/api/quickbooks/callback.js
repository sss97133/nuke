/**
 * QuickBooks OAuth Callback - Vercel Serverless Function
 *
 * Handles the OAuth callback server-side to avoid code expiration issues.
 * Exchanges the authorization code for tokens immediately, then redirects to the UI.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  const { code, realmId, state, error } = req.query;

  // Handle OAuth errors from QuickBooks
  if (error) {
    console.error('QuickBooks OAuth error:', error);
    return res.redirect(302, `/business/settings?qb=error&message=${encodeURIComponent(String(error))}`);
  }

  // Validate required parameters
  if (!code || !realmId) {
    console.error('Missing code or realmId');
    return res.redirect(302, '/business/settings?qb=error&message=Missing+authorization+code+or+realm+ID');
  }

  try {
    console.log('Exchanging QuickBooks code for tokens...');
    console.log('Code:', String(code).substring(0, 10) + '...');
    console.log('RealmId:', realmId);
    console.log('SUPABASE_URL:', SUPABASE_URL);

    // Call the Supabase edge function to exchange the code
    const callbackUrl = `${SUPABASE_URL}/functions/v1/quickbooks-connect?action=callback&code=${encodeURIComponent(String(code))}&realmId=${encodeURIComponent(String(realmId))}`;

    console.log('Calling:', callbackUrl.substring(0, 60) + '...');

    const response = await fetch(callbackUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    console.log('Edge function response:', JSON.stringify(data));

    if (data.success) {
      console.log('QuickBooks connected successfully!');
      return res.redirect(302, `/business/settings?qb=success&realm=${realmId}`);
    } else {
      console.error('Edge function error:', data.error);
      return res.redirect(302, `/business/settings?qb=error&message=${encodeURIComponent(data.error || 'Failed to connect')}`);
    }
  } catch (err) {
    console.error('Callback handler error:', err);
    return res.redirect(302, `/business/settings?qb=error&message=${encodeURIComponent(err.message || 'Unknown error')}`);
  }
}
