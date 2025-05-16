
// Get the base URL for auth redirects
export const getRedirectBase = () => {
  // Using a single source of truth for host/origin
  const origin = window.location.origin;
  const hostname = window.location.hostname;
  
  console.log("[useAuthConfig] Current origin:", origin);

  if (hostname.includes('lovable.ai')) {
    return origin;
  }
  
  if (hostname === 'localhost') {
    return 'http://localhost:5173';
  }

  return origin;
};
