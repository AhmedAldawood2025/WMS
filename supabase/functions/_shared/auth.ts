import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { fail } from './http.ts';

export const VALID_ROLES = [
  'customer',
  'warehouse_manager',
  'factory_manager',
  'accountant',
  'admin',
  'general_manager',
] as const;

export type Role = typeof VALID_ROLES[number];

export function isValidRole(role: unknown): role is Role {
  return typeof role === 'string' && (VALID_ROLES as readonly string[]).includes(role);
}

type AdminCheck =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

/*
  Verify that the caller is a signed-in admin.

  These functions hold SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS entirely, so
  without this check any caller could create or modify arbitrary accounts.

  The role is read from profiles.role, never from the JWT's user_metadata: a user
  can rewrite their own user_metadata via supabase.auth.updateUser, so a role claim
  in the token proves nothing.
*/
export async function requireAdmin(req: Request, admin: SupabaseClient): Promise<AdminCheck> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return { ok: false, response: fail('Missing Authorization header', 401) };
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) {
    return { ok: false, response: fail('Invalid or expired token', 401) };
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileError) {
    return { ok: false, response: fail('Could not verify caller role', 500) };
  }
  if (profile?.role !== 'admin') {
    return { ok: false, response: fail('Admin role required', 403) };
  }

  return { ok: true, userId: userData.user.id };
}

/*
  Guard for endpoints invoked by a scheduler rather than a signed-in user.
  Compares against SHARED_SECRET_ENV in constant time so the check cannot be
  narrowed by timing. Returns null when the caller is authorised.
*/
export function requireSharedSecret(req: Request, envVar: string): Response | null {
  const expected = Deno.env.get(envVar);
  if (!expected) {
    return fail(`${envVar} is not configured on this function`, 503);
  }

  const presented = req.headers.get('X-Secret') ?? '';
  if (!constantTimeEquals(presented, expected)) {
    return fail('Invalid or missing X-Secret header', 403);
  }
  return null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // Compare a fixed number of bytes so length alone does not shortcut the loop.
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}
