# Anvay Runbook

## Pod OOMKilled or Crash Loop

**Alert:** `AnvayPodCrashLooping` (critical)

**Symptom:** Pod restarts repeatedly, `CrashLoopBackOff` status in `kubectl get pods`.

**Diagnosis:**
```bash
kubectl describe pod -n anvay <pod-name>
kubectl logs -n anvay <pod-name> --previous
kubectl top pod -n anvay
```

**Fix:**
```bash
# If OOMKilled — increase memory limit
kubectl set resources deploy/anvay-gateway -n anvay --limits=memory=512Mi

# If startup crash — check for missing env vars or config
kubectl describe configmap -n anvay
kubectl get secret -n anvay anvay-secrets -o jsonpath='{.data}' | base64 -d

# If persistent — scale down, fix, scale up
kubectl scale deploy/anvay-gateway -n anvay --replicas=0
# ... fix issue ...
kubectl scale deploy/anvay-gateway -n anvay --replicas=2
```

**Verification:**
```bash
kubectl get pods -n anvay -w  # Watch for stable Running state
kubectl logs -n anvay deploy/anvay-gateway --tail=20
```

---

## DB Connections Exhausted

**Alert:** `AnvayDBConnectionsHigh` (warning)

**Symptom:** Database connections > 80. App logs show `too many clients` or `remaining connection slots are reserved`.

**Diagnosis:**
```bash
# Check active connections
kubectl exec -n anvay deploy/anvay-gateway -- \
  npx prisma db execute --stdin <<< "SELECT count(*) FROM pg_stat_activity WHERE datname='anvay';"

# Check for idle-in-transaction connections
kubectl exec -n anvay deploy/anvay-gateway -- \
  npx prisma db execute --stdin <<< "SELECT pid, state, query_start, query FROM pg_stat_activity WHERE datname='anvay' AND state = 'idle in transaction';"
```

**Fix:**
```bash
# Option 1: Restart gateway to release pooled connections
kubectl rollout restart deploy/anvay-gateway -n anvay

# Option 2: Kill idle connections manually (if restart not enough)
kubectl exec -n anvay deploy/anvay-gateway -- \
  npx prisma db execute --stdin <<< "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='anvay' AND state = 'idle in transaction' AND query_start < now() - interval '5 minutes';"

# Option 3: Increase pool size (if consistently high under normal load)
# Update DATABASE_URL to include ?connection_limit=20
kubectl set env deploy/anvay-gateway -n anvay DATABASE_URL="<new-url>"
```

**Verification:**
```bash
kubectl exec -n anvay deploy/anvay-gateway -- \
  npx prisma db execute --stdin <<< "SELECT count(*) FROM pg_stat_activity WHERE datname='anvay';"
```

---

## Redis Memory High

**Alert:** `AnvayRedisMemoryHigh` (warning)

**Symptom:** Redis memory usage > 85%. Session data, cache entries, or pub/sub queues may be evicted.

**Diagnosis:**
```bash
# Check Redis memory stats
kubectl exec -n anvay deploy/anvay-gateway -- \
  redis-cli -u "$REDIS_URL" INFO memory | grep -E 'used_memory_human|maxmemory_human|evicted_keys'

# Check key count and largest keys
kubectl exec -n anvay deploy/anvay-gateway -- \
  redis-cli -u "$REDIS_URL" DBSIZE
```

**Fix:**
```bash
# Option 1: Scale Redis (if using K8s Redis)
kubectl scale statefulset/redis -n anvay --replicas=2

# Option 2: Flush expired sessions
kubectl exec -n anvay deploy/anvay-gateway -- \
  redis-cli -u "$REDIS_URL" --scan --pattern 'session:*' | head -100

# Option 3: Set eviction policy (volatile-lru recommended)
kubectl exec -n anvay deploy/anvay-gateway -- \
  redis-cli -u "$REDIS_URL" CONFIG SET maxmemory-policy volatile-lru
```

