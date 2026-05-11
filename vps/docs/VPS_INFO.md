# Hermes AI Agent — VPS Info

## Hostinger VPS Details
| Field         | Value |
|---------------|-------|
| Provider      | Hostinger |
| OS            | Ubuntu 22.04 LTS |
| IP Address    | 76.13.59.204 |
| SSH Port      | 22 |
| SSH User      | hermes |
| SSH Key       | ~/.ssh/hermes_vps_rsa |
| App Directory | /opt/hermes/app |

## Quick Access
```bash
# SSH into VPS
ssh root@76.13.59.204

# Check agent status
pm2 status

# View live logs
pm2 logs hermes-agent

# Restart agent
pm2 restart hermes-agent
```

## Directory Layout on VPS
```
/opt/hermes/
├── app/          ← deployed application code
│   └── .env      ← live credentials (from credentials.env template)
├── screenshots/  ← TradingView chart captures
├── logs/         ← application logs
└── backups/      ← periodic state backups
```

## First-Time Setup
1. Provision VPS on Hostinger (Ubuntu 22.04, min 2 vCPU / 4 GB RAM recommended)
2. Add your SSH public key via Hostinger control panel
3. Copy `vps/credentials/credentials.template.env` → `vps/credentials/credentials.env` and fill in all values
4. Run `bash vps/scripts/setup-vps.sh` on the VPS
5. Run `bash vps/scripts/deploy.sh` from your local machine
