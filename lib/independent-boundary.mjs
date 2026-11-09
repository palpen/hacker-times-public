// Synthetic preview routes only. No production identity or data is consulted.
export function independentRequestAllowed(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return false;
  const path = new URL(request.url).pathname;
  return path === '/' || path === '/healthz' ||
    path === '/api/edition' || path === '/api/archive' || path === '/api/comments' ||
    path.startsWith('/reader-assets/');
}