**Verification:**
```bash
kubectl exec -n anvay deploy/anvay-gateway -- \
  redis-cli -u "$REDIS_URL" INFO memory | grep used_memory_human
```

---

## High Error Rate / Rollback

**Alert:** `AnvayHighErrorRate` (warning), `AnvaySloBurnRateCritical` (critical)

**Symptom:** HTTP 5xx error rate > 1% over 5 minutes, or SLO error budget burning > 2x safe rate.

**Diagnosis:**
```bash
# Check recent deploys — what changed?
kubectl rollout history deploy/anvay-gateway -n anvay
kubectl describe deploy/anvay-gateway -n anvay | grep Image

# Check gateway logs for error patterns
kubectl logs -n anvay deploy/anvay-gateway --tail=100 | grep -i error

# Check downstream dependencies
kubectl get pods -n anvay
kubectl describe service -n anvay
```

**Fix:**
```bash
# Option 1: Rollback to previous revision
kubectl rollout undo deploy/anvay-gateway -n anvay
kubectl rollout undo deploy/anvay-web -n anvay

# Option 2: Rollback to specific revision
kubectl rollout undo deploy/anvay-gateway -n anvay --to-revision=2

# Option 3: Scale up to absorb load (if error rate is traffic-driven)
kubectl scale deploy/anvay-gateway -n anvay --replicas=4
```

**Verification:**
```bash
kubectl rollout status deploy/anvay-gateway -n anvay
kubectl logs -n anvay deploy/anvay-gateway --tail=20
curl -s http://<gateway-svc>:4000/health/ready | jq .
```

---

## Certificate Expired

**Symptom:** TLS errors in browser or `cert-manager` showing `CertificateRequest` stuck.

**Diagnosis:**
```bash
kubectl get certificates -n anvay
kubectl describe certificate -n anvay anvay-tls

# Check cert-manager logs
kubectl logs -n cert-manager deploy/cert-manager --tail=50

# Check if challenge is pending
kubectl get challenges -n anvay
kubectl get orders -n anvay
```

**Fix:**
```bash
# Delete stuck certificate to force re-issue
kubectl delete certificate -n anvay anvay-tls

# If using Let's Encrypt staging, switch to production issuer
kubectl get clusterissuer
kubectl describe clusterissuer letsencrypt-prod

# Manual renewal (if auto-renewal failing)
kubectl annotate certificate -n anvay anvay-tls cert-manager.io/issuer-kind-override=ClusterIssuer
```

**Verification:**
```bash
kubectl get certificate -n anvay anvay-tls -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
# Should return: True
```

---

## Manual Production Rollback

**Symptom:** Production is degraded and automated rollback is insufficient.

**Diagnosis:**
```bash
# Find stable revision
kubectl rollout history deploy/anvay-gateway -n anvay
kubectl rollout history deploy/anvay-web -n anvay

# Check what changed between revisions
kubectl rollout history deploy/anvay-gateway -n anvay --revision=2
```

**Fix — full manual rollback:**
```bash
# 1. Rollback both deployments
kubectl rollout undo deploy/anvay-gateway -n anvay --to-revision=<stable-revision>
kubectl rollout undo deploy/anvay-web -n anvay --to-revision=<stable-revision>

# 2. Verify rollback status
kubectl rollout status deploy/anvay-gateway -n anvay --timeout=5m
kubectl rollout status deploy/anvay-web -n anvay --timeout=5m

# 3. Check health
curl -s http://<gateway-svc>:4000/health/ready | jq .

# 4. If database migrations were part of the bad deploy, revert migration:
kubectl run migrate-rollback --image=<stable-gateway-image> \
  --namespace=anvay --restart=Never --rm --attach \
  -- npx prisma migrate resolve --rolled-back <migration-name>

# 5. Verify production traffic is healthy
kubectl logs -n anvay deploy/anvay-gateway --tail=50
```

**Verification:**
```bash
kubectl get pods -n anvay
kubectl logs -n anvay deploy/anvay-gateway --tail=10
curl -s http://<gateway-svc>:4000/health/ready
```
