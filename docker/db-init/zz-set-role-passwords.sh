#!/bin/sh
set -e
psql -v ON_ERROR_STOP=1 --no-password --no-psqlrc -U supabase_admin -d "$POSTGRES_DB" <<-EOSQL
  ALTER ROLE authenticator WITH PASSWORD '$AUTHENTICATOR_DB_PASSWORD';
  ALTER ROLE supabase_auth_admin WITH PASSWORD '$AUTH_DB_PASSWORD';
  ALTER ROLE service_role WITH LOGIN PASSWORD '$SERVICE_ROLE_DB_PASSWORD';
  DO \$\$
  DECLARE
    r record;
  BEGIN
    FOR r IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'auth'
    LOOP
      EXECUTE format('ALTER FUNCTION %s OWNER TO supabase_auth_admin', r.sig);
    END LOOP;
  END
  \$\$;
EOSQL
