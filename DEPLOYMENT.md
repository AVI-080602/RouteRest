# Deploying RouteRest to AWS

This walks through hosting all three pieces: the Postgres/PostGIS
database on RDS, the FastAPI backend on EC2, and the Next.js frontend on
AWS Amplify Hosting. Written for a team using AWS credits, not chasing
the absolute cheapest option, but not wasteful either, small instance
sizes throughout are enough for a capstone demo.

Do these in order, each phase depends on the one before it.

## Before you start

- An AWS account with your credits applied.
- A domain name (or a subdomain of one you already control). This is
  required, not optional: Amplify serves the frontend over HTTPS, and
  browsers block an HTTPS page from calling a plain-HTTP API (mixed
  content), so the backend needs real HTTPS too, which needs a domain.
  A cheap domain from Route 53 or any registrar works; you only need one
  subdomain pointed at the backend, e.g. `api.yourdomain.com`.
- Your local `backend/db/.env` password and the schema files in
  `backend/db/` (already built, see that folder's own README for what
  each one does).

---

## Phase 1: RDS (the database)

1. AWS Console → RDS → **Create database**.
2. Engine: **PostgreSQL** (a recent version, 16 or 17, matching what we
   used locally, so `schema.sql` behaves identically).
3. Templates: **Free tier** if your account is eligible, otherwise
   **Dev/Test**.
4. DB instance size: `db.t3.micro` or `db.t4g.micro` is enough, this
   holds reference data only (rest areas, fatigue rules, vehicle specs),
   nothing personal or high-volume.
5. DB instance identifier: `routerest-db`.
6. Master username: `postgres` (or your choice, just remember it).
7. Master password: generate one, save it somewhere real, not in this
   repo, not in chat.
8. Public access: **No**. The database should only be reachable from
   your VPC (specifically, the EC2 instance in Phase 2), never directly
   from the internet.
9. VPC security group: create a new one, name it `routerest-db-sg`. You
   will add a rule to it after Phase 2 exists (allow inbound port 5432
   from the EC2 instance's security group, not from "anywhere").
10. Initial database name: `routerest`.
11. Create the database. It takes a few minutes.
12. Once available, copy its **endpoint** (looks like
    `routerest-db.xxxxxxxxxx.ap-southeast-2.rds.amazonaws.com`), you'll
    need it for both loading the schema and configuring the backend.

### Loading the schema

The RDS instance isn't publicly reachable yet (by design), so temporarily
allow your own IP to run the one-time setup, then remove that rule:

1. In the `routerest-db-sg` security group, add an inbound rule:
   PostgreSQL (port 5432), source = **My IP**.
2. From your own machine, run the same commands you already used
   locally, just pointed at the RDS endpoint instead of `localhost`:
   ```powershell
   $env:PGHOST = "routerest-db.xxxxxxxxxx.ap-southeast-2.rds.amazonaws.com"
   & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -h $env:PGHOST -U postgres -d routerest -f "backend\db\schema.sql"
   & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -h $env:PGHOST -U postgres -d routerest -f "backend\db\seed_fatigue_rules.sql"
   & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -h $env:PGHOST -U postgres -d routerest -f "backend\db\seed_vehicle_models.sql"
   ```
3. To load `rest_area` from the live NFDH API, point `sync_rest_areas.py`
   at RDS instead of local Postgres: temporarily edit its `.env` copy (or
   pass the RDS host as `POSTGRES_HOST`) and run it once from your
   machine the same way you ran it locally.
4. Remove the "My IP" rule from `routerest-db-sg` once this is done. The
   database should end up reachable only from the backend, never from
   your laptop or the open internet.

---

## Phase 2: EC2 (the backend)

1. AWS Console → EC2 → **Launch instance**.
2. Name: `routerest-backend`.
3. AMI: **Ubuntu 24.04 LTS**.
4. Instance type: `t3.micro` or `t3.small`, this is a small API, not a
   heavy workload.
5. Key pair: create one, download the `.pem` file, this is how you'll
   SSH in, keep it safe, it's not something to lose or share.
6. Network settings: create a new security group `routerest-backend-sg`
   allowing inbound SSH (port 22, source = your IP) and HTTP (port 8000
   or your chosen backend port, source = anywhere, since the frontend
   calls it from users' browsers, not from a fixed IP). You will add
   HTTPS (443) once the domain and certificate exist in Phase 3.
7. Launch the instance. Once running, note its **public IP**.
8. Go back to `routerest-db-sg` (the database's security group, Phase 1)
   and add an inbound rule: PostgreSQL (5432), source =
   `routerest-backend-sg`. This is the real, permanent access rule, only
   the backend can reach the database.

### Deploying the code

SSH into the instance (`ssh -i your-key.pem ubuntu@<public-ip>`), then:

```bash
# Install uv (the same tool used locally to run the backend)
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env

# Clone the repo (a deploy key or a personal access token is the usual
# way to give a server read access to a private repo, set that up in
# GitHub first if RouteRest is private)
git clone https://github.com/AVI-080602/RouteRest.git
cd RouteRest/backend
uv sync
```

Create the real environment file (never committed, this is the
production equivalent of `backend/db/.env`):

```bash
sudo mkdir -p /etc/routerest
sudo tee /etc/routerest/backend.env <<'EOF'
POSTGRES_HOST=routerest-db.xxxxxxxxxx.ap-southeast-2.rds.amazonaws.com
POSTGRES_PORT=5432
POSTGRES_DB=routerest
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-real-rds-password
ALLOWED_ORIGINS=https://your-amplify-domain-from-phase-4
EOF
sudo chmod 600 /etc/routerest/backend.env
```

Then install the systemd service (already written, see
`deploy/routerest-backend.service` in this repo) so it runs permanently:

```bash
sudo cp ~/RouteRest/deploy/routerest-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now routerest-backend
sudo systemctl status routerest-backend   # should show "active (running)"
```

Test it works: `curl http://<public-ip>:8000/docs` from your own
machine should return the FastAPI docs page.

---

## Phase 3: Domain and HTTPS for the backend

This is the mixed-content fix mentioned at the top.

1. Point a DNS **A record** for your chosen subdomain (e.g.
   `api.yourdomain.com`) at the EC2 instance's public IP. If using Route
   53, this is a hosted zone record; if using another registrar, add the
   A record in their DNS settings instead.
2. Back on the EC2 instance, install nginx as a reverse proxy and certbot
   for a free Let's Encrypt certificate:
   ```bash
   sudo apt update
   sudo apt install -y nginx certbot python3-certbot-nginx
   ```
3. Configure nginx to forward `api.yourdomain.com` to the backend running
   on port 8000 (certbot's interactive setup handles most of this for
   you when you run it against a configured server block).
4. Run `sudo certbot --nginx -d api.yourdomain.com` and follow the
   prompts, it issues a certificate and updates the nginx config to serve
   HTTPS automatically, including auto-renewal.
5. In the `routerest-backend-sg` security group, allow inbound HTTPS
   (443, source = anywhere). You can now remove the direct 8000 rule if
   you'd rather only expose 443 through nginx.
6. Confirm: `https://api.yourdomain.com/docs` should load in a browser
   with a valid certificate.

---

## Phase 4: Amplify (the frontend)

1. AWS Console → Amplify → **Host a web app**.
2. Connect your GitHub account and select the RouteRest repository.
3. App root directory: `frontend/my-app` (Amplify needs to know the
   Next.js app isn't at the repo root).
4. Amplify auto-detects the Next.js build settings, review them, the
   defaults are normally correct.
5. Add an environment variable before deploying: `NEXT_PUBLIC_API_URL` =
   `https://api.yourdomain.com` (the real backend from Phase 3). The
   frontend code already reads this exact variable, see the `API_BASE_URL`
   constant in `newjourney/page.tsx`, so no code change is needed here.
6. Deploy. Amplify builds and hosts the app, giving you a URL like
   `https://main.xxxxxxxxxx.amplifyapp.com` (or your own domain if you
   attach one in Amplify's domain settings).

---

## Phase 5: Wire it together and verify

1. Go back to `/etc/routerest/backend.env` on the EC2 instance and set
   `ALLOWED_ORIGINS` to the real Amplify URL from Phase 4 (if you didn't
   already know it in Phase 2), then:
   ```bash
   sudo systemctl restart routerest-backend
   ```
2. Open the real Amplify URL in a browser, go to `/newjourney`, and run
   through the form exactly like we tested locally. The rest plan should
   come back from the real RDS-backed API over HTTPS, no `localhost`
   involved anywhere.
3. Check the browser console for CORS or mixed-content errors, if
   `ALLOWED_ORIGINS` or the domain setup is wrong, this is where it will
   show up.

## What this does NOT cover

- Auto-scaling, load balancing, or multi-instance backend, one EC2
  instance is enough for a capstone demo, not a real production audience.
- CI/CD (Amplify auto-deploys the frontend on every push to the
  connected branch already; the backend does not auto-deploy on push,
  redeploying it means SSHing in, `git pull`, `sudo systemctl restart
  routerest-backend`, fine for a project at this stage).
- Backups beyond RDS's own automated snapshots (on by default).
