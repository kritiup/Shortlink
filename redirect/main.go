// The "data plane": the public hot path that turns /code into a 302 redirect.
// It stays fast by reading from Redis first and only falling back to Postgres
// on a cache miss. Each hit is counted in Redis and queued for the analytics
// worker to aggregate.
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

var (
	rdb  *redis.Client
	pool *pgxpool.Pool
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// readSecret reads KEY_FILE (a mounted secret) if set, otherwise KEY.
func readSecret(key, def string) string {
	if f := os.Getenv(key + "_FILE"); f != "" {
		if b, err := os.ReadFile(f); err == nil {
			return strings.TrimSpace(string(b))
		}
	}
	return env(key, def)
}

func main() {
	// The distroless runtime image has no shell, so the container's
	// HEALTHCHECK re-invokes this same binary with -healthcheck.
	hc := flag.Bool("healthcheck", false, "probe the local /healthz endpoint and exit")
	flag.Parse()
	if *hc {
		runHealthcheck()
		return
	}

	ctx := context.Background()

	dsn := "postgres://" + env("PGUSER", "shortlink") + ":" + readSecret("PGPASSWORD", "") +
		"@" + env("PGHOST", "postgres") + ":" + env("PGPORT", "5432") +
		"/" + env("PGDATABASE", "shortlink")

	var err error
	pool, err = pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer pool.Close()

	rdb = redis.NewClient(&redis.Options{Addr: env("REDIS_ADDR", "redis:6379")})

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthz)
	mux.HandleFunc("/", redirectHandler)

	addr := ":" + env("PORT", "8080")
	srv := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	}
	log.Printf("redirect listening on %s", addr)
	log.Fatal(srv.ListenAndServe())
}

func healthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		http.Error(w, "postgres down", http.StatusServiceUnavailable)
		return
	}
	if err := rdb.Ping(ctx).Err(); err != nil {
		http.Error(w, "redis down", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok\n"))
}

func redirectHandler(w http.ResponseWriter, r *http.Request) {
	code := strings.Trim(r.URL.Path, "/")
	if code == "" {
		http.NotFound(w, r)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	// Fast path: Redis.
	target, err := rdb.Get(ctx, "link:"+code).Result()
	if err == redis.Nil {
		// Cache miss: fall back to Postgres, then warm the cache.
		row := pool.QueryRow(ctx, "SELECT target_url FROM links WHERE code=$1", code)
		if scanErr := row.Scan(&target); scanErr != nil {
			http.NotFound(w, r)
			return
		}
		rdb.Set(ctx, "link:"+code, target, time.Hour)
	} else if err != nil {
		http.Error(w, "cache error", http.StatusInternalServerError)
		return
	}

	// Record the click. Best-effort: a redirect must not fail because
	// bookkeeping did. The analytics worker drains the "clicks" queue.
	rdb.Incr(ctx, "clicks:"+code)
	rdb.RPush(ctx, "clicks", code)

	http.Redirect(w, r, target, http.StatusFound)
}

func runHealthcheck() {
	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + env("PORT", "8080") + "/healthz")
	if err != nil || resp.StatusCode != http.StatusOK {
		os.Exit(1)
	}
	os.Exit(0)
}
