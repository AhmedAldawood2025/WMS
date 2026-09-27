/*
  Tests for the authorization helpers.

  Run with:  deno test supabase/functions/_shared/auth_test.ts

  The case that matters most is "metadata says admin, profiles says customer":
  user_metadata is writable by the user it belongs to, so a role claim in the
  token must never be enough to pass requireAdmin.
*/
import { assertEquals } from 'jsr:@std/assert@1';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { isValidRole, requireAdmin, requireSharedSecret } from './auth.ts';

// A stand-in for the service-role SupabaseClient, covering only what requireAdmin calls.
function fakeClient(opts: {
  user?: { id: string; user_metadata?: Record<string, unknown> } | null;
  userError?: boolean;
  profileRole?: string | null;
  profileError?: boolean;
}) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve(
          opts.userError || !opts.user
            ? { data: { user: null }, error: { message: 'bad token' } }
            : { data: { user: opts.user }, error: null },
        ),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(
              opts.profileError
                ? { data: null, error: { message: 'db down' } }
                : { data: opts.profileRole === null ? null : { role: opts.profileRole }, error: null },
            ),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

const withAuth = (token?: string) =>
  new Request('https://example.test', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

async function status(r: Awaited<ReturnType<typeof requireAdmin>>): Promise<number | 'ok'> {
  return r.ok ? 'ok' : r.response.status;
}

Deno.test('requireAdmin: rejects a request with no Authorization header', async () => {
  const r = await requireAdmin(withAuth(), fakeClient({ user: { id: 'u1' }, profileRole: 'admin' }));
  assertEquals(await status(r), 401);
});

Deno.test('requireAdmin: rejects an invalid token', async () => {
  const r = await requireAdmin(withAuth('bogus'), fakeClient({ userError: true }));
  assertEquals(await status(r), 401);
});

Deno.test('requireAdmin: rejects a valid non-admin user', async () => {
  const r = await requireAdmin(withAuth('t'), fakeClient({ user: { id: 'u1' }, profileRole: 'customer' }));
  assertEquals(await status(r), 403);
});

Deno.test('requireAdmin: rejects a user with no profile row', async () => {
  const r = await requireAdmin(withAuth('t'), fakeClient({ user: { id: 'u1' }, profileRole: null }));
  assertEquals(await status(r), 403);
});

Deno.test('requireAdmin: fails closed when the profile lookup errors', async () => {
  const r = await requireAdmin(withAuth('t'), fakeClient({ user: { id: 'u1' }, profileError: true }));
  assertEquals(await status(r), 500);
});

Deno.test('requireAdmin: IGNORES a forged admin claim in user_metadata', async () => {
  const r = await requireAdmin(
    withAuth('t'),
    fakeClient({
      user: { id: 'u1', user_metadata: { role: 'admin' } }, // forged by the user
      profileRole: 'customer', // the truth
    }),
  );
  assertEquals(await status(r), 403);
});

Deno.test('requireAdmin: accepts a real admin', async () => {
  const r = await requireAdmin(withAuth('t'), fakeClient({ user: { id: 'u1' }, profileRole: 'admin' }));
  assertEquals(await status(r), 'ok');
  if (r.ok) assertEquals(r.userId, 'u1');
});

Deno.test('requireSharedSecret: 503 when the secret is not configured', () => {
  Deno.env.delete('TEST_SECRET');
  assertEquals(requireSharedSecret(new Request('https://x.test'), 'TEST_SECRET')?.status, 503);
});

Deno.test('requireSharedSecret: 403 on a missing or wrong header', () => {
  Deno.env.set('TEST_SECRET', 'correct-horse');
  assertEquals(requireSharedSecret(new Request('https://x.test'), 'TEST_SECRET')?.status, 403);

  const wrong = new Request('https://x.test', { headers: { 'X-Secret': 'correct-hors' } });
  assertEquals(requireSharedSecret(wrong, 'TEST_SECRET')?.status, 403);

  const longer = new Request('https://x.test', { headers: { 'X-Secret': 'correct-horsey' } });
  assertEquals(requireSharedSecret(longer, 'TEST_SECRET')?.status, 403);
});

Deno.test('requireSharedSecret: passes on an exact match', () => {
  Deno.env.set('TEST_SECRET', 'correct-horse');
  const ok = new Request('https://x.test', { headers: { 'X-Secret': 'correct-horse' } });
  assertEquals(requireSharedSecret(ok, 'TEST_SECRET'), null);
});

Deno.test('isValidRole: accepts only the six schema roles', () => {
  for (const r of ['customer', 'warehouse_manager', 'factory_manager', 'accountant', 'admin', 'general_manager']) {
    assertEquals(isValidRole(r), true, r);
  }
  for (const r of ['superadmin', 'Admin', '', 'root', null, undefined, 7, {}]) {
    assertEquals(isValidRole(r), false, String(r));
  }
});
