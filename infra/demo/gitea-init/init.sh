#!/bin/bash
# Gitea init — runs once after Gitea starts
sleep 10
gitea admin user create --username anvay --password anvaypassword --email admin@demo.com --must-change-password=false 2>/dev/null || true
su git -c "gitea admin user create --username anvay --password anvaypassword --email admin@demo.com --must-change-password=false 2>/dev/null || true"
# Create org and repo via API
TOKEN=$(curl -s -X POST http://gitea:3000/api/v1/users/anvay/tokens -u anvay:anvaypassword -H 'Content-Type: application/json' -d '{"name":"demo"}' | grep -o '"sha1":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "$TOKEN" ] && TOKEN="demo-token-gitea-anvay"
curl -s -X POST http://gitea:3000/api/v1/orgs -H "Authorization: token $TOKEN" -H 'Content-Type: application/json' -d '{"username":"demo-org"}' > /dev/null
curl -s -X POST http://gitea:3000/api/v1/orgs/demo-org/repos -H "Authorization: token $TOKEN" -H 'Content-Type: application/json' -d '{"name":"payments"}' > /dev/null
# Push initial commit
mkdir -p /tmp/payments && cd /tmp/payments
git init && echo "# payments" > README.md && echo '{"name":"payments","version":"1.0.0"}' > package.json
git add . && git -c user.name=anvay -c user.email=admin@demo.com commit -m "initial commit"
git remote add origin http://anvay:anvaypassword@gitea:3000/demo-org/payments.git
git push -u origin main -q 2>/dev/null
rm -rf /tmp/payments
echo '{"level":"info","msg":"gitea init complete"}'
