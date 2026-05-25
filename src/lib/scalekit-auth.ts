import {
  Router,
  Request,
  Response,
  NextFunction,
  type RequestHandler,
} from "express";
import { createContext, type Middleware } from "xmcp";
import { createRemoteJWKSet, jwtVerify, errors } from "jose";
import { Scalekit } from "@scalekit-sdk/node";

// --- Types ---

export interface ScalekitConfig {
  readonly environmentUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly baseURL: string;
  readonly resourceId?: string;
  readonly docsURL?: string;
  readonly scopes?: readonly string[];
}

export interface JWTClaims {
  readonly sub: string;
  readonly iss: string;
  readonly aud?: string | readonly string[];
  readonly exp: number;
  readonly iat: number;
  readonly scope?: string;
  readonly sid?: string;
  readonly org_id?: string;
}

export interface Session {
  readonly userId: string;
  readonly scopes: readonly string[];
  readonly organizationId?: string;
  readonly expiresAt: Date;
  readonly issuedAt: Date;
  readonly claims: JWTClaims;
}

interface SessionContext {
  session: Session | null;
}

interface ClientContext {
  client: Scalekit;
}

// --- Contexts (global via AsyncLocalStorage) ---

const sessionContext = createContext<SessionContext>({
  name: "scalekit-context-session",
});

const clientContext = createContext<ClientContext>({
  name: "scalekit-context-client",
});

// --- Public accessors (usable from tools) ---

export function getSession(): Session {
  const ctx = sessionContext.getContext();
  if (!ctx.session) {
    throw new Error(
      "[Scalekit] Session not initialized. " +
        "Ensure this is called within a protected route that passed authentication."
    );
  }
  return ctx.session;
}

export function getClient(): Scalekit {
  const { client } = clientContext.getContext();
  if (!client) {
    throw new Error(
      "[Scalekit] Client not initialized. " +
        "Make sure scalekitProvider() is configured in your middleware."
    );
  }
  return client;
}

// --- JWT helpers ---

type TokenVerifyResult =
  | { readonly ok: true; readonly claims: JWTClaims }
  | { readonly ok: false; readonly error: "expired" | "invalid" };

async function verifyScalekitToken(
  token: string,
  jwksUrl: URL,
  issuer: string,
  audience?: string
): Promise<TokenVerifyResult> {
  try {
    const JWKS = createRemoteJWKSet(jwksUrl);

    const verifyOptions: Record<string, unknown> = {
      issuer,
      clockTolerance: 30,
    };
    if (audience) {
      verifyOptions.audience = audience;
    }

    const { payload } = await jwtVerify(token, JWKS, verifyOptions);

    if (!payload.sub) {
      console.error("[Scalekit] Missing required JWT claim: sub");
      return { ok: false, error: "invalid" };
    }

    return { ok: true, claims: payload as unknown as JWTClaims };
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      console.warn("[Scalekit] JWT has expired");
      return { ok: false, error: "expired" };
    }
    console.error("[Scalekit] JWT verification failed:", error);
    return { ok: false, error: "invalid" };
  }
}

function claimsToSession(claims: JWTClaims): Session {
  const scopes = claims.scope ? claims.scope.split(" ") : [];
  return {
    userId: claims.sub,
    scopes,
    organizationId: claims.org_id,
    expiresAt: new Date(claims.exp * 1000),
    issuedAt: new Date(claims.iat * 1000),
    claims,
  };
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
  return parts[1];
}

// --- Provider factory ---

export function scalekitProvider(config: ScalekitConfig): Middleware {
  if (!config.environmentUrl) {
    throw new Error("[Scalekit] Missing required config: environmentUrl");
  }
  if (!config.clientId) {
    throw new Error("[Scalekit] Missing required config: clientId");
  }
  if (!config.clientSecret) {
    throw new Error("[Scalekit] Missing required config: clientSecret");
  }
  if (!config.baseURL) {
    throw new Error("[Scalekit] Missing required config: baseURL");
  }

  const client = new Scalekit(
    config.environmentUrl,
    config.clientId,
    config.clientSecret
  );

  clientContext.provider({ client }, () => {});
  sessionContext.provider({ session: null }, () => {});

  const envUrl = config.environmentUrl.replace(/\/$/, "");
  const authServerBase = config.resourceId
    ? `${envUrl}/resources/${config.resourceId}`
    : envUrl;

  // Pre-fetch JWKS URI — try OAuth AS metadata first, then OIDC discovery
  let resolvedJwksUri: URL | null = null;
  (async () => {
    try {
      const urls = [
        `${authServerBase}/.well-known/oauth-authorization-server`,
        `${authServerBase}/.well-known/openid-configuration`,
      ];
      for (const url of urls) {
        const response = await fetch(url);
        if (response.ok) {
          const meta = (await response.json()) as { jwks_uri?: string };
          if (meta.jwks_uri) {
            resolvedJwksUri = new URL(meta.jwks_uri);
            console.log(
              "[Scalekit] Resolved JWKS URI:",
              resolvedJwksUri.toString()
            );
            return;
          }
        }
      }
    } catch (e) {
      console.warn("[Scalekit] Could not pre-fetch JWKS URI:", e);
    }
  })();

  return {
    middleware: buildMiddleware(config, authServerBase, () => resolvedJwksUri),
    router: buildRouter(config, authServerBase),
  };
}

