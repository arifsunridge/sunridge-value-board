import "server-only";
import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.string().default("development"),
    AUTH_MODE: z.enum(["dev", "entra"]).default("dev"),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters."),
    STORE: z.enum(["memory", "lists"]).default("memory"),
    APP_BASE_URL: z.string().url().default("http://localhost:3000"),
    ENTRA_TENANT_ID: z.string().optional(),
    ENTRA_CLIENT_ID: z.string().optional(),
    ENTRA_CLIENT_SECRET: z.string().optional(),
    ENTRA_CERT_THUMBPRINT_SHA256: z.string().optional(),
    ENTRA_CERT_PRIVATE_KEY_PATH: z.string().optional(),
    ENTRA_CERT_PRIVATE_KEY: z.string().optional(),
    SHAREPOINT_SITE_ID: z.string().optional(),
    CAPTURE_ENABLED: z.enum(["true", "false"]).default("false"),
    ANTHROPIC_API_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.AUTH_MODE === "dev") {
      ctx.addIssue({ code: "custom", message: "AUTH_MODE=dev is refused in production." });
    }
    if (env.NODE_ENV === "production" && env.STORE === "memory") {
      ctx.addIssue({ code: "custom", message: "STORE=memory is refused in production." });
    }
    const need = (keys: (keyof typeof env)[], why: string) =>
      keys.filter((k) => !env[k]).forEach((k) => ctx.addIssue({ code: "custom", message: `${k} is required ${why}.` }));
    if (env.AUTH_MODE === "entra") need(["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET"], "for Microsoft sign-in");
    if (env.STORE === "lists") need(["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CERT_THUMBPRINT_SHA256", "SHAREPOINT_SITE_ID"], "for Microsoft Lists");
    if (env.CAPTURE_ENABLED === "true") need(["ANTHROPIC_API_KEY"], "for Capture");
  });

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

export function config(): Config {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Configuration problem:\n${parsed.error.issues.map((i) => `- ${i.message}`).join("\n")}`);
    }
    cached = parsed.data;
  }
  return cached;
}
