import "dotenv/config";
import { z } from "zod";

// Every tunable lives here. If a value is read from process.env anywhere
// else in the codebase, that is a bug — it means it has no schema, no
// default, and no validation at boot.
/**
 * Booleans from the environment.
 *
 * NOT z.coerce.boolean(), which applies JavaScript truthiness: the string
 * "false" is a non-empty string, so it coerces to TRUE. Every documented
 * way of switching something off in a .env file would have switched it on.
 */
const boolish = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0", "yes", "no", "on", "off"])
    .default(fallback ? "true" : "false")
    .transform((v) => v === "true" || v === "1" || v === "yes" || v === "on");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // 3001 is Uptime Kuma on this machine; 3007 to stay out of its way.
  PORT: z.coerce.number().default(3007),
  CORS_ORIGIN: z.string().url().default("http://localhost:5173"),

  DATABASE_URL: z.string().url(),

  // Sessions
  SESSION_COOKIE_NAME: z.string().default("tum_mile_session"),
  SESSION_SECRET: z.string().min(32),
  SESSION_IDLE_TIMEOUT_MS: z.coerce.number().default(86_400_000), // 1 day
  SESSION_ABSOLUTE_TIMEOUT_MS: z.coerce.number().default(2_592_000_000), // 30 days

  // Email
  EMAIL_FROM: z.string().default("Tum Mile <hello@tummile.local>"),
  EMAIL_MAGIC_LINK_BASE_URL: z.string().url().default("http://localhost:5173"),
  MAGIC_LINK_TTL_MS: z.coerce.number().default(900_000), // 15 min

  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025), // Mailpit
  SMTP_SECURE: boolish(false),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),

  // The single pre-provisioned moderator identity.
  ADMIN_EMAIL: z.string().email().optional(),

  // Behind a Cloudflare tunnel, cloudflared connects over loopback and
  // every visitor looks like 127.0.0.1. Switch this on there so the real
  // address is read from CF-Connecting-IP. Leave it OFF when the server
  // is directly reachable — then the header is attacker-controlled.
  TRUST_PROXY: boolish(false),

  // Text affinity. Off in tests: loading a model would make every suite
  // wait on it, and the score is designed to be correct without it.
  EMBEDDINGS_ENABLED: boolish(true),
  EMBEDDINGS_CACHE_DIR: z.string().default("./.models"),

  // Daily budgets. Browsing is free; deciding is what is scarce.
  BUDGET_OUTBOUND_PER_DAY: z.coerce.number().default(6),
  BUDGET_INBOUND_PER_DAY: z.coerce.number().default(9),
  INBOUND_EXPIRY_DAYS: z.coerce.number().default(5),

  // Rate limits
  // Two tiers. The per-ADDRESS limit is what stops one person asking for
  // twenty links; the per-IP one stops a machine working through a list.
  // The IP tier is deliberately loose because a college wifi or an Indian
  // mobile network puts hundreds of real people behind one address.
  RATE_LIMIT_MAGIC_LINK: z.coerce.number().default(3),
  RATE_LIMIT_MAGIC_LINK_WINDOW_MS: z.coerce.number().default(3_600_000),
  RATE_LIMIT_MAGIC_LINK_PER_IP: z.coerce.number().default(40),
  RATE_LIMIT_VERIFY: z.coerce.number().default(10),
  RATE_LIMIT_VERIFY_WINDOW_MS: z.coerce.number().default(900_000),
  RATE_LIMIT_DISCOVERY: z.coerce.number().default(60),
  RATE_LIMIT_DISCOVERY_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_WRITE: z.coerce.number().default(40),
  RATE_LIMIT_WRITE_WINDOW_MS: z.coerce.number().default(3_600_000),
  RATE_LIMIT_REPORT: z.coerce.number().default(5),
  RATE_LIMIT_REPORT_WINDOW_MS: z.coerce.number().default(3_600_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Names only — never the values, which are secrets.
  const bad = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(`Invalid environment configuration: ${bad}`);
}

export const config = parsed.data;
export type Config = z.infer<typeof envSchema>;

export const isProd = config.NODE_ENV === "production";