// --- Router ---

function buildRouter(config: ScalekitConfig, authServerBase: string): Router {
  const router = Router();
  const baseUrl = config.baseURL.replace(/\/$/, "");

  router.get(
    "/.well-known/oauth-protected-resource",
    (_req: Request, res: Response) => {
      const metadata = {
        resource: baseUrl,
        authorization_servers: [authServerBase],
        bearer_methods_supported: ["header"],
        ...(config.docsURL && { resource_documentation: config.docsURL }),
        ...(config.scopes &&
          config.scopes.length > 0 && { scopes_supported: config.scopes }),
      };
      res.json(metadata);
    }
  );

  router.get(
    "/.well-known/oauth-authorization-server",
    async (_req: Request, res: Response) => {
      try {
        // Try OAuth AS metadata first (required for resource-specific paths with DCR),
        // then fall back to OIDC discovery
        const asUrl = `${authServerBase}/.well-known/oauth-authorization-server`;
        const asResponse = await fetch(asUrl);
        if (asResponse.ok) {
          const data = await asResponse.json();
          res.json(data);
          return;
        }
        const oidcUrl = `${authServerBase}/.well-known/openid-configuration`;
        const response = await fetch(oidcUrl);
        if (response.ok) {
          const data = await response.json();
          res.json(data);
          return;
        }
        // Fallback
        res.json({
          issuer: authServerBase,
          authorization_endpoint: `${authServerBase}/authorize`,
          token_endpoint: `${authServerBase}/token`,
          jwks_uri: `${authServerBase}/.well-known/jwks`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: [
            "none",
            "client_secret_post",
          ],
          scopes_supported: ["openid", "profile", "email", "offline_access"],
        });
      } catch (error) {
        console.error("[Scalekit] Failed to fetch OAuth metadata:", error);
        res.status(500).json({ error: "Failed to get OAuth configuration" });
      }
    }
  );

  return router;
}

// --- Middleware ---

function buildMiddleware(
  config: ScalekitConfig,
  authServerBase: string,
  getJwksUri: () => URL | null
): RequestHandler {
  const wwwAuth = `Bearer resource_metadata="/.well-known/oauth-protected-resource"`;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/mcp")) {
      next();
      return;
    }

    try {
      const token = extractBearerToken(req.headers.authorization);

      if (!token) {
        res.setHeader("WWW-Authenticate", wwwAuth);
        res.status(401).json({
          error: "unauthorized",
          error_description: "Missing or invalid bearer token",
        });
        return;
      }

      const jwksUrl =
        getJwksUri() || new URL(`${authServerBase}/.well-known/jwks`);
      const result = await verifyScalekitToken(
        token,
        jwksUrl,
        config.environmentUrl.replace(/\/$/, "")
      );

      if (!result.ok) {
        const desc =
          result.error === "expired"
            ? "Token has expired"
            : "Token verification failed";
        res.setHeader(
          "WWW-Authenticate",
          `${wwwAuth}, error="invalid_token", error_description="${desc}"`
        );
        res.status(401).json({
          error:
            result.error === "expired" ? "token_expired" : "invalid_token",
          error_description: desc,
        });
        return;
      }

      const session = claimsToSession(result.claims);
      sessionContext.provider({ session }, () => next());
    } catch (error) {
      console.error("[Scalekit] Authentication error:", error);
      res.setHeader(
        "WWW-Authenticate",
        `${wwwAuth}, error="invalid_token"`
      );
      res.status(401).json({
        error: "server_error",
        error_description: "Authentication processing failed",
      });
    }
  };
}