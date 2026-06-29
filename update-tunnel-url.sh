#!/bin/bash
# AIMAN Static Site - Tunnel URL Auto-Update
# Runs every 5 minutes, updates index.html if tunnel URL changes

INDEX_FILE="/home/ubuntu/aiman-checker/index.html"
LAST_URL_FILE="/tmp/last_tunnel_url.txt"
LOG_FILE="/var/log/aiman-tunnel-update.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Get current tunnel URL from cloudflared process
CURRENT_URL=$(grep -oP 'https://[\w-]+\.trycloudflare\.com' /tmp/cloudflared.log 2>/dev/null | tail -1)

if [ -z "$CURRENT_URL" ]; then
    # Try to extract from running process
    CURRENT_URL=$(ps aux | grep cloudflared | grep -oP 'https://[\w-]+\.trycloudflare\.com' | head -1)
fi

if [ -z "$CURRENT_URL" ]; then
    log "ERROR: Could not find tunnel URL"
    exit 1
fi

# Check if URL changed
LAST_URL=$(cat "$LAST_URL_FILE" 2>/dev/null || echo "")

if [ "$CURRENT_URL" = "$LAST_URL" ]; then
    log "URL unchanged: $CURRENT_URL"
    exit 0
fi

log "URL changed: $LAST_URL → $CURRENT_URL"

# Update index.html
if [ -f "$INDEX_FILE" ]; then
    # Replace old URL with new URL
    sed -i "s|https://[\w-]*\.trycloudflare\.com|$CURRENT_URL|g" "$INDEX_FILE"
    
    # Save new URL
    echo "$CURRENT_URL" > "$LAST_URL_FILE"
    
    log "Updated index.html with new tunnel URL"
    
    # Trigger Vercel deploy
    DEPLOY_HOOK="https://api.vercel.com/v1/integrations/deploy/prj_eGkBmYuNSpc6HCFq8D7z1wt77G1K/mWcSJd5xKP"
    curl -s -X POST "$DEPLOY_HOOK" > /dev/null
    
    if [ $? -eq 0 ]; then
        log "✓ Vercel deploy triggered"
    else
        log "✗ Vercel deploy failed"
    fi
else
    log "ERROR: index.html not found"
    exit 1
fi