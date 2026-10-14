import "server-only";
import { z } from "zod";

/** Live HBF database hosts. The board uses its own database on the Render MySQL only. */
const LIVE_DB_HOST = /(^|\.)hbroch\.com$/i;

const schema = z
  .object({
    NODE_ENV: z.string().default("development"),
    /** "dev": choose a seeded Person locally. "portal": sign-in through the HBF Portal (ADR 0006). */
    AUTH_MODE: z.enum(["dev", "portal"]).default("dev"),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters.").optional(),
    STORE: z.enum(["memory", "mysql"]).default("memory"),
    APP_BASE_URL: z.string().url().default("http://localhost:3000"),

    CF_ACCESS_TEAM_DOMAIN: z.string().optional(),
    CF_ACCESS_AUD: z.string().optional(),
    PORTAL_INTERNAL_URL: z.string().url().optional(),
    PORTAL_SERVICE_TOKEN: z.string().optional(),
    PORTAL_APP_SLUG: z.string().default("value-board"),
    /** The portal's own address, for links back to it. */
    PORTAL_URL: z.string().url().default("https://hbf.sunridge.app"),
    /** The Company whose Managers sign in through this portal (the HBF Portal: HBF). */
    PORTAL_COMPANY_ID: z.string().default("hbf"),

    DB_HOST: z.string().optional(),
    DB_PORT: z.coerce.number().default(3306),
    DB_USER: z.string().default("value_board"),
    DB_PASSWORD: z.string().default(""),
    DB_NAME: z.string().default("value_board"),
    DB_SSL: z.enum(["true", "false"]).default("false"),

    CAPTURE_ENABLED: z.enum(["true", "false"]).default("false"),
    CLAUDE_ACCESS_ENABLED: z.enum(["true", "false"]).default("false"),
    ANTHROPIC_API_KEY: z.string().optional(),
    ENTRA_TENANT_ID: z.string().optional(),
    ENTRA_CLIENT_ID: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (env.NODE_ENV === "production" && env.AUTH_MODE === "dev") fail("AUTH_MODE=dev is refused in production.");
    if (env.NODE_ENV === "production" && env.STORE === "memory") fail("STORE=memory is refused in production.");
    const need = (keys: (keyof typeof env)[], why: string) =>
      keys.filter((k) => !env[k]).forEach((k) => fail(`${k} is required ${why}.`));
    if (env.AUTH_MODE === "dev") need(["SESSION_SECRET"], "for local sign-in");
    if (env.AUTH_MODE === "portal") {
      need(["CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "PORTAL_INTERNAL_URL", "PORTAL_SERVICE_TOKEN"], "for sign-in through the HBF Portal");
    }
    if (env.STORE === "mysql") need(["DB_HOST"], "for the MySQL store");
    if (env.DB_HOST && LIVE_DB_HOST.test(env.DB_HOST.trim())) {
      fail(`DB_HOST ${env.DB_HOST} is the live HBF database. The board uses its own database on the Render MySQL.`);
    }
    if (env.CAPTURE_ENABLED === "true") need(["ANTHROPIC_API_KEY"], "for Capture");
    if (env.CLAUDE_ACCESS_ENABLED === "true" && env.AUTH_MODE === "portal") {
      need(["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID"], "for Claude access");
    }
  });

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

/** An empty line in .env (`PORTAL_URL=`) means "not set", not an empty value. */
function withoutEmpty(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== ""));
}

export function config(): Config {
  if (!cached) {
    const parsed = schema.safeParse(withoutEmpty(process.env));
    if (!parsed.success) {
      throw new Error(`Configuration problem:\n${parsed.error.issues.map((i) => `- ${i.message}`).join("\n")}`);
    }
    cached = parsed.data;
  }
  return cached;
}
