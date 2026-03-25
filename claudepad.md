# Session Summaries

## 2026-02-26T05:30Z — VPS Migration: OVH2 Setup
**Phase 1 (SSH):** DONE. Key: `~/.ssh/ovh2_vps`, config alias `ovh2`. Password changed to `Ovh2Migr8tion2026x` (saved in .env). Password auth disabled.
**Phase 2 (Provisioning):** DONE. Node 20 + pnpm, Go 1.23.6, Docker + registry (127.0.0.1:5555), Caddy, UFW (22,80,443,26656), ocp user, /opt/ocp, /opt/dwellhome, /opt/cliaas dirs. Rebooted to kernel 6.14.0-37.
**Phase 3 (Caddyfile):** DONE. Unified Caddyfile at /etc/caddy/Caddyfile with `tls internal`. flip-tls.sh and activate-services.sh created.
**Phase 4 (Data Migration):** DONE. dwellhome site, CLIaaS data+env, OCP chain (94MB)+config+env+secrets, answerhub pg dump + Active Storage tarball all transferred. Old server can SSH to new via ubuntu key.
**Phase 5 (Deploy Scripts):** DONE.
  - OCP deploy-vps.sh: Modified with DEPLOY_TARGETS loop, proxy detection (caddy/nginx), NO_RESTART flag.
  - Zachathon deploy_vps.sh: Added Caddy detection in proxy mode switch.
  - dwellhome deploy script: Added SKIP_PROXY env var.
  - Kamal configs: Created deploy.ovh2.yml for both socio-persona and answerhub with `proxy: false` + `ssh.keys`.
  - All services deployed and verified via Caddy (200):
    - discordwell.com (dwellhome static)
    - discordwell.com/ocp/ (OCP SPA)
    - cliaas.com/api/health (CLIaaS)
    - persona.discordwell.com (socio-persona Docker)
    - cornerstonesaas.com (answerhub Docker + Postgres)
  - answerhub: DB restored from pg_dump, Active Storage volume restored.
  - OCP services: files deployed but not started (awaiting DNS flip).

**Architecture decision:** Caddy only (no kamal-proxy). `proxy: false` on server roles in Kamal deploy.ovh2.yml configs.

# Key Findings

- OVH2 VPS: vps-05030f8b.vps.ovh.us, 15.204.59.61, Ubuntu 25.04, 6 vCores, 12GB RAM, 100GB storage, Oregon US-WEST-OR
- Kamal 2.10.1 `proxy: false` goes on the SERVER ROLE, not top-level: `servers.web.proxy: false`
- Kamal binary: `/opt/homebrew/opt/ruby@3.3/bin/ruby /opt/homebrew/lib/ruby/gems/3.3.0/bin/kamal`
- Old server ubuntu key already authorized on new server for server-to-server rsync
- answerhub Dockerfile EXPOSE 80 (Thruster), so publish mapping is `127.0.0.1:3000:80`
- OCP web currently served via python3 -m http.server on port 8065, but on new server Caddy serves /ocp/ directly from /opt/ocp/web/dist
- Kamal deploy to ovh2 requires stopping the remote Docker registry first (`docker stop registry`) because Kamal's port forwarding needs port 5555. Restart after deploy: `docker start registry`.
- Kamal `ssh.keys: ["~/.ssh/ovh2_vps"]` needed in deploy.ovh2.yml since Kamal connects to IP not SSH alias
