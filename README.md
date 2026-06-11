# xmcp + Scalekit per-user MCP Auth

A working MCP server built with [xmcp](https://xmcp.dev) and secured with [Scalekit](https://scalekit.com) OAuth 2.1. Teammates share one server URL; each person signs in individually and sees only their own data.

## The problem

Teams often run MCP servers (xmcp, FastMCP, or custom) whose tools call internal services or external integrations. When the shared MCP client config includes API keys, database URLs, or service tokens in `env`, every teammate inherits the **creator's** credentials.

## The fix

Share the **URL only** in MCP client config. Each teammate completes signup or login through Scalekit on first connect. Your server reads the JWT `sub` claim as the user ID and scopes tool data to that identity.

| Shared across the team | Per user |
|---|---|
| MCP server URL (`http://localhost:3001/mcp`) | Scalekit login identity (JWT `sub`) |
| Scalekit MCP server registration (in server `.env`) | Notes and tool data keyed by `sub` |

## What this demo does

- Serves an MCP server over Streamable HTTP at `/mcp`
- Validates Bearer tokens issued by Scalekit using JWKS
- Exposes OAuth discovery endpoints for MCP clients (Cursor, Claude Code, MCP Inspector)
- Provides per-user notes tools (`save_note`, `list_my_notes`) scoped by JWT `sub`
- Includes `whoami` to inspect the authenticated session

## Quick start

### 1. Scaffold with create-xmcp-app

```bash
npx create-xmcp-app@latest my-mcp-server --http -y
cd my-mcp-server
```

This repo is the finished version. To build from scratch, add the Scalekit files listed in [Project structure](#project-structure) and install the extra dependencies:

```bash
npm install @scalekit-sdk/node jose express
npm install -D @types/express
```

### 2. Register your MCP server in Scalekit

Follow the [MCP Auth quickstart](https://docs.scalekit.com/authenticate/mcp/quickstart/):

1. Go to [Scalekit Dashboard](https://app.scalekit.com) → **MCP Servers** → **Add MCP server**
2. Set **Server URL** to `http://localhost:3001`
3. Enable **Allow dynamic client registration** (required for Cursor and Claude Code)
4. Note the **Resource ID** (`res_...`) shown below the server name
5. Copy **Environment URL**, **Client ID**, and **Client Secret** from **Settings → API Credentials**

### 3. Enable auth methods (required before first login)

Before teammates can sign up or log in, enable at least one auth method in the Scalekit dashboard:

- [Social logins](https://docs.scalekit.com/mcp/auth-methods/social/) (Google, GitHub, Microsoft, etc.)
- Passwordless, enterprise SSO, or [bring your own auth](https://docs.scalekit.com/mcp/auth-methods/custom-auth/)

The login UI your teammates see on first connect is driven by what you enable here.

### 4. Configure environment

```bash
cp .env.example .env
```

```env
SCALEKIT_ENVIRONMENT_URL=https://your-env.scalekit.com
SCALEKIT_CLIENT_ID=skc_...
SCALEKIT_CLIENT_SECRET=skcs_...
SCALEKIT_RESOURCE_ID=res_...
BASE_URL=http://localhost:3001
PORT=3001
```

> **Important:** `SCALEKIT_RESOURCE_ID` is required. Without it, the server cannot advertise the `registration_endpoint` needed for Dynamic Client Registration (DCR), and MCP clients like Claude Desktop or Cursor will fail to connect.

### 5. Install and run

```bash
npm install
npm run dev
```

The server starts at `http://localhost:3001/mcp`.

## Project structure

| File | Purpose |
|------|---------|
| `src/lib/scalekit-auth.ts` | Auth provider: JWKS verification, OAuth discovery endpoints, session context |
| `src/lib/notes-store.ts` | Per-user notes persistence keyed by JWT `sub` |
| `src/middleware.ts` | Wires the Scalekit provider into xmcp as middleware |
| `src/tools/whoami.ts` | Returns the authenticated user session (`userId` = JWT `sub`) |
| `src/tools/save-note.ts` | Saves a note for the current user |
| `src/tools/list-my-notes.ts` | Lists notes for the current user only |
| `xmcp.config.ts` | Enables Streamable HTTP transport |

## How per-user identity works

After a teammate authenticates, Scalekit issues an MCP access token. The middleware validates it and exposes the session to tools:

```typescript
import { getSession } from "../lib/scalekit-auth";

const session = getSession();
// session.userId === JWT sub claim
```

- Alice connects and logs in → `sub` = Alice's ID → Alice's notes
- Bob connects to the **same URL** and logs in → `sub` = Bob's ID → Bob's notes

Notes are stored in `.data/notes.json` on the server, keyed by `userId`. In a production app, you would scope database queries, API calls, or file access the same way.

## Two-user verification

Prove that teammates do not share data:

1. **Alice** connects her MCP client to `http://localhost:3001/mcp` (URL only — no secrets in config)
2. Alice completes Scalekit signup/login in the browser
3. Alice calls `save_note` with content `"Alice was here"`
4. Alice calls `list_my_notes` — sees her note
5. **Bob** connects the same URL with a different Scalekit account
6. Bob calls `list_my_notes` — sees an empty list (not Alice's note)
7. Bob calls `save_note` with `"Bob was here"` — only Bob sees it on `list_my_notes`

## Test with MCP Inspector

1. Open [MCP Inspector](https://inspector.tools.modelcontextprotocol.io) or run `npx @modelcontextprotocol/inspector`

2. Configure the connection:
   - **Transport type:** Streamable HTTP
   - **URL:** `http://localhost:3001/mcp`
   - **Connection type:** Direct

3. Get an access token (client credentials):

   ```bash
   curl -X POST "$SCALEKIT_ENVIRONMENT_URL/oauth/token" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=client_credentials&client_id=$SCALEKIT_CLIENT_ID&client_secret=$SCALEKIT_CLIENT_SECRET"
   ```

4. In MCP Inspector, enable the **Authorization** custom header and set it to `Bearer <token>`

5. Click **Connect** — you should see `whoami`, `save_note`, and `list_my_notes` in the Tools tab

## Test with Claude Desktop / Cursor

MCP clients that support OAuth 2.1 handle the full flow automatically:

1. Client POSTs to `/mcp` and gets a `401` with a `WWW-Authenticate` header
2. Client fetches `/.well-known/oauth-protected-resource` to find the authorization server
3. Client fetches `/.well-known/oauth-authorization-server` to get the `registration_endpoint`
4. Client registers itself via DCR and starts the Authorization Code + PKCE flow
5. User signs up or logs in through Scalekit (auth methods from your dashboard)
6. Client sends authenticated requests to `/mcp`

For Claude Code:

```bash
claude mcp add --transport http xmcp-server http://localhost:3001/mcp
```

## How the auth works

`scalekitProvider()` returns an xmcp `Middleware` with two parts:

- **`router`** — serves `/.well-known/oauth-protected-resource` (RFC 9728) and `/.well-known/oauth-authorization-server` (RFC 8414), proxied from Scalekit
- **`middleware`** — validates Bearer tokens on `/mcp` requests using Scalekit's JWKS keys, then sets up the session context

Tools access the authenticated user via `getSession()` from `src/lib/scalekit-auth.ts`.

When `@xmcp-dev/scalekit` publishes to npm, you can replace the vendored `scalekit-auth.ts` with the official xmcp plugin.

## Related

- [xmcp documentation](https://xmcp.dev/docs)
- [Scalekit MCP Auth quickstart](https://docs.scalekit.com/authenticate/mcp/quickstart)
- [Scalekit xmcp quickstart](https://docs.scalekit.com/authenticate/mcp/xmcp-quickstart)
- [MCP Authorization spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)