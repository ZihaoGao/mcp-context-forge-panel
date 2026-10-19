# ContextForge Console

English | [简体中文](README.zh-CN.md)

A standalone console for administering and using ContextForge, with **v1.0.11** as its API baseline. It supports administrators and regular users, self-service API keys, RBAC, bulk resource management, runtime path prefixes, and a same-origin reverse proxy for MCP, LLM, and business APIs.

## Development and running

Requires Node.js 24 and a separately running ContextForge backend.

```powershell
npm ci
Copy-Item .env.example .env
# Set BACKEND_URL and PUBLIC_ORIGIN in .env
npm run build
node --env-file=.env apps/server/index.mjs
```

With the default configuration, open `http://localhost:3000/forge/app/`. `npm run dev` watches the frontend build and reloads Node.js; refresh the browser after UI changes.

On Linux / macOS, use `cp .env.example .env`. Production deployments use environment variables; changing the public path prefix does not require rebuilding the image.

## Docker

```sh
docker build -f deploy/Dockerfile -t contextforge-panel:local .
docker compose -f deploy/compose.yaml up -d
```

Compose defaults to the host backend at `http://host.docker.internal:4444` and publishes the frontend port only on the host loopback interface. Inside a container, `localhost` refers to that container; set `BACKEND_URL` explicitly for other deployments. Compose reads environment variables from the command's environment or the specified `--env-file`.

The frontend container does not include the backend, a database, or Redis. The reference repository is not modified.

## Configuration

| Variable              | Example                        | Purpose                                                                                      |
| --------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| `APP_ROOT_PATH`       | `/forge`                       | Public path prefix; an empty string serves at the domain root                                |
| `BACKEND_URL`         | `http://gateway:4444/internal` | Fixed upstream URL, optionally including its own internal path prefix                        |
| `PUBLIC_ORIGIN`       | `https://tools.example.com`    | Browser-facing scheme, hostname, and port; used for Origin checks and redirects              |
| `COOKIE_SECURE`       | `true`                         | Enable for HTTPS access to the console; use `false` for local HTTP                           |
| `TRUSTED_PROXY_CIDRS` | `127.0.0.1/32`                 | Trusted proxy networks whose forwarded client IP headers may be read; empty by default       |
| `PORT` / `HOST`       | `3000` / `0.0.0.0`             | Listening port and address                                                                   |
| `LOG_LEVEL`           | `info`                         | `debug`, `info` (default), `warn`, `error`, `silent`; controls access and backend error logs |

The UI is served at `/forge/app/`, and internal console endpoints use `/forge/_panel/`. Other public business paths are forwarded upstream after stripping `/forge`. `/forge/_internal/` is not publicly exposed. LLM requests use the backend's actual API prefix, such as `/forge/llm/v1/chat/completions`. MCP virtual servers connect through `/forge/servers/<id>/mcp`.

See the [nginx example](deploy/nginx.conf.example) and [deployment guide](docs/deployment.md).

### HTTPS backends with self-signed certificates

Set `BACKEND_URL` to an HTTPS URL and use `NODE_EXTRA_CA_CERTS` to make the console's Node.js process trust the backend certificate. This covers regular API proxying, WebSocket connections, and server-side requests such as login, without changing application code.

Prepare a PEM certificate file: for certificates issued by a private CA, use that CA's public certificate; for a directly self-signed backend certificate, use the certificate itself. No private key is required. The hostname or IP in `BACKEND_URL` must match the certificate's Subject Alternative Name (SAN), and the certificate must be valid and unexpired.

For local execution, set the following in `.env`:

```dotenv
BACKEND_URL=https://backend.example.internal:4444
```

In PowerShell, set the certificate path before starting:

```powershell
$env:NODE_EXTRA_CA_CERTS = "C:\certs\backend-ca.pem"
npm start
```

On Linux / macOS:

```sh
NODE_EXTRA_CA_CERTS=/absolute/path/backend-ca.pem npm start
```

