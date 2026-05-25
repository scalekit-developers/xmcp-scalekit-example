import { scalekitProvider } from "./lib/scalekit-auth";

export default scalekitProvider({
  environmentUrl: process.env.SCALEKIT_ENVIRONMENT_URL!,
  clientId: process.env.SCALEKIT_CLIENT_ID!,
  clientSecret: process.env.SCALEKIT_CLIENT_SECRET!,
  baseURL: process.env.BASE_URL || "http://localhost:3002",
  resourceId: process.env.SCALEKIT_RESOURCE_ID,
  scopes: ["openid", "profile", "email"],
});