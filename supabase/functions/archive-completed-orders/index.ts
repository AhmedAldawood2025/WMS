import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, preflight } from '../_shared/http.ts';
import { requireSharedSecret } from '../_shared/auth.ts';

/*
  Scheduled job: archive orders completed more than 24 hours ago.

  Invoked by a scheduler rather than a signed-in user, so it is gated on a shared
  secret instead of an admin JWT. Without a gate, anyone who knew the URL could
  archive orders at will — the client below uses the service-role key and so
  bypasses RLS.

    supabase secrets set ARCHIVE_JOB_SECRET=...   # sent as the X-Secret header
*/
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    const denied = requireSharedSecret(req, 'ARCHIVE_JOB_SECRET');
    if (denied) return denied;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('orders')
      .update({ archived: true })
      .eq('status', 'completed')
      .eq('archived', false)
      .lte('completed_at', cutoff)
      .select('id');

    if (error) throw error;

    return json({ archived: data?.length ?? 0 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
