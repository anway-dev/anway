// Shared process lifecycle flag for graceful shutdown / readiness draining.
// When draining, /health/ready returns 503 so load balancers stop routing
// new traffic while in-flight requests complete.
let draining = false

export function isDraining(): boolean {
  return draining
}

export function beginDraining(): void {
  draining = true
}