For development, replace `npm start` with `npm run dev`. Set this environment variable before launching the process, and restart the console after changing the certificate or its path. Do not rely solely on loading `.env` after the application has started to configure certificate trust. See the [Node.js certificate configuration documentation](https://nodejs.org/api/cli.html#node_extra_ca_certsfile).

For Docker deployments, merge the following into the `panel` service in `deploy/compose.yaml`, keeping its other existing fields:

```yaml
services:
  panel:
    environment:
      BACKEND_URL: https://backend.example.internal:4444
      NODE_EXTRA_CA_CERTS: /app/certs/backend-ca.pem
    volumes:
      - ./certs/backend-ca.pem:/app/certs/backend-ca.pem:ro
```

Place the host certificate at `deploy/certs/backend-ca.pem`. Ensure the container's `node` user can read it and the container can resolve and reach the backend address. The existing Compose configuration does not automatically pass `NODE_EXTRA_CA_CERTS` into the container; adding it only to the host `.env` is insufficient. After updating the configuration, run `docker compose -f deploy/compose.yaml up -d`. If you only replace the certificate contents, restart the container as well.

Set `COOKIE_SECURE` according to whether browsers access the console over HTTPS; it is independent of the backend protocol. Avoid disabling certificate verification for the entire process with `NODE_TLS_REJECT_UNAUTHORIZED=0`. Verify login and business API proxying with your own certificates in the actual deployment.

## Features

- Resource catalog: CRUD, details, related actions, and bulk operations for MCP gateways, virtual servers, Tools, Resources, Prompts, A2A, and Roots.
- My API Keys: create team- or server-scoped keys within existing permissions, set expiration and permissions, copy the plaintext key at creation, and view, update, revoke, or inspect usage.
- Roles and permissions: role CRUD, permission catalog, user role lookup, assignment, and revocation by scope.
- Teams and users: accounts, members, invitations, join requests, and related operations.
- Models and providers, chat debugging, plugins, service catalogs, observability, logs, and system configuration.
- Resource lists include contextual creation, editing, details, and action confirmations. Permission and resource associations support search and batch selection; fixed choices use dropdowns. Sections provide import, export, and templates, with preflight checks before execution. Log search and system settings have dedicated pages.
- API workbench: execute business operations using actual OpenAPI parameters and request schemas, with support for forms, JSON, files, result downloads, and streaming. Less frequently used features remain available here even without a dedicated list page.

Conditional features identify the configuration needed to enable them. Internal service endpoints, health probes, deprecated methods, and the original frontend's HTML rendering endpoints are explicitly excluded. Protocol capabilities are covered through connection configuration and debugging tools.

See [coverage.csv](contracts/contextforge/coverage.csv) for the complete mapping. Endpoint coverage does not imply that every operation has passed integration testing; see the [verification record](docs/verification.md) for tested scenarios and limitations.

See the [resource workflow guide](docs/resource-workflows.md) for resource import formats, plugin and catalog handling, read-only historical snapshots, and how these differ from native configuration migration.

## Quality checks

```sh
npm run check
npm run format:check
```

See [development and testing](docs/development.md) for real-backend and browser test setup. Chat uses a separate v1.0.10 test environment without changing the main v1.0.11 backend.

## Project structure

```text
apps/web/                    React UI and interactions
apps/server/                 Sessions, configuration, static files, and fixed upstream proxy
packages/api-client/         API client, generated types, contracts, and bulk execution helpers
contracts/contextforge/      Versioned specifications, provenance, and feature coverage
scripts/                     Contract generation, isolated test environments, and development commands
tests/                       Unit, real-backend integration, and browser tests
deploy/                      Docker, Compose, and nginx
docs/                        Architecture, deployment, maintenance, and verification
```

See [architecture.md](docs/architecture.md) for architectural conventions.

## License and security reports

Original project code is licensed under the [MIT License](LICENSE). Contracts and types generated from upstream retain the Apache-2.0 license. See [third-party notices](THIRD_PARTY_NOTICES.md) for sources, modifications, and licenses.

See the [security policy](SECURITY.md) for vulnerability reporting and support scope. Do not include credentials or exploitation details for undisclosed vulnerabilities in public issues.
