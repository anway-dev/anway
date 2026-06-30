# Anway Operations

Anway monitors and remediates itself. Manual runbooks are not maintained here.

## If Anway is unreachable

Anway is down — use these bootstrap-only commands to bring it back:

```bash
# Check pod status
kubectl get pods -n anway

# Check gateway logs
kubectl logs -n anway deploy/anway-gateway --tail=50

# Roll back to last known good release
helm rollback anway -n anway

# Re-run migrations (idempotent)
kubectl run migrate-recovery --image=<REGISTRY>/anway-gateway:<SHA> \
  --namespace anway --restart=Never --rm --attach \
  -- npx prisma migrate deploy

# Health check
curl https://anway.yourdomain.com/health/ready
```

## Everything else

Open Anway → War Room. The SRE agent has already triaged it.
