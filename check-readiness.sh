#!/usr/bin/env bash

# YOOSKY STORE - Pre-Deployment Checklist
# Run this script to verify everything is ready

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║         YOOSKY STORE - DEPLOYMENT READINESS CHECKLIST             ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

PASSED=0
FAILED=0

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_file() {
  if [ -f "$1" ]; then
    echo -e "${GREEN}✓${NC} $2"
    ((PASSED++))
  else
    echo -e "${RED}✗${NC} $2 - MISSING: $1"
    ((FAILED++))
  fi
}

check_content() {
  if grep -q "$2" "$1" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} $3"
    ((PASSED++))
  else
    echo -e "${RED}✗${NC} $3 - NOT FOUND in $1"
    ((FAILED++))
  fi
}

check_command() {
  if command -v "$1" &> /dev/null; then
    echo -e "${GREEN}✓${NC} $2 installed"
    ((PASSED++))
  else
    echo -e "${YELLOW}⚠${NC} $2 not found (optional, but recommended)"
    ((FAILED++))
  fi
}

echo "📋 CODE & CONFIGURATION:"
check_file "jsonbin.js" "Database adapter (jsonbin.js)"
check_file "vercel.json" "Vercel config (vercel.json)"
check_file ".env.example" "Environment template (.env.example)"
check_file ".env.local" "Dev environment (.env.local)"
check_file "package.json" "Package configuration (package.json)"
check_content "server.js" "require('dotenv')" "server.js uses dotenv"
check_content "server.js" "require('./jsonbin')" "server.js imports jsonbin"
check_content "package.json" "dotenv" "package.json has dotenv dependency"

echo ""
echo "📚 DOCUMENTATION:"
check_file "QUICK_START.txt" "Quick start guide (30 min)"
check_file "VERCEL_DEPLOYMENT.md" "Complete deployment manual"
check_file "MIGRATION_SUMMARY.md" "Technical migration details"
check_file "DOCS_INDEX.md" "Documentation index"
check_file "README.md" "Main README"

echo ""
echo "🔧 SYSTEM REQUIREMENTS:"
check_command "node" "Node.js"
check_command "npm" "npm package manager"
check_command "git" "Git"

echo ""
echo "📦 SETUP STATUS:"

if [ -f ".env" ]; then
  if grep -q "JSONBIN_API_KEY" ".env" && grep -q "JSONBIN_BIN_ID" ".env"; then
    echo -e "${GREEN}✓${NC} .env configured with JSONBin keys"
    ((PASSED++))
  else
    echo -e "${YELLOW}⚠${NC} .env exists but JSONBin keys not set"
  fi
else
  echo -e "${YELLOW}⚠${NC} .env not created yet (run: cp .env.example .env)"
fi

if [ -d "node_modules" ]; then
  echo -e "${GREEN}✓${NC} node_modules installed"
  ((PASSED++))
else
  echo -e "${YELLOW}⚠${NC} Dependencies not installed (run: npm install)"
fi

echo ""
echo "════════════════════════════════════════════════════════════════════"

TOTAL=$((PASSED + FAILED))
echo ""
echo "📊 SUMMARY: ${GREEN}$PASSED${NC} passed, ${RED}$FAILED${NC} failed (Total: $TOTAL)"

if [ $FAILED -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✅ ALL CHECKS PASSED!${NC}"
  echo ""
  echo "You're ready to deploy. Next steps:"
  echo ""
  echo "1. If .env not configured:"
  echo "   cp .env.example .env"
  echo "   # Edit with JSONBin keys"
  echo ""
  echo "2. Test locally:"
  echo "   npm install"
  echo "   npm start"
  echo ""
  echo "3. Deploy to Vercel:"
  echo "   npm i -g vercel"
  echo "   vercel --prod"
  echo ""
  echo "For detailed guide: read QUICK_START.txt"
  echo ""
else
  echo ""
  echo -e "${RED}⚠ Please fix the issues above before deploying${NC}"
  echo ""
  echo "Common fixes:"
  echo "  - Missing files: Check git status or run setup"
  echo "  - Missing packages: npm install"
  echo "  - .env configuration: cp .env.example .env && edit"
  echo ""
fi

exit $FAILED
