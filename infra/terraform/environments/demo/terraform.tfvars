# Demo environment — local Docker deployment
# Override secrets before use. These defaults are for local testing only.

app_name    = "anvay"
environment = "demo"

# Images — build locally first: docker build -t anvay/gateway:latest -f apps/gateway/Dockerfile .
gateway_image = "anvay/gateway:latest"
web_image     = "anvay/web:latest"

# Port overrides — change if host ports conflict
# postgres_host_port = 5432
# redis_host_port    = 6379
# gateway_host_port  = 4000
# web_host_port      = 3000
