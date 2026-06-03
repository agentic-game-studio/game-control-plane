# Hackathon Deployment

Recommended target: Railway for the live control plane, plus optional Cloudflare Pages for exported Godot web builds.

## Why Railway

- Handles long-running Node services and WebSockets.
- Supports pnpm monorepos with separate services.
- Supports GitHub autodeploys.
- Can attach a persistent volume for `WORKSPACE_DIR`.
- Requires less adaptation than Cloudflare Workers for this Express API.

Cloudflare Pages is still a good fit for static Godot HTML exports.

## Railway Services

Create one Railway project with two services from the same GitHub repo.

### API service

Use these settings:

```txt
Build command: pnpm build:api
Start command: pnpm start:api
```

Add a persistent volume mounted at:

```txt
/data/workspace
```

Environment variables:

```txt
API_SECRET=<same-random-secret-as-web>
CORS_ORIGIN=https://<web-service-domain>
WORKSPACE_DIR=/data/workspace
ZAI_API_KEY=<optional-if-using-kimi>
KIMI_API_KEY=<optional-if-using-zai>
DEFAULT_MODEL=glm-5.1
REVIEW_MODE=lean
MAX_TOOL_CALLS=100
TOOL_CHECKPOINT_INTERVAL=30
API_TIMEOUT_MS=120000      # Per-LLM-call timeout (default 120s)
# BODY_LIMIT_MB=5          # Default 5MB for the global JSON parser. Asset
                           # upload routes attach their own higher-limit
                           # parser locally — do NOT raise this globally
                           # unless you actually need it everywhere; large
                           # global limits make the API easier to OOM with
                           # huge unauthenticated POSTs.
ENABLE_TEST_ENDPOINTS=false # Disable /api/chat/sessions/consultation/test-create in prod
```

Railway provides `PORT` automatically; the API also supports `API_PORT` for local/dev.

### Web service

Use these settings:

```txt
Build command: pnpm build:web
Start command: pnpm start:web
```

Environment variables:

```txt
NEXT_PUBLIC_API_URL=https://<api-service-domain>
NEXT_PUBLIC_WS_URL=wss://<api-service-domain>
NEXT_PUBLIC_API_KEY=<same-random-secret-as-api>
```

After both services have domains, update:

- API `CORS_ORIGIN` to the web service domain.
- Web `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` to the API service domain.

Redeploy both services.

## Optional Godot Web Demo

For the playable game itself:

1. Export the Godot project as Web/HTML5.
2. Deploy the exported folder to Cloudflare Pages.
3. Link the playable build from the control plane or hackathon submission.

## Full Cloud Godot Builds

Online Godot export from the control plane needs a container/VM with Godot installed and `GODOT_BIN` configured. That is possible, but it is more ops-heavy than the recommended hackathon path.
