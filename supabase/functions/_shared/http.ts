// Shared HTTP helpers for the edge functions.

// Set ALLOWED_ORIGIN (e.g. https://wms.spicymeal.com.sa) to stop browsers on other
// origins from calling these endpoints. Authorization is enforced by requireAdmin
// regardless of CORS — CORS is defence in depth, not the access control.
const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

export const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  'Vary': 'Origin',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function fail(message: string, status: number): Response {
  return json({ success: false, error: message }, status);
}

export function preflight(): Response {
  return new Response(null, { status: 200, headers: corsHeaders });
}
