/*
  # Give the admin role full access to every table

  ## Why
  `admin` is meant to be the top-level role for the whole system, but its access
  grew table by table: admins can manage users, branches and items, yet some
  tables (daily factory operations, stock adjustments, purchase orders, pricing
  and so on) only let the role that owns them read or write. An admin opening
  those screens saw empty lists or had saves rejected.

  ## Change
  One extra permissive policy, "Admins have full access", on every table in
  `public` that has row level security enabled. Permissive policies are OR-ed,
  so this only ever adds access for admins; nobody else's access changes.

  The role is read through `public.current_user_role()` (from profiles.role,
  which users cannot edit themselves), never from JWT user_metadata, which they
  can. The function is (re)declared here with the same definition as migration
  20260923120000 so this file also applies cleanly on its own.

  Tables created later need their own admin policy, or a re-run of this file.
*/

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, anon, service_role;

DO $$
DECLARE
  t       record;
  v_count int := 0;
BEGIN
  FOR t IN
    SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relrowsecurity
     ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admins have full access" ON public.%I', t.tablename);
    EXECUTE format(
      'CREATE POLICY "Admins have full access" ON public.%I
         AS PERMISSIVE FOR ALL TO authenticated
         USING ((SELECT public.current_user_role()) = ''admin'')
         WITH CHECK ((SELECT public.current_user_role()) = ''admin'')',
      t.tablename);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'admin_full_access: added "Admins have full access" to % tables', v_count;
END $$;
