#!/usr/bin/env bash
# deploy.sh — Safe deploy for HOUND HUD
# Usage: bash deploy.sh <branch-to-backup>
#   1. Creates a git backup branch
#   2. Runs next build (fails on type errors)
#   3. Verifies page loads with expected content
#   4. Only proceeds if all checks pass

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

BRANCH_BACKUP="${1:-backup-before-deploy-$(date +%s)}"

echo "=== HOUND HUD Safe Deploy ==="
echo ""

# Step 1: Backup current HEAD to a branch
echo "[1/5] Creating backup branch: $BRANCH_BACKUP"
git branch -f "$BRANCH_BACKUP" HEAD 2>/dev/null || git branch "$BRANCH_BACKUP" HEAD
echo "  ✓ Backup at: $BRANCH_BACKUP"

# Step 2: Run next build with type checking
echo ""
echo "[2/5] Running build with type checking..."
if ! ./node_modules/.bin/next build 2>&1; then
    echo "  ✗ BUILD FAILED — reverting to backup..."
    git checkout -f "$BRANCH_BACKUP" -- . 2>/dev/null || true
    echo "  ✗ ABORTED — checked $BRANCH_BACKUP for safe state"
    exit 1
fi

# Step 3: Verify build output exists
echo ""
echo "[3/5] Verifying build output..."
CHUNK_COUNT=$(find .next/static/chunks -name "*.js" 2>/dev/null | wc -l)
if [ "$CHUNK_COUNT" -lt 1 ]; then
    echo "  ✗ No build chunks found — aborting"
    git checkout -f "$BRANCH_BACKUP" -- . 2>/dev/null || true
    exit 1
fi
echo "  ✓ Build output: $CHUNK_COUNT chunk files"

# Step 4: Verify page loads with expected content
echo ""
echo "[4/5] Verifying page content..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
    echo "  ✗ Page HTTP $HTTP_CODE — aborting"
    git checkout -f "$BRANCH_BACKUP" -- . 2>/dev/null || true
    exit 1
fi

PAGE_CONTENT=$(curl -s http://localhost:3000/ 2>/dev/null)
if echo "$PAGE_CONTENT" | grep -q "HOUND"; then
    echo "  ✓ Page contains 'HOUND' (valid content)"
else
    echo "  ✗ Page missing expected content — aborting"
    git checkout -f "$BRANCH_BACKUP" -- . 2>/dev/null || true
    exit 1
fi

# Step 5: Commit the deploy
echo ""
echo "[5/5] Committing deploy..."
git add -A
git commit -m "Deploy: $(date +%Y-%m-%dT%H:%M:%S)" --allow-empty 2>/dev/null || echo "  (no changes to commit)"
echo "  ✓ Deploy complete"

echo ""
echo "=== Deploy successful ==="
echo "Backup branch: $BRANCH_BACKUP"
echo "Rollback: git checkout -f $BRANCH_BACKUP -- ."
