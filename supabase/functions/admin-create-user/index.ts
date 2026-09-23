import { createClient } from 'npm:@supabase/supabase-js@2';
import { fail, json, preflight } from '../_shared/http.ts';
import { isValidRole, requireAdmin, VALID_ROLES } from '../_shared/auth.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // This function holds the service-role key, so the caller must prove they are
    // an admin before anything else happens.
    const caller = await requireAdmin(req, supabaseAdmin);
    if (!caller.ok) return caller.response;

    const { email, password, display_name, role } = await req.json();

    if (!email || !password || !display_name || !role) {
      return fail('Missing required fields', 400);
    }
    if (!isValidRole(role)) {
      return fail(`role must be one of: ${VALID_ROLES.join(', ')}`, 400);
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name },
    });

    if (authError) return fail(authError.message, 400);

    const newUserId = authData.user?.id;
    if (!newUserId) return fail('User was created without an id', 500);

    /*
      handle_new_user() deliberately assigns 'customer' to every new profile and
      ignores signup metadata, so that self-service signup cannot choose its own
      role. The privileged role is applied here instead, after the caller has been
      confirmed to be an admin.
    */
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ display_name, role })
      .eq('id', newUserId);

    if (profileError) {
      // Don't leave a half-provisioned account behind.
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      return fail(`Could not set role, user was rolled back: ${profileError.message}`, 400);
    }

    return json({ success: true, user: authData.user });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
