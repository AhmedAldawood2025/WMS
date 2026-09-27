import { createClient } from 'npm:@supabase/supabase-js@2';
import { fail, json, preflight } from '../_shared/http.ts';
import { requireSharedSecret } from '../_shared/auth.ts';

/*
  One-time bootstrap of the first accounts.

  This endpoint cannot require an admin caller, because its whole purpose is to
  create the first admin — so it is gated on a shared secret instead, and the
  seed credentials come from the environment. Nothing here is hardcoded: an
  earlier version of this file shipped a real admin password as a literal, which
  is why SEED_ADMIN_PASSWORD is now required rather than defaulted.

  Configure before invoking:
    supabase secrets set SEED_SECRET=...            # sent as the X-Secret header
    supabase secrets set SEED_ADMIN_EMAIL=...
    supabase secrets set SEED_ADMIN_PASSWORD=...
    supabase secrets set SEED_TEST_EMAIL=...        # optional
    supabase secrets set SEED_TEST_PASSWORD=...     # optional

  Once the first admin exists, unset these and delete this function — further
  accounts belong to admin-create-user, and SETUP_GUIDE.md documents promoting a
  user from the Supabase dashboard as an alternative.
*/
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    const denied = requireSharedSecret(req, 'SEED_SECRET');
    if (denied) return denied;

    const adminEmail = Deno.env.get('SEED_ADMIN_EMAIL');
    const adminPassword = Deno.env.get('SEED_ADMIN_PASSWORD');

    if (!adminEmail || !adminPassword) {
      return fail('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set on this function', 503);
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const testEmail = Deno.env.get('SEED_TEST_EMAIL');
    const testPassword = Deno.env.get('SEED_TEST_PASSWORD');

    const users = [
      { email: adminEmail, password: adminPassword, display_name: 'Admin User', role: 'admin' },
      ...(testEmail && testPassword
        ? [{ email: testEmail, password: testPassword, display_name: 'Test Customer', role: 'customer' }]
        : []),
    ];

    const results = [];

    for (const user of users) {
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { display_name: user.display_name },
      });

      if (authError) {
        results.push({
          email: user.email,
          status: authError.message.includes('already registered') ? 'already_exists' : 'error',
          ...(authError.message.includes('already registered') ? {} : { error: authError.message }),
        });
        continue;
      }

      // handle_new_user() always writes 'customer'; set the real role explicitly.
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({ display_name: user.display_name, role: user.role })
        .eq('id', authData.user!.id);

      results.push(
        profileError
          ? { email: user.email, status: 'error', error: profileError.message }
          : { email: user.email, status: 'created', id: authData.user?.id },
      );
    }

    return json({ success: true, results });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
