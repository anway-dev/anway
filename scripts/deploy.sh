#!/usr/bin/env bash
set -euo pipefail

ENV="${1:-}"
DRY_RUN=false
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=true

usage() {
  echo "Usage: $0 <staging|prod> [--dry-run]"
  echo ""
  echo "Required env vars:"
  echo "  REGISTRY          Container registry prefix (e.g. ghcr.io/myorg)"
  echo "  KUBECONFIG or KUBE_CONTEXT  K8s credentials"
  echo ""
  echo "Optional:"
  echo "  DB_POOL_SIZE      Postgres connection pool size (default: 5)"
  echo "  HELM_RELEASE      Helm release name (default: anvay)"
  exit 1
}

[[ -z "$ENV" ]] && usage
[[ "$ENV" != "staging" && "$ENV" != "prod" ]] && { echo "Error: ENV must be staging or prod"; usage; }
[[ -z "${REGISTRY:-}" ]] && { echo "Error: REGISTRY env var required"; usage; }

REGISTRY="${REGISTRY}"
HELM_RELEASE="${HELM_RELEASE:-anvay}"
GIT_SHA="$(git rev-parse --short HEAD)"
NAMESPACE="anvay$([[ "$ENV" == "staging" ]] && echo "-staging" || echo "")"
GATEWAY_IMAGE="${REGISTRY}/anvay-gateway:${GIT_SHA}"
WEB_IMAGE="${REGISTRY}/anvay-web:${GIT_SHA}"

run() {
  echo "+ $*"
  [[ "$DRY_RUN" == "true" ]] || "$@"
}

echo "==> Deploying Anvay ${ENV} @ ${GIT_SHA}"
[[ "$DRY_RUN" == "true" ]] && echo "    (DRY RUN — commands printed, not executed)"

echo ""
echo "── Step 1: Build images ──────────────────────────"
run docker build -f apps/gateway/Dockerfile . -t "${GATEWAY_IMAGE}"
run docker build -f apps/web/Dockerfile . -t "${WEB_IMAGE}"

echo ""
echo "── Step 2: Push images ───────────────────────────"
run docker push "${GATEWAY_IMAGE}"
run docker push "${WEB_IMAGE}"

echo ""
echo "── Step 3: Helm upgrade ──────────────────────────"
run helm upgrade --install "${HELM_RELEASE}" infra/helm/anvay \
  --namespace "${NAMESPACE}" --create-namespace \
  --set "gateway.image.tag=${GIT_SHA}" \
  --set "web.image.tag=${GIT_SHA}" \
  --set "gateway.image.repository=${REGISTRY}/anvay-gateway" \
  --set "web.image.repository=${REGISTRY}/anvay-web" \
  --wait --timeout 10m

echo ""
echo "── Step 4: Run migrations ────────────────────────"
run kubectl run "migrate-${GIT_SHA}" \
  --image="${GATEWAY_IMAGE}" \
  --namespace="${NAMESPACE}" \
  --restart=Never --rm --attach \
  -- npx prisma migrate deploy

echo ""
echo "── Step 5: Health check ──────────────────────────"
if [[ "$DRY_RUN" == "false" ]]; then
  GATEWAY_SVC="$(kubectl get svc -n "${NAMESPACE}" -l app=anvay-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")"
  echo "Waiting for /health/ready..."
  for i in $(seq 1 24); do
    STATUS=$(kubectl exec -n "${NAMESPACE}" deploy/anvay-gateway -- \
      wget -qO- http://localhost:4000/health/ready 2>/dev/null || echo "")
    echo "${STATUS}" | grep -q '"status":"ok"' && echo "✓ Healthy" && break
    echo "  Attempt ${i}/24, retrying in 5s..."
    sleep 5
    [[ $i -eq 24 ]] && { echo "✗ Health check timed out after 120s"; exit 1; }
  done
fi

echo ""
echo "✓ Deploy complete — ${ENV} @ ${GIT_SHA}"
