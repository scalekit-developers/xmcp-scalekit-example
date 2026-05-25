# xmcp + Scalekit OAuth Example

A working MCP server built with [xmcp](https://xmcp.dev) and secured with [Scalekit](https://scalekit.com) OAuth 2.1 authorization.

## What this does

- Serves an MCP server over Streamable HTTP at `/mcp`
- Validates Bearer tokens issued by Scalekit using JWKS
- Exposes OAuth discovery endpoints for MCP clients to connect automatically
- Provides two demo tools (`whoami`, `greet`) that use the authenticated session

## Project structure

| File | Purpose |
|------|---------|
| `src/lib/scalekit-auth.ts` | Auth provider: JWKS verification, OAuth discovery endpoints, session context |
| `src/middleware.ts` | Wires the Scalekit provider into xmcp as middleware |
| `src/tools/whoami.ts` | Returns the authenticated user's session info |
| `src/tools/greet.ts` | Greets the user using their identity from the JWT |
| `xmcp.config.ts` | Enables Streamable HTTP transport |

## Prerequisites

- Node.js 18+
- A [Scalekit](https://app.scalekit.com) account with an MCP server configured

## Setup

### 1. Get Scalekit credentials

1. Go to the [Scalekit Dashboard](https://app.scalekit.com)
2. Navigate to your environment and find **MCP Servers**
3. Create or select an MCP server — note the **Resource ID** shown below the server name (e.g. `res_...`)
4. Set the **Server URL** to `http://localhost:3001`
5. Ensure **Allow dynamic client registration** is checked
6. Copy your **Environment URL**, **Client ID**, and **Client Secret**

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
SCALEKIT_ENVIRONMENT_URL=https://your-env.scalekit.com
SCALEKIT_CLIENT_ID=skc_...
SCALEKIT_CLIENT_SECRET=skcs_...
SCALEKIT_RESOURCE_ID=res_...
BASE_URL=http://localhost:3001
PORT=3001
```

> **Important:** `SCALEKIT_RESOURCE_ID` is required. Without it, the server cannot advertise the `registration_endpoint` needed for Dynamic Client Registration (DCR), and MCP clients like Claude Desktop or Cursor will fail to connect.

### 3. Install and run

```bash
npm install
npm run dev
```

The server starts at `http://localhost:3001/mcp`.

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

5. Click **Connect** — you should see `whoami` and `greet` in the Tools tab

## Test with curl

```bash
# Get a token
TOKEN=$(curl -s -X POST "$SCALEKIT_ENVIRONMENT_URL/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=$SCALEKIT_CLIENT_ID&client_secret=$SCALEKIT_CLIENT_SECRET" \
  | jq -r .access_token)

# Call the MCP server
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Test with Claude Desktop / Cursor

MCP clients that support OAuth 2.1 handle the full flow automatically:

1. Client POSTs to `/mcp` and gets a `401` with a `WWW-Authenticate` header
2. Client fetches `/.well-known/oauth-protected-resource` to find the authorization server
3. Client fetches `/.well-known/oauth-authorization-server` to get the `registration_endpoint`
4. Client registers itself via DCR and starts the Authorization Code + PKCE flow
5. User authenticates through Scalekit, client receives a token
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

## Related

- [xmcp documentation](https://xmcp.dev/docs)
- [Scalekit MCP Auth quickstart](https://docs.scalekit.com/authenticate/mcp/quickstart)
- [MCP Authorization spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)