import { type ToolMetadata } from "xmcp";
import { getSession } from "../lib/scalekit-auth";

export const metadata: ToolMetadata = {
  name: "whoami",
  description:
    "Returns the authenticated MCP user session. userId is the JWT sub claim from Scalekit.",
};

export default function whoami(): string {
  const session = getSession();

  const info = {
    userId: session.userId,
    scopes: session.scopes,
    organizationId: session.organizationId || "N/A",
    expiresAt: session.expiresAt.toISOString(),
    issuedAt: session.issuedAt.toISOString(),
    claims: session.claims,
  };

  return JSON.stringify(info, null, 2);
}