#!/bin/bash
TOKEN="${GITHUB_TOKEN}"
USERNAME="EVSDELAT"
REPO="Automatic-Search-for-Food-Delivery-Coupons"

echo "Setting up git..."
rm -f .git/index.lock

git config user.email "deploy@replit.com"
git config user.name "$USERNAME"

git remote remove github 2>/dev/null || true
git remote add github "https://$USERNAME:$TOKEN@github.com/$USERNAME/$REPO.git"

git add -A
git commit -m "Deploy: food delivery coupon finder" 2>/dev/null || echo "Nothing new to commit"

echo "Pushing to GitHub..."
git push github main --force

echo ""
echo "Done! Check: https://github.com/$USERNAME/$REPO"
