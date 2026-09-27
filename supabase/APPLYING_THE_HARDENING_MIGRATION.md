# Applying `20260923120000_harden_role_authorization.sql`

Runbook for whoever owns the Supabase project behind this app. It closes three
privilege-escalation paths, so it is worth doing carefully rather than quickly.

## Why it exists

Before this migration, **any authenticated user could make themselves an admin**,
three different ways:

1. 42 of the RLS policies authorized off `auth.jwt()->'user_metadata'->>'role'`.
   `user_metadata` is writable by the user it belongs to
   (`supabase.auth.updateUser({ data: { role: 'admin' } })`), so that claim proved
   nothing.
2. `handle_new_user()` copied `raw_user_meta_data->>'role'` into `profiles.role`,
   so `signUp({ options: { data: { role: 'admin' } } })` minted an admin outright.
3. The admin edge functions held the service-role key without checking their
   caller, and took `role` straight from the request body.

It also fixes a live bug in the other direction: a genuine admin whose JWT
metadata was stale was being *denied*. Migration
`20260430055539_fix_order_items_select_policy_use_profiles.sql` was chasing that
symptom.

## Order matters

**Deploy the edge functions BEFORE applying the migration.**

The old `admin-create-user` never wrote `profiles.role` — it put the role in
`user_metadata` and let the trigger copy it across. This migration makes that
trigger always assign `'customer'`. So if the migration lands first, every
user an admin creates silently becomes a customer until the functions are updated.

The reverse order is safe: the new functions set `profiles.role` explicitly, which
works whether the old or new trigger is in place.

```bash
# 1. Functions first
supabase functions deploy admin-create-user
supabase functions deploy admin-update-user
supabase functions deploy create-initial-users
supabase functions deploy archive-completed-orders

# 2. Secrets they now require (see SETUP_GUIDE.md for the full table)
supabase secrets set SEED_SECRET=... SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=...
supabase secrets set ARCHIVE_JOB_SECRET=...
supabase secrets set ALLOWED_ORIGIN=https://your-app-origin

# 3. Then the migration
supabase db push
```

## Pre-flight: check nobody gets locked out

Run this FIRST, in the SQL editor. This is the one that matters — authorization
moves from `user_metadata.role` to `profiles.role`, so anyone whose two values
disagree will see their access change.

```sql
select
  p.email,
  p.role                                as profiles_role_after,
  u.raw_user_meta_data->>'role'         as metadata_role_before,
  case
    when (u.raw_user_meta_data->>'role') = 'admin' and coalesce(p.role,'') <> 'admin'
      then 'LOSES admin — confirm this account should not be an admin'
    when coalesce(p.role,'') = 'admin' and coalesce(u.raw_user_meta_data->>'role','') <> 'admin'
      then 'GAINS admin — this is the stale-JWT bug being fixed'
    else 'role changes'
  end as effect
from public.profiles p
join auth.users u on u.id = p.id
where coalesce(p.role, '') <> coalesce(u.raw_user_meta_data->>'role', '')
order by 4, 1;
```

Any row reading **LOSES admin** is an account that is currently an admin only
because of the forgeable claim. If it is a legitimate admin, fix it before
applying:

```sql
update public.profiles set role = 'admin' where email = '<that address>';
```

Confirm the starting state too — 42 is expected here, and 0 after:

```sql
select count(*) as policies_reading_user_metadata
from pg_policies
where schemaname = 'public'
  and (coalesce(qual,'') like '%user_metadata%'
       or coalesce(with_check,'') like '%user_metadata%');
```

## Applying it

`supabase db push`, or paste the migration into the SQL editor. It is safe to
re-run: a second run reports `repointed 0 policies` and changes nothing.

It is also self-verifying. It reads each policy back from `pg_policies` and
substitutes only the role expression, so each policy's own logic is preserved
verbatim. If it meets an expression it does not recognize it raises and the whole
migration rolls back rather than leaving policies half-rewritten — a failure here
means nothing was changed, not that the database is stuck midway.

## Post-apply verification

```sql
-- Expect: 0
select count(*) from pg_policies where schemaname='public'
  and (coalesce(qual,'')||coalesce(with_check,'')) like '%user_metadata%';

-- Expect: 42
select count(*) from pg_policies where schemaname='public'
  and (coalesce(qual,'')||coalesce(with_check,'')) like '%current_user_role%';

-- Expect: the helper exists
select to_regprocedure('public.current_user_role()') is not null as helper_installed;

-- Expect: 'customer', never 'admin' — signup can no longer choose its own role
select prosrc like '%''customer''%' as trigger_forces_customer
from pg_proc where proname = 'handle_new_user';
```

Then confirm in the app that an admin can still manage users, items and branches,
and that a customer account still sees only its own orders.

## Rollback

Restoring the old behaviour means reinstating the forgeable claim, so prefer
fixing forward. If you must, the previous definitions are in
`20251030080009_optimize_rls_policies_with_select_subqueries.sql` (the policies)
and `20251009065847_fix_profiles_rls_policies.sql` (the trigger).

## Also outstanding

`Ss@211251` was committed to this repository's public history as the seeded admin
password for `admin@spicymeal.com.sa`. **Rotate it in Authentication → Users.**
Removing it from the working tree does not unpublish it.
