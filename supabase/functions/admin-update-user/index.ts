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

    /*
      Without this check, any caller could pass an arbitrary userId plus a new
      password and take over any account, including an admin's — the service-role
      client below bypasses RLS completely.
    */
    const caller = await requireAdmin(req, supabaseAdmin);
    if (!caller.ok) return caller.response;

    const { userId, email, password, display_name, role } = await req.json();

    if (!userId || !email || !display_name || !role) {
      return fail('Missing required fields', 400);
    }
    if (!isValidRole(role)) {
      return fail(`role must be one of: ${VALID_ROLES.join(', ')}`, 400);
    }

    // An admin demoting themselves would lock the last admin out of user management.
    if (userId === caller.userId && role !== 'admin') {
      return fail('You cannot remove your own admin role', 400);
    }

    const updateData: Record<string, unknown> = {
      email,
      user_metadata: { display_name },
    };
    if (typeof password === 'string' && password.trim() !== '') {
      updateData.password = password;
    }

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.updateUserById(userId, updateData);

    if (authError) return fail(authError.message, 400);

    // profiles.role is the authoritative role — see current_user_role() in the
    // migrations. Keep it in step with the auth record.
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ email, display_name, role })
      .eq('id', userId);

    if (profileError) return fail(profileError.message, 400);

    return json({ success: true, user: authData.user });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
