#!/bin/bash
# Vercel Deploy Hook Auto-Trigger
# Usage: ./deploy.sh

DEPLOY_HOOK_URL="https://api.vercel.com/v1/integrations/deploy/prj_eGkBmYuNSpc6HCFq8D7z1wt77G1K/mWcSJd5xKP"
PROJECT_DIR="/home/ubuntu/aiman-checker"

cd "$PROJECT_DIR"

echo "🚀 Pushing to GitHub..."
git add -A
git commit -m "Auto-deploy: $(date '+%Y-%m-%d %H:%M')"
git push origin master

if [ $? -eq 0 ]; then
    echo "✅ Push successful!"
    echo "⏳ Triggering Vercel deploy..."
    
    # Trigger deploy hook
    curl -s -X POST "$DEPLOY_HOOK_URL" > /dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ Deploy triggered!"
        echo "🔗 Check status: https://vercel.com/junobebe2-ux/aiman-checker/deployments"
    else
        echo "❌ Deploy hook failed"
    fi
else
    echo "❌ Push failed"
fi