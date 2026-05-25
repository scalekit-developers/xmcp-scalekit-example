# xmcp + Scalekit Example

A working MCP server built with [xmcp](https://xmcp.dev) and authenticated using [Scalekit](https://scalekit.com) as the OAuth 2.1 authorization server.

This demonstrates the full MCP OAuth 2.1 flow:

1. MCP client discovers the server's auth requirements via `/.well-known/oauth-protected-resource`
2. Client registers dynamically with Scalekit (DCR)
3. User authenticates through Scalekit's OAuth flow (Authorization Code + PKCE)
4. Client sends Bearer tokens to the MCP server
5. Server verifies tokens using Scalekit's JWKS keys

## What's included

| File | Purpose |
|------|---------|
| `src/lib/scalekit-auth.ts` | Auth provider: JWT verification, discovery endpoints, session context |
| `src/middleware.ts` | Wires the provider into xmcp |
| `src/tools/whoami.ts` | Tool that returns the authenticated user's session |
| `src/tools/greet.ts` | Tool that greets the user by name using their identity |

## Setup

### 1. Get Scalekit credentials

1. Go to the [Scalekit Dashboard](https://app.scalekit.com)
2. Navigate to **MCP Auth** and register a new MCP server resource
3. Copy your environment URL, client ID, and client secret

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your Scalekit credentials
```

### 3. Install and run

```bash
npm install
npm run dev
```

The server starts on `http://localhost:3002`.

## Testing the endpoints

### Discovery metadata

```bash
# Protected resource metadata (tells MCP clients where to authenticate)
curl http://localhost:3002/.well-known/oauth-protected-resource

# Authorization server metadata (proxied from Scalekit)
curl http://localhost:3002/.well-known/oauth-authorization-server
```

### Auth challenge

```bash
# Request without token → 401 with WWW-Authenticate header
curl -v -X POST http://localhost:3002/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Request with invalid token → 401 invalid_token
curl -v -X POST http://localhost:3002/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid-token" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

### With a real MCP client

Connect any MCP client that supports OAuth 2.1 (Claude Desktop, Cursor, etc.) to `http://localhost:3002/mcp`. The client will handle the full OAuth flow automatically.

## How the auth works

The `scalekitProvider()` function returns an xmcp `Middleware` object with:

- **`router`** — serves `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`
- **`middleware`** — intercepts `/mcp` requests, validates Bearer tokens via JWKS, and sets up the session context

Tools access the authenticated user via `getSession()` which returns:

```typescript
{
  userId: string;       // JWT sub claim
  scopes: string[];     // from JWT scope claim
  organizationId?: string; // from JWT org_id claim
  expiresAt: Date;
  issuedAt: Date;
  claims: JWTClaims;    // full JWT payload
}
```

## Related

- [xmcp documentation](https://xmcp.dev/docs)
- [Scalekit MCP Auth docs](https://docs.scalekit.com/mcp)
- [MCP OAuth 2.1 spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)