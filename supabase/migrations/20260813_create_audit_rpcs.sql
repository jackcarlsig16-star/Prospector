-- Prospector - RPCs backing scripts/live-audit.js's `schema` and `rls` commands
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- PostgREST doesn't expose pg_policies or information_schema directly, and
-- this environment has no raw Postgres connection - only the REST client.
-- These two SECURITY DEFINER functions are the standard workaround: thin,
-- read-only introspection wrappers, callable via supabase.rpc(), locked to
-- service_role only (schema/policy introspection is not something the anon
-- key should be able to do for arbitrary tables).

create or replace function public.audit_table_schema(target_table text)
returns table(
  column_name text,
  data_type text,
  is_nullable text,
  column_default text,
  fk_target text
)
language sql
security definer
set search_path = public
as $$
  select
    c.column_name::text,
    c.data_type::text,
    c.is_nullable::text,
    c.column_default::text,
    (
      select ccu.table_name || '.' || ccu.column_name
      from information_schema.key_column_usage kcu
      join information_schema.table_constraints tc
        on tc.constraint_name = kcu.constraint_name
       and tc.constraint_type = 'FOREIGN KEY'
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
      where kcu.table_schema = 'public'
        and kcu.table_name = target_table
        and kcu.column_name = c.column_name
      limit 1
    )::text as fk_target
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = target_table
  order by c.ordinal_position;
$$;

create or replace function public.audit_table_policies(target_table text)
returns table(
  policyname text,
  cmd text,
  roles text,
  qual text,
  with_check text
)
language sql
security definer
set search_path = public
as $$
  select
    p.policyname::text,
    p.cmd::text,
    p.roles::text,
    p.qual::text,
    p.with_check::text
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = target_table;
$$;

revoke all on function public.audit_table_schema(text)   from public, anon, authenticated;
revoke all on function public.audit_table_policies(text) from public, anon, authenticated;
grant execute on function public.audit_table_schema(text)   to service_role;
grant execute on function public.audit_table_policies(text) to service_role;
