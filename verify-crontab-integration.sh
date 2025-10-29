#!/bin/bash
# ─────────────────────────────────────────────
# PiTasker Crontab Integration Verification Script
# Author: Implementation Team
# Desc.: Automated verification of crontab integration
# Create Date: 2025-10-29
# ─────────────────────────────────────────────

set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "PiTasker Crontab Integration Verification"
echo "========================================="
echo ""

# Check 1: Database schema
echo "Checking database schema..."
if psql -d pitasker -c "\d tasks" 2>/dev/null | grep -q "crontab_id"; then
    echo -e "  ${GREEN}✓${NC} crontab_id column exists"
else
    echo -e "  ${RED}✗${NC} crontab_id column missing"
    exit 1
fi

if psql -d pitasker -c "\d tasks" 2>/dev/null | grep -q "synced_to_crontab"; then
    echo -e "  ${GREEN}✓${NC} synced_to_crontab column exists"
else
    echo -e "  ${RED}✗${NC} synced_to_crontab column missing"
    exit 1
fi

if psql -d pitasker -c "\d tasks" 2>/dev/null | grep -q "is_system_managed"; then
    echo -e "  ${GREEN}✓${NC} is_system_managed column exists"
else
    echo -e "  ${RED}✗${NC} is_system_managed column missing"
    exit 1
fi
echo ""

# Check 2: Crontab access
echo "Checking crontab access..."
if crontab -l &>/dev/null || [ $? -eq 1 ]; then
    echo -e "  ${GREEN}✓${NC} Crontab access confirmed"
else
    echo -e "  ${RED}✗${NC} No crontab access"
    exit 1
fi
echo ""

# Check 3: Count tasks
echo "Checking task counts..."
TOTAL_TASKS=$(psql -d pitasker -t -c "SELECT COUNT(*) FROM tasks;" 2>/dev/null | tr -d ' ' || echo "0")
SYSTEM_MANAGED=$(psql -d pitasker -t -c "SELECT COUNT(*) FROM tasks WHERE is_system_managed=true;" 2>/dev/null | tr -d ' ' || echo "0")
SYNCED=$(psql -d pitasker -t -c "SELECT COUNT(*) FROM tasks WHERE synced_to_crontab=true;" 2>/dev/null | tr -d ' ' || echo "0")
CRONTAB_ENTRIES=$(crontab -l 2>/dev/null | grep -c "PITASKER_ID" || echo "0")

echo "  Total tasks in database: $TOTAL_TASKS"
echo "  System-managed tasks: $SYSTEM_MANAGED"
echo "  Synced tasks: $SYNCED"
echo "  Crontab entries with PITASKER_ID: $CRONTAB_ENTRIES"
echo ""

# Check 4: Sync consistency
echo "Checking sync consistency..."
if [ "$SYNCED" -eq "$CRONTAB_ENTRIES" ]; then
    echo -e "  ${GREEN}✓${NC} Database and crontab are in sync ($SYNCED entries)"
else
    echo -e "  ${YELLOW}⚠${NC} Warning: Database has $SYNCED synced tasks but crontab has $CRONTAB_ENTRIES entries"
    echo "  Consider running 'Sync All' from the UI"
fi
echo ""

# Check 5: API endpoints
echo "Checking API endpoints..."
if curl -s http://localhost:5000/health &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} Server is running"
else
    echo -e "  ${RED}✗${NC} Server not responding on localhost:5000"
    echo "  Start the server with: npm run dev"
fi
echo ""

# Check 6: Build artifacts
echo "Checking build artifacts..."
if [ -f "dist/index.js" ]; then
    echo -e "  ${GREEN}✓${NC} Server build exists"
else
    echo -e "  ${YELLOW}⚠${NC} Server build missing (run: npm run build)"
fi

if [ -d "dist/public" ]; then
    echo -e "  ${GREEN}✓${NC} Client build exists"
else
    echo -e "  ${YELLOW}⚠${NC} Client build missing (run: npm run build)"
fi
echo ""

echo "========================================="
echo -e "${GREEN}Verification complete!${NC}"
echo "========================================="
echo ""

# Exit with success
exit 0
