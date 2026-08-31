# RouteRest database

This folder holds the database schema and setup notes. No ORM or migration
tool is wired up yet; `schema.sql` is the schema itself, applied directly
with `psql`. That is a deliberate, minimal starting point, add Alembic or
another migration tool when the schema starts changing often enough to
need one.

## What is in here

- `schema.sql` — reference data only: rest areas, NHVR fatigue rules,
  vehicle specs, and the jurisdiction/source-file lookup tables. See the
  comments at the top of that file for the design decisions behind it.
- `.env.example` — copy to `.env` and adjust if your local credentials
  differ from the defaults below.

**No journey data lives here, on purpose.** Departure time, destination,
fuel level, the rest plan, each driver's elapsed work/rest time, all of
that is personal to one user's trip and per the project brief must stay
on that user's own device (frontend local storage), never in this
database. "Continue the journey on another phone" (US 1.4) is solved with
a QR code the first phone generates and the second phone scans, a direct
handoff the backend never sees. If you're building the frontend and
looking for where journey state should be stored, it's not here.

## First-time local setup (native PostgreSQL, no Docker)

1. Install PostgreSQL 17 from the official EDB installer:
   https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
   Set a password for the `postgres` superuser when prompted, keep the
   default port (5432).
2. When the installer offers to launch **Stack Builder**, accept. In Stack
   Builder, pick your PostgreSQL 17 install, then under **Spatial
   Extensions** check **PostGIS 3.6 Bundle for PostgreSQL 17** and install
   it. This adds the PostGIS extension matched to your PostgreSQL version.
3. Copy the environment template:
   ```
   cp .env.example .env
   ```
   and fill in the password you set in step 1.
4. Create the database (PowerShell; adjust the path if your install
   location differs):
   ```powershell
   & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "CREATE DATABASE routerest;"
   ```
5. Apply the schema (this also enables the PostGIS extension, it is built
   into the file):
   ```powershell
   & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d routerest -f schema.sql
   ```
6. Check it worked:
   ```powershell
   & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d routerest -c "\dt"
   ```
   You should see 6 tables: `source_file`, `jurisdiction`, `fatigue_rule`,
   `vehicle_model`, `rest_area`, and `spatial_ref_sys` (created
   automatically by PostGIS, confirming the extension loaded). Verified
   working on 31 August 2026.

## Browsing the database

[DBeaver](https://dbeaver.io/) (free) is a good GUI alternative to typing
`psql` commands: connect to `localhost:5432`, database `routerest`, using
the `postgres` user and the password from step 1.

## Day to day

- To re-apply the schema after editing it, drop and recreate the database
  first, since `schema.sql` does not handle already-existing tables:
  ```powershell
  & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "DROP DATABASE routerest;"
  & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "CREATE DATABASE routerest;"
  & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d routerest -f schema.sql
  ```

## Migrating off this local install later

The team's plan is local first, then migrate to a hosted database once
ready. `schema.sql` is plain, portable SQL with no dependency on this local
setup, it runs unchanged against any PostgreSQL 16 or 17 instance with the
PostGIS extension available (most managed Postgres hosts, including
Supabase and Neon, support this). When that time comes, the only things
that change are the connection details (host, port, credentials), which
the backend should read from environment variables rather than have
hardcoded, so switching targets is a config change, not a code change.
