# Anvay Operations

Anvay monitors and remediates itself. Manual runbooks are not maintained here.

## If Anvay is unreachable

Anvay is down — use these bootstrap-only commands to bring it back:

```bash
# Check pod status
kubectl get pods -n anvay

# Check gateway logs
kubectl logs -n anvay deploy/anvay-gateway --tail=50

# Roll back to last known good release
helm rollback anvay -n anvay

# Re-run migrations (idempotent)
kubectl run migrate-recovery --image=<REGISTRY>/anvay-gateway:<SHA> \
  --namespace anvay --restart=Never --rm --attach \
  -- npx prisma migrate deploy

# Health check
curl https://anvay.yourdomain.com/health/ready
```

## Everything else

Open Anvay → War Room. The SRE agent has already triaged it.
