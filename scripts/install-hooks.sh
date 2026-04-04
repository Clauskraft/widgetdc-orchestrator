#!/bin/sh
# Install adoption gate git hooks (pre-commit + pre-push)
# Run once after cloning: bash scripts/install-hooks.sh

git config core.hooksPath scripts/git-hooks
chmod +x scripts/git-hooks/pre-commit
chmod +x scripts/git-hooks/pre-push

echo "✅ Git hooks installed:"
echo "   pre-commit: fast adoption gate (registry, tests, docs)"
echo "   pre-push:   full CI gate (build, ABI, all 5 checks)"
echo ""
echo "Bypass if needed: git commit --no-verify or git push --no-verify"
