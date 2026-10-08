# Production Deployment and Updates Guide

This guide documents the server architecture, deployment procedures, database migration runbook, and operational lessons learned for the Clinic Platform live environment.

---

## 1. Environment & Architecture Overview

```
                      Internet / Client Browsers
                                  │
                                  ▼
                    Cloudflare Tunnel (Edge CDN)
                     clinic.sititsolutions.com
                                  │
                                  ▼
           Internal Linux Server (192.168.100.201)
                                  │
                                  ▼
                    Nginx (Reverse Proxy :8085)
                   /                         \
           Static Web SPA                    Backend API
        (location /)                     (location /api/)
              │                                   │
              ▼                                   ▼
    apps/web/dist (Vite)                PM2: clinic-api (:3085)
                                                  │
                                                  ▼
                                      PostgreSQL 18.4 (:5432)
                                       Database: `clinic`
```

### Server Specifications
| Component | Details |
|---|---|
| **Host IP** | `192.168.100.201` |
| **SSH User** | `sitadmin` (Sudo access) |
| **Public Domain** | `https://clinic.sititsolutions.com` |
| **Deployment Directory** | `/var/www/clinic.sititsolutions.com` |
| **Nginx Port** | `8085` (`/etc/nginx/sites-available/clinic.sititsolutions.com`) |
| **Backend API** | NestJS/Fastify running under PM2 as `clinic-api` on port `3085` |
| **Database** | PostgreSQL 18.4 on `127.0.0.1:5432`, DB: `clinic` |
| **Node.js / PM** | Node.js v25+ with `pnpm` |

---

## 2. Directory Layout & Configuration

### On Remote Server (`/var/www/clinic.sititsolutions.com`)
```
/var/www/clinic.sititsolutions.com/
├── apps/
│   ├── api/
│   │   ├── .env                    # Production environment variables
│   │   ├── dist/                   # Compiled backend output (main.js)
│   │   └── src/
│   └── web/
│       ├── dist/                   # Built production static assets (index.html, assets/*)
│       └── src/
├── packages/
│   ├── contracts/
│   ├── db/
│   └── ui/
├── pnpm-workspace.yaml
└── package.json
```

### Backend `.env` (`apps/api/.env`)
```bash
NODE_ENV=production
PORT=3085
DATABASE_URL_APP=postgres://kpagarigan:P%40ssw0rd@127.0.0.1:5432/clinic
CORS_ORIGIN=https://clinic.sititsolutions.com
JWT_SECRET=supersecretproductionkey1234567890
DEV_EXPOSE_RESET_TOKEN=false
```

### Nginx Site Configuration (`/etc/nginx/sites-available/clinic.sititsolutions.com`)
```nginx
server {
    listen 8085;
    server_name clinic.sititsolutions.com localhost;

    root /var/www/clinic.sititsolutions.com/apps/web/dist;
    index index.html;

    # Client-side routing SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Reverse proxy for API requests
    location /api/ {
        proxy_pass http://127.0.0.1:3085/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 3. Step-by-Step Update & Deployment Runbook

### Option A: Automated Deployment via Tooling Script
From the local repository, run:
```powershell
node tooling/scripts/deploy-remote.mjs
```
*(This script packages changed sources, uploads to the server, runs migrations, executes builds, and restarts PM2 + Nginx automatically.)*

---

### Option B: Manual Step-by-Step Deployment

#### Step 1: Connect to Server
```bash
ssh sitadmin@192.168.100.201
cd /var/www/clinic.sititsolutions.com
```

#### Step 2: Synchronize Source Code
Sync updated files (via git pull or rsync/scp from local):
```bash
# Example if using git:
git pull origin main

# Install any newly added workspace dependencies:
pnpm install --frozen-lockfile
```

#### Step 3: Run Database Migrations (If Schema Changed)
```bash
DATABASE_URL_MIGRATOR="postgres://kpagarigan:P%40ssw0rd@127.0.0.1:5432/clinic" \
CLINIC_DATABASE_URL="postgres://kpagarigan:P%40ssw0rd@127.0.0.1:5432/clinic" \
node packages/db/scripts/migrate.mjs up
```

If permissions or catalogue data changed, re-sync permissions:
```bash
DATABASE_URL_MIGRATOR="postgres://kpagarigan:P%40ssw0rd@127.0.0.1:5432/clinic" \
node packages/db/scripts/seed-permissions.mjs
```

#### Step 4: Build Backend & Frontend
```bash
# Build contracts first if schema/types changed
pnpm --filter @clinic/contracts build

# Build API (NestJS/Fastify)
pnpm --filter @clinic/api build

# Build Web (Vite React SPA)
pnpm --filter @clinic/web build
```

#### Step 5: Restart API & Reload Nginx
```bash
# Restart PM2 process
pm2 restart clinic-api --update-env

# Reload Nginx (for new routing or proxy tweaks)
echo 'P@ssw0rd' | sudo -S systemctl reload nginx
```

---

## 4. Operational Insights & Critical Gotchas

### Gotcha 1: Hostname Resolution & Missing Sidebar Navigation
- **Symptom**: User logs into the tenant dashboard, but only `SYSTEM` appears in the sidebar. All operational sections (`Workspace`, `Clinical`, `Pharmacy`, `Lab`, `Supply`, `Billing`, `Admin`, `Compliance`) disappear.
- **Root Cause**:
  `TenantContextGuard` cross-checks the authenticated user's tenant against the domain extracted by `slugFromHost(request.hostname)`.
  When the public domain is `clinic.sititsolutions.com`, the first label is `"clinic"`.
  If `"clinic"` is not in the `RESERVED` set, `slugFromHost` mistakenly interprets `"clinic"` as a tenant slug, returning `403 TENANT_MISMATCH` on `GET /api/v1/auth/session`.
  When `/auth/session` fails with 403, `PermissionsContext` catches the error and clears all module entitlements to `[]`, causing `MainLayout` to hide every module-gated navigation group.
- **Permanent Solution**:
  In [`apps/api/src/auth/tenant-resolver.service.ts`](file:///d:/clinic/apps/api/src/auth/tenant-resolver.service.ts), ensure base domain hostnames (`clinic`, `platform`, `portal`, `admin`, `api`, `app`) remain in `RESERVED`:
  ```typescript
  const RESERVED = new Set(["www", "api", "app", "admin", "clinic", "platform", "portal", "127", "0"]);
  ```

### Gotcha 2: Tenant Module Entitlements
- When provisioning new tenants in the Platform Admin Portal (`/platform/tenants/new`), ensure all intended modules are selected.
- If modules were omitted during initial creation, insert them into `tenant_modules` with `status = 'ENABLED'` and `seed_status = 'SEEDED'`:
  ```sql
  SET ROLE clinic_owner;
  SELECT set_config('app.tenant_id', '<tenant_uuid>', true);

  INSERT INTO tenant_modules (tenant_id, module, status, seed_status)
  VALUES
    ('<tenant_uuid>', 'pharmacy', 'ENABLED', 'SEEDED'),
    ('<tenant_uuid>', 'supply', 'ENABLED', 'SEEDED'),
    ('<tenant_uuid>', 'compliance', 'ENABLED', 'SEEDED')
  ON CONFLICT (tenant_id, module) DO UPDATE SET status = 'ENABLED', seed_status = 'SEEDED';
  ```

### Gotcha 3: Starter Tenant Credentials
- Starter admin email pattern: `admintenant@<slug>.emr`
- Default bootstrap password: `DemoPassw0rd!2026`
- Role assigned: `tenant_admin` (holding all tenant admin permissions filtered by Segregation of Duties).

---

## 5. Post-Deployment Verification Checklist

After deploying any update to production, verify the following health checks:

| Check | Command / URL | Expected Result |
|---|---|---|
| **API Process** | `pm2 status clinic-api` | `online`, restart count stable |
| **API Smoke Test** | `curl http://127.0.0.1:3085/api/v1/ping` | `{"status":"ok", ...}` |
| **Nginx Port 8085** | `curl http://127.0.0.1:8085/index.html` | HTTP 200 with HTML contents |
| **Public HTTPS Health** | `curl https://clinic.sititsolutions.com/api/v1/health` | HTTP 200 `{"status":"ok"}` |
| **Auth Session Check** | Sign in as `admintenant@<slug>.emr` | All 8 sidebar navigation groups visible, 10 modules enabled |
| **Console Errors** | Browser DevTools Network tab | No 403 `TENANT_MISMATCH` on `/api/v1/auth/session` |
