REGISTRY ?= docker.io/yourname
TAG ?= v1
STACK ?= shortlink
IMAGES = shortlink-web shortlink-api shortlink-redirect shortlink-analytics
CTX_web = web
CTX_api = api
CTX_redirect = redirect
CTX_analytics = analytics

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n",$$1,$$2}'

.PHONY: up
up: ## Build + run the whole stack locally
	docker compose up --build -d

.PHONY: down
down: ## Stop the local stack (keep the DB volume)
	docker compose down

.PHONY: nuke
nuke: ## Stop the local stack AND delete its data volume
	docker compose down -v

.PHONY: logs
logs: ## Follow logs
	docker compose logs -f --tail=50

.PHONY: ps
ps: ## Show local services
	docker compose ps

.PHONY: smoke
smoke: ## Create a link, hit it, print the click count
	./scripts/smoke-test.sh

.PHONY: build
build: ## Build all images tagged for $(REGISTRY):$(TAG)
	docker build -t $(REGISTRY)/shortlink-web:$(TAG) ./web
	docker build -t $(REGISTRY)/shortlink-api:$(TAG) ./api
	docker build -t $(REGISTRY)/shortlink-redirect:$(TAG) ./redirect
	docker build -t $(REGISTRY)/shortlink-analytics:$(TAG) ./analytics

.PHONY: scan
scan: ## CVE-scan every image (docker scout or trivy)
	./scripts/scan.sh $(REGISTRY) $(TAG)

.PHONY: sbom
sbom: ## Write an SBOM per image into ./sboms (needs syft)
	./scripts/sbom.sh $(REGISTRY) $(TAG)

.PHONY: push
push: ## Build + push all images (with SBOM + provenance attestations)
	./scripts/build-and-push.sh $(REGISTRY) $(TAG)

.PHONY: deploy
deploy: ## Deploy the stack to the active Swarm
	REGISTRY=$(REGISTRY) TAG=$(TAG) docker stack deploy -c stack.yml $(STACK)

.PHONY: rm
rm: ## Remove the deployed Swarm stack
	docker stack rm $(STACK)
