#!/usr/bin/env bash
# launch-demo.sh — Start minikube, build images, deploy services, start observability
# Run from repo root: bash infra/demo/launch-demo.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICES_DIR="$SCRIPT_DIR/services"
K8S_DIR="$SCRIPT_DIR/k8s"

log() { echo "[$(date +%H:%M:%S)] $*"; }

# ── 1. Start minikube ──────────────────────────────────────────────────────────
log "Starting minikube..."
if minikube status --format='{{.Host}}' 2>/dev/null | grep -q Running; then
  log "minikube already running — skipping start"
else
  minikube start \
    --driver=docker \
    --memory=4096 \
    --cpus=4 \
    --kubernetes-version=v1.29.0 \
    --addons=metrics-server
  log "minikube started"
fi

# ── 2. Point Docker at minikube registry ──────────────────────────────────────
log "Configuring Docker to use minikube registry..."
eval "$(minikube docker-env)"

# ── 3. Build images inside minikube ───────────────────────────────────────────
for svc in payments-api auth-service checkout-api; do
  log "Building $svc..."
  docker build -t "$svc:latest" "$SERVICES_DIR/$svc"
done
log "All images built"

# ── 4. Apply K8s manifests ────────────────────────────────────────────────────
log "Applying K8s manifests..."
kubectl apply -f "$K8S_DIR/namespace.yaml"
kubectl apply -f "$K8S_DIR/payments-api.yaml"
kubectl apply -f "$K8S_DIR/auth-service.yaml"
kubectl apply -f "$K8S_DIR/checkout-api.yaml"
kubectl apply -f "$K8S_DIR/chaos.yaml"
log "Manifests applied"

# ── 5. Wait for pods to be ready ──────────────────────────────────────────────
log "Waiting for pods..."
kubectl wait --for=condition=ready pod \
  -l 'app in (payments-api,auth-service,checkout-api)' \
  -n demo --timeout=120s
log "All pods ready"

# ── 6. Start Prometheus + Grafana ─────────────────────────────────────────────
log "Starting observability stack..."
MINIKUBE_IP=$(minikube ip)
export MINIKUBE_IP
docker compose -f "$SCRIPT_DIR/docker-compose.observability.yml" up -d
log "Observability started"

# ── 7. Summary ────────────────────────────────────────────────────────────────
MINIKUBE_IP=$(minikube ip)
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Demo environment ready"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
printf " %-18s %-30s %s\n" "Service" "URL" "Creds"
printf " %-18s %-30s %s\n" "-------" "---" "-----"
printf " %-18s %-30s %s\n" "Anvay (web)"     "http://localhost:8500"          ""
printf " %-18s %-30s %s\n" "Gateway"         "http://localhost:8510"          ""
printf " %-18s %-30s %s\n" "Grafana"         "http://localhost:8520"          "admin / anvay"
printf " %-18s %-30s %s\n" "Prometheus"      "http://localhost:8530"          ""
echo ""
echo " K8s services (namespace: demo, minikube IP: $MINIKUBE_IP):"
printf "   %-18s %s\n" "payments-api"  "$MINIKUBE_IP:30010"
printf "   %-18s %s\n" "auth-service"  "$MINIKUBE_IP:30011"
printf "   %-18s %s\n" "checkout-api"  "$MINIKUBE_IP:30012"
echo ""
echo " K8s connector config for Anvay:"
echo "   API server: https://$(minikube ip):8443"
echo "   Run: kubectl config view --minify --flatten > /tmp/anvay-kubeconfig.yaml"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
