import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { getSession } from "../lib/scalekit-auth";

export const schema = {
  name: z.string().describe("The name of the user to greet"),
};

export const metadata: ToolMetadata = {
  name: "greet",
  description: "Greet the user with their Scalekit identity",
};

export default function greet({ name }: InferSchema<typeof schema>): string {
  const session = getSession();
  return `Hello, ${name}! Your user ID is ${session.userId}`;
}