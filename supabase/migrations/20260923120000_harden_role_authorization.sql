/*
  # Harden role authorization: stop trusting client-writable JWT metadata

  ## Problem
  Almost every policy in this schema authorized off the JWT:

      (auth.jwt()->'user_metadata'->>'role') = 'admin'

  `user_metadata` maps to `auth.users.raw_user_meta_data`, which the owning user
  can rewrite at will via `supabase.auth.updateUser({ data: { role: 'admin' } })`.
  Any authenticated user could therefore grant themselves any role and satisfy
  every one of those policies. Supabase's own guidance is that user_metadata must
  never be used for authorization.

  `handle_new_user()` had the same flaw from the other direction: it copied
  `raw_user_meta_data->>'role'` straight into `profiles.role`, so a self-service
  signup could pick its own role.

  The original migration (20251009065847) reached for the JWT deliberately, to
  escape infinite recursion in the `profiles` policies. That was the right problem
  to worry about and the wrong tool: a SECURITY DEFINER function reads
  `profiles.role` without re-entering RLS, so it breaks the recursion without
  trusting the client.

  ## Changes
  1. `current_user_role()` — SECURITY DEFINER lookup of the caller's `profiles.role`.
  2. Every `public` policy reading `user_metadata` regenerated against that helper.
     Only the role expression is substituted; each policy's own logic is preserved
     verbatim, read back from `pg_policies`.
  3. `handle_new_user()` always assigns 'customer'; signup metadata can no longer
     choose a role. Privileged roles are set explicitly by the admin edge functions.
  4. The migration fails loudly if any policy still reads `user_metadata` afterwards,
     so an expression this script does not recognize cannot slip through silently.

  ## Note
  `profiles` has no self-update policy — only "Admins can update profiles" — so
  moving authorization onto `profiles.role` closes the escalation rather than
  relocating it. Keep it that way: granting users UPDATE on their own profile row
  would reopen this hole.
*/

-- ---------------------------------------------------------------------------
-- 1. Non-forgeable role lookup
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.current_user_role() IS
  'Role of the calling user, read from profiles.role. SECURITY DEFINER so that '
  'policies on profiles can call it without recursing through RLS. Use this in '
  'policies instead of auth.jwt()->''user_metadata''->>''role'', which the user '
  'can rewrite themselves.';

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- 2. Repoint every affected policy at the helper
-- ---------------------------------------------------------------------------

DO $outer$
DECLARE
  r        RECORD;
  v_qual   text;
  v_check  text;
  v_roles  text;
  v_sql    text;
  v_fixed  int := 0;
  -- Matches how Postgres renders (auth.jwt()->'user_metadata'->>'role'),
  -- both bare and wrapped in the (SELECT ...) form migration 20251030080009 used.
  v_pattern constant text :=
    '\(\(\s*auth\.jwt\(\)\s*->\s*''user_metadata''(::text)?\s*\)\s*->>\s*''role''(::text)?\s*\)';
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (COALESCE(qual, '') LIKE '%user_metadata%'
            OR COALESCE(with_check, '') LIKE '%user_metadata%')
     ORDER BY tablename, policyname
  LOOP
    v_qual  := regexp_replace(COALESCE(r.qual, ''),       v_pattern, 'public.current_user_role()', 'g');
    v_check := regexp_replace(COALESCE(r.with_check, ''), v_pattern, 'public.current_user_role()', 'g');

    -- Fail rather than rebuild a policy we only partially understood.
    IF v_qual LIKE '%user_metadata%' OR v_check LIKE '%user_metadata%' THEN
      RAISE EXCEPTION
        'Unrecognized user_metadata expression on policy "%" of %.% — aborting. qual=[%] with_check=[%]',
        r.policyname, r.schemaname, r.tablename, r.qual, r.with_check;
    END IF;

    SELECT string_agg(CASE WHEN rn = 'public' THEN 'public' ELSE quote_ident(rn) END, ', ')
      INTO v_roles
      FROM unnest(r.roles) AS rn;

    v_sql := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
                    r.policyname, r.schemaname, r.tablename,
                    r.permissive, r.cmd, v_roles);

    IF v_qual <> '' THEN
      v_sql := v_sql || format(' USING (%s)', v_qual);
    END IF;
    IF v_check <> '' THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', v_check);
    END IF;

    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    EXECUTE v_sql;

    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'harden_role_authorization: repointed % policies at current_user_role()', v_fixed;
END $outer$;

-- ---------------------------------------------------------------------------
-- 3. Signup can no longer choose its own role
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- role is deliberately NOT read from new.raw_user_meta_data: that value is
  -- supplied by whoever called signUp. Privileged roles are assigned afterwards
  -- by the admin-create-user / admin-update-user edge functions, which verify
  -- that the caller is already an admin.
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    'customer'
  );
  RETURN new;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates a profile row on signup. Always assigns the ''customer'' role — never '
  'the client-supplied raw_user_meta_data.role — so signup cannot self-escalate.';

-- ---------------------------------------------------------------------------
-- 4. Verify
-- ---------------------------------------------------------------------------

DO $verify$
DECLARE
  v_leftover int;
  v_detail   text;
BEGIN
  SELECT count(*),
         string_agg(format('%s.%s/%s', schemaname, tablename, policyname), ', ')
    INTO v_leftover, v_detail
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (COALESCE(qual, '') LIKE '%user_metadata%'
          OR COALESCE(with_check, '') LIKE '%user_metadata%');

  IF v_leftover > 0 THEN
    RAISE EXCEPTION 'still % policies authorizing off user_metadata: %', v_leftover, v_detail;
  END IF;

  IF to_regprocedure('public.current_user_role()') IS NULL THEN
    RAISE EXCEPTION 'current_user_role() was not created';
  END IF;

  RAISE NOTICE 'harden_role_authorization: verified — no policy reads user_metadata';
END $verify$;
