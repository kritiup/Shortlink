# Capstone: Ship a Microservices App with Docker Swarm

This ties the whole module together. You'll take a small but real multi-service
application, run it on your own machine with Compose, harden and scan the images,
then deploy the exact same images to a single-node **Docker Swarm** cluster on AWS.

The lesson underneath all of it: *the build–ship–run cycle is the same at every
scale.* The commands you learned on Days 3–7 are the commands you use here — just
pointed at more machines.

Read each part, predict what a command will do, then run it and check.

---

## What you're building

**ShortLink** — a URL shortener with click analytics. It's deliberately made of
several services in different languages, each doing the job it's actually good at:

```
                    ┌──────────────── edge network ─────────────────┐
   browser ───▶  web  (nginx: static React + reverse proxy)          │
                    │              │                                  │
                    ▼              ▼                                  │
                  api            redirect                             │
                (Node)          (Go, hot path)                        │
                    │  │            │   │                             │
   ┌────────────────┘  └───┐    ┌───┘   └────┐  ─── internal network ─┘
   ▼                       ▼    ▼            ▼
 analytics ◀──────────── redis ──────────▶ postgres
 (Python)   drains the "clicks" queue        (links + aggregated stats)
            and writes totals to postgres
```

The request flow, end to end:

1. You create a link in the browser. **web** proxies it to **api** (Node), which
   writes the canonical row to **Postgres** and caches `code → url` in **Redis**.
2. You visit `/r/<code>`. **web** proxies to **redirect** (Go) — the public hot
   path. It resolves the code from Redis (falling back to Postgres on a miss),
   issues a `302`, and pushes a click event onto a Redis queue.
3. **analytics** (Python) runs a worker that drains that queue and folds each
   click into an aggregate row in Postgres.
4. You click "stats". **web → api → analytics** over HTTP returns the total.

Why the mix of languages is not just for show: Go is a natural fit for a tiny,
fast, dependency-free redirect binary; Python/FastAPI is comfortable for the
data-crunching worker; Node/Express is the everyday CRUD glue; nginx is the edge.
Every arrow between boxes is a real network call between containers — which is the
whole point of learning service discovery, networks, and secrets.

### What's in the box

```
shortlink/
├── README.md            ← you are here
├── compose.yaml         ← run everything locally
├── stack.yml            ← deploy to Swarm (AWS)
├── Makefile             ← shortcuts: make up / scan / sbom / push / deploy
├── .env.example         ← registry + tag settings
├── db/init.sql          ← Postgres schema
├── secrets/             ← the DB password lives here (git-ignored)
├── scripts/             ← scan, sbom, build-and-push, smoke-test
├── .github/workflows/   ← CI that builds, scans, and pushes
├── web/                 ← React (Vite) built into an unprivileged nginx image
├── api/                 ← Node/Express control-plane API
├── redirect/            ← Go redirect hot path (distroless image)
└── analytics/           ← Python/FastAPI worker + stats API
```

### Prerequisites

- Docker Engine with the Compose plugin (`docker compose version` should work).
- For the AWS part: an AWS account, and either Docker Hub or another registry you
  can push to.
- Optional but recommended: `docker scout` (bundled with recent Docker) or
  [`trivy`](https://aquasecurity.github.io/trivy/) for scanning, and
  [`syft`](https://github.com/anchore/syft) for SBOMs.

---

# Part 1 — Run it locally

**1.1 — Create the database password (a secret, not an env var)**

The DB password is delivered to every service as a Docker *secret* — a file
mounted at `/run/secrets/postgres_password`, never baked into an image or printed
in `docker inspect`. Create your local copy:

```bash
cd shortlink
cp secrets/postgres_password.txt.example secrets/postgres_password.txt
# edit it to any value you like; it's git-ignored
```

**1.2 — Bring the whole stack up**

```bash
docker compose up --build -d        # or: make up
```

The first run builds four images and pulls Postgres and Redis. Compose starts the
data services first and waits for their healthchecks (that's the `depends_on:
condition: service_healthy` at work) before starting the app services.

```bash
docker compose ps                   # everything should be "running"/"healthy"
```

**1.3 — Use it**

Open <http://localhost:8080>. Paste a long URL, click **Shorten**, and a
`/r/<code>` link appears. Click it — you're redirected to the target — then click
**stats** on that row and watch the count climb. That single browser tab just
exercised all six services.

Prefer the terminal? There's an end-to-end check:

```bash
make smoke
# creates a link, visits it 3 times, prints the click count
```

**1.4 — Watch the services actually talk**

Peek into Redis to see the cache and the click queue the Go service writes:

```bash
docker compose exec redis redis-cli KEYS '*'
docker compose exec redis redis-cli LLEN clicks     # queue drains toward 0
```

And into Postgres to see what the Python worker aggregated:

```bash
docker compose exec postgres psql -U shortlink -d shortlink \
  -c 'SELECT * FROM click_stats ORDER BY clicks DESC;'
```

**1.5 — Scale a service by hand (Compose)**

```bash
docker compose up -d --scale redirect=3
docker compose ps                   # three redirect containers now
```

The Go redirect service is stateless, so scaling it is free — Compose's built-in
DNS load-balances across the copies. (`api` and `web` scale the same way.)

**1.6 — Tear down**

```bash
make down     # stop containers, KEEP the database volume
make nuke     # stop containers AND delete the data volume (fresh start)
```

---

# Part 2 — The best practices, and where each one lives

Everything below is already in the code. This section points at *where*, so you
can read the real thing.

**Multi-stage builds — build fat, ship thin.** Every service has a `build` stage
and a `runtime` stage. Compare the throwaway build layer with what actually ships:

```bash
docker build -t shortlink-redirect:demo ./redirect
docker images | grep -E 'golang|shortlink-'
```

The Go builder is ~800 MB; the shipped `redirect` image is a few MB — a static
binary on `distroless/static`, with no compiler, no shell, and no package manager.

**Run as non-root, and drop everything you can.** No service runs as root:
`api` uses the image's `node` user, `analytics` creates `appuser`, `redirect` uses
distroless `nonroot`, and `web` uses the *unprivileged* nginx image (listening on
8080, not 80). In `compose.yaml` the app services also get `cap_drop: [ALL]`,
`security_opt: [no-new-privileges:true]`, and `read_only: true` root filesystems
(with a small `tmpfs` where a writable `/tmp` is needed).

**Healthchecks.** Every image has a `HEALTHCHECK`, and Postgres/Redis have theirs
in Compose so the app waits for readiness. Note the trick in the Go service: the
distroless image has no shell, so its healthcheck re-runs the *same binary* with a
`-healthcheck` flag (`redirect/main.go`).

**Network segmentation.** Two networks (see `compose.yaml`). `web`, `api`, and
`redirect` share `edge`; everything data-facing sits on `internal`, which is
declared `internal: true` so Postgres and Redis have no route to the internet.
Only `web` publishes a port.

**Secrets, not environment variables.** The DB password is a file-based secret in
both Compose and Swarm. Postgres reads `POSTGRES_PASSWORD_FILE`; each app service
reads the same file via a small `*_FILE` helper (look for `fromFileOrEnv` /
`read_secret` in the code). It never appears in an image layer or `docker inspect`.

**Pinned bases + `.dockerignore`.** Base images are pinned to real versions
(`node:20-bookworm-slim`, `python:3.12-slim-bookworm`, `postgres:16-bookworm`, …)
rather than `latest`, and every service has a `.dockerignore` so junk and secrets
stay out of the build context.

> Going further (good exercises): pin bases by `@sha256:` digest for
> byte-exact reproducibility; add a lockfile and switch `npm install` to `npm ci`;
> make the `web` image read-only too (it needs tmpfs for nginx's cache/temp dirs);
> add auth to Redis.

---

# Part 3 — Scan for vulnerabilities and generate an SBOM

This is the security gate you saw on Day 7, made concrete.

**3.1 — CVE scan every image**

```bash
make build                          # tag images for your registry first
make scan                           # docker scout, or trivy if scout is absent
```

`scripts/scan.sh` reports CRITICAL/HIGH findings per image. The point of a slim,
distroless-where-possible base is visible here: fewer packages means fewer CVEs
means a smaller attack surface. When something shows up, the fix is almost always
"rebuild on an updated base image, then scan again."

**3.2 — Software Bill of Materials (SBOM)**

An SBOM is the itemized list of everything inside an image — every OS package and
language dependency. It's what lets you answer "am I affected by the new
`libwhatever` CVE?" in seconds instead of days.

```bash
make sbom                           # writes ./sboms/<image>.spdx.json  (needs syft)
```

You can also attach an SBOM (and provenance) *at build time* with buildx — that's
what `scripts/build-and-push.sh` and the CI workflow do:

```bash
docker buildx build --sbom=true --provenance=true -t <img> --push ./api
```

---

# Part 4 — Push images to a registry

Swarm can't build; it pulls. So the images must live in a registry both your
laptop and your server can reach. Docker Hub is the simplest.

**4.1 — Point the build at your registry**

```bash
cp .env.example .env
# edit .env: REGISTRY=docker.io/<your-dockerhub-username>  and  TAG=v1
```

**4.2 — Log in and push**

```bash
docker login
make push REGISTRY=docker.io/<you> TAG=v1
```

`make push` builds each service with buildx and pushes it with an SBOM +
provenance attestation attached. When it finishes you'll have four
`docker.io/<you>/shortlink-*:v1` images.

> Prefer AWS ECR? Create four repos, then
> `aws ecr get-login-password | docker login --username AWS --password-stdin <acct>.dkr.ecr.<region>.amazonaws.com`,
> and set `REGISTRY=<acct>.dkr.ecr.<region>.amazonaws.com`. Everything else is
> identical.

---

# Part 5 — Deploy to AWS with Docker Swarm

You'll run a **single-node** Swarm on one EC2 instance. That's the honest way to
learn Swarm cheaply; a multi-node note is at the end.

**5.1 — Launch an EC2 instance**

In the EC2 console, launch an instance with:

- **AMI:** Ubuntu Server 24.04 LTS
- **Type:** `t3.small` (2 vCPU / 2 GiB). The free-tier `t2.micro` (1 GiB) is tight
  for six services — use it only if you must, and expect it to be slow.
- **Key pair:** create/select one so you can SSH in.
- **Security group (inbound rules):**
  - SSH `22` — source **My IP** (not the world)
  - HTTP `80` — source `0.0.0.0/0` (this is the app's public port)

Note the instance's **public IPv4 address** once it's running.

**5.2 — Install Docker on the instance**

```bash
ssh -i your-key.pem ubuntu@<PUBLIC_IP>

curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker                       # or log out/in so the group applies

docker version                      # confirm the daemon is up
```

**5.3 — Get the deploy files onto the instance**

Swarm needs `stack.yml` and `db/init.sql` present on the node (the schema is
injected as a Docker *config*). The images come from your registry, so you don't
copy any source. Clone your repo, or copy just those files:

```bash
git clone <your-repo-url> shortlink && cd shortlink
# or from your laptop:
#   scp -i your-key.pem -r stack.yml db ubuntu@<PUBLIC_IP>:~/shortlink/
```

If your registry is private, also run `docker login` here and add
`--with-registry-auth` to the deploy command below.

**5.4 — Initialise the Swarm and create the secret**

```bash
docker swarm init                   # this node becomes a one-node manager

printf 'a-strong-db-password' | docker secret create postgres_password -
docker secret ls
```

Every service reads this one secret, so the password is consistent across the
whole stack without ever being written into a file you commit or an image.

**5.5 — Deploy the stack**

```bash
REGISTRY=docker.io/<you> TAG=v1 docker stack deploy -c stack.yml shortlink
```

Watch it converge:

```bash
docker stack services shortlink     # REPLICAS should fill in (e.g. 2/2, 3/3)
docker service ps shortlink_redirect
```

Then open **http://\<PUBLIC_IP\>** in your browser. Same app, now on a server.

> Heads-up: Swarm ignores `depends_on`, so app tasks may start before Postgres is
> ready and restart a couple of times until it is. That's expected — the
> healthchecks and `restart_policy` sort it out within a few seconds.

**5.6 — Operate it like an orchestrator**

Self-healing — kill a task and watch Swarm replace it:

```bash
docker rm -f $(docker ps -q --filter name=shortlink_redirect | head -1)
docker service ps shortlink_redirect     # the killed task is replaced automatically
```

Scale — declare a new desired count:

```bash
docker service scale shortlink_redirect=5
```

Rolling update — build and push a new tag, then redeploy. Because the services use
`order: start-first`, new tasks come up before old ones leave, so there's no
downtime:

```bash
# on your laptop:
make push REGISTRY=docker.io/<you> TAG=v2
# on the server:
REGISTRY=docker.io/<you> TAG=v2 docker stack deploy -c stack.yml shortlink
docker service ps shortlink_api          # watch old tasks drain, new ones start
```

Rollback — if a bad version ships, one command reverts to the previous spec (and
`failure_action: rollback` in `stack.yml` does it automatically if the update
fails its healthchecks):

```bash
docker service rollback shortlink_api
```

**5.7 — Tear down (do this — EC2 costs money by the hour)**

```bash
docker stack rm shortlink
docker secret rm postgres_password
docker swarm leave --force
```

Then **terminate the EC2 instance** in the console (and check for a leftover EBS
volume). An idle instance keeps billing.

**5.8 — Going multi-node (concept)**

To add machines: on the manager run `docker swarm join-token worker`, then run the
printed command on each new instance. Swarm spreads stateless services (`web`,
`api`, `redirect`) across all nodes automatically. The catch is state: this stack
pins `postgres` to the manager with a placement constraint because its volume is
local to one node. For real multi-node persistence you'd move Postgres and Redis
to managed services (RDS, ElastiCache) or shared storage — the stateless services
wouldn't change at all.

---

# Part 6 — CI/CD

`.github/workflows/ci.yml` is Part 3 + Part 4 turned into automation, exactly the
Day 7 idea. On every push it builds each service (with SBOM + provenance), then
runs a Trivy **gate** that fails the build on fixable CRITICAL/HIGH CVEs. Only on
`main`, and only if you've set `REGISTRY`, `REGISTRY_USER`, and `REGISTRY_TOKEN`
repository secrets, does it push. The build/scan/push commands are the same ones
you ran by hand — that's the entire secret of CI/CD.

---

# Troubleshooting

- **`secrets/postgres_password.txt` not found on `up`.** You skipped step 1.1 —
  copy the example file.
- **App can't reach the DB right after `up`.** Give it a few seconds; the app waits
  on Postgres's healthcheck locally and retries on Swarm. `docker compose logs api`.
- **Port 8080 already in use.** Something else owns it. Stop that, or change the
  left side of `ports: ["8080:8080"]` in `compose.yaml`.
- **Browser shows the page but "could not reach the api".** Check `api` is healthy
  (`docker compose ps`); nginx proxies `/api` to it by service name.
- **On AWS the site won't load.** Almost always the security group — confirm
  inbound `80` is open, and that you're using `http://` (not `https://`).
- **`docker stack deploy` says the image isn't found.** The node can't pull it:
  wrong `REGISTRY`/`TAG`, or a private registry without `docker login` +
  `--with-registry-auth`.

# Make it yours (exercises)

1. Add a `healthcheck` + `condition: service_healthy` dependency so `api` waits on
   `analytics` too, and prove it with `docker compose logs`.
2. Add Redis authentication (a second secret) and wire every client to use it.
3. Add a `/api/links/:code` DELETE endpoint and a delete button in the UI.
4. Give the redirect service a real metric (p95 latency) and expose `/metrics`.
5. Turn the single-node Swarm into two nodes and watch the stateless services
   spread across both.
