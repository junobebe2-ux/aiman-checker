#!/bin/bash
# Deploy AIMAN CHECKER ke Cloudflare Pages (free, unlimited deploy, URL permanen)
# Usage: bash deploy-cf.sh
set -e

SRC=/home/ubuntu/aiman-checker
DEPLOY=/tmp/cf-deploy

rm -rf "$DEPLOY"
mkdir -p "$DEPLOY/functions"

# Static pages
cp "$SRC"/index.html "$SRC"/admin.html "$SRC"/dashboard.html "$SRC"/login.html "$SRC"/pricing.html "$DEPLOY/" 2>/dev/null || true

# Pages Functions
cp "$SRC"/functions/*.js "$DEPLOY/functions/"

# Deploy (token from file to avoid inline redaction issues)
cd "$DEPLOY"
set -a
. <(printf 'CLOUDFLARE_API_TOKEN=%s\nCLOUDFLARE_ACCOUNT_ID=a65c45b9816bf5212168bd794c79d008\n' "$(cat /home/ubuntu/.config/cf_token.txt)")
set +a

npx wrangler pages deploy . --project-name aiman-checker --branch main --commit-dirty=true

echo ""
echo "Done. Live: https://aiman-checker.pages.dev"
