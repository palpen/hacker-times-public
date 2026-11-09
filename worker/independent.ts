import { assetResponse } from '../lib/asset-response';
import { renderEdition } from '../lib/render-edition';
import type { Edition } from '../lib/contracts';
import { secureResponse } from '../lib/security';
import { independentRequestAllowed } from '../lib/independent-boundary.mjs';
import fixture from '../examples/synthetic-preview.json';

// Deliberately has no environment argument, storage client, network client,
// production publication import, auth substitution, or restoration toggle.
const version = 'synthetic-preview-v1';
const edition = fixture as Edition;
const html = renderEdition(edition, version).replace('<body>', '<body><aside role="status">SYNTHETIC PREVIEW — fictional sample stories only. Not the live newspaper.</aside>');
const worker = {
  async fetch(request: Request): Promise<Response> {
    if (!independentRequestAllowed(request)) return secureResponse(new Response('Not found', { status: 404 }));
    const path = new URL(request.url).pathname;
    let response: Response;
    if (path === '/healthz') response = Response.json({ mode: 'synthetic-only', publishingEnabled: false, productionData: false });
    else if (path === '/') response = new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'X-Edition-Version': version } });
    else if (path === '/api/edition') response = Response.json({ ...edition, version, synthetic: true });
    else if (path === '/api/archive') response = Response.json({ dates: [], synthetic: true });
    else if (path === '/api/comments') response = Response.json({ error: 'Live comments are disabled in this synthetic preview.', synthetic: true }, { status: 404 });
    else response = assetResponse(request) ?? new Response('Not found', { status: 404 });
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    headers.set('X-Preview-Mode', 'synthetic-only');
    return secureResponse(new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers }));
  },
};

export default worker;
