-- Supabase's CREATE EXTENSION event trigger can restore pg_net access after
-- nested installation DDL. Apply revocation in a separate forward migration.
-- No extension install, cron activation, secret or business-data changes.
do $$ begin
 if to_regnamespace('net') is not null then
   revoke all on schema net from public,anon,authenticated,service_role;
   revoke all on all tables in schema net from public,anon,authenticated,service_role;
   revoke all on all functions in schema net from public,anon,authenticated,service_role;
   grant usage on schema net to postgres;
   grant execute on all functions in schema net to postgres;
 end if;
end $$;
