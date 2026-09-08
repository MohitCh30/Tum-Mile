import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  DATABASE_URL: z.string().url(),

  SESSION_COOKIE_NAME: z.string().default("tum_mile_session"),
  SESSION_SECRET: z.string().min(32),
  SESSION_IDLE_TIMEOUT_MS: z.coerce.number().default(86_400_000),
  SESSION_ABSOLUTE_TIMEOUT_MS: z.coerce.number().default(2_592_000_000),

  EMAIL_FROM: z.string().default("Tum Mile <hello@tummile.in>"),
  EMAIL_MAGIC_LINK_BASE_URL: z.string().url(),

  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),

  STORAGE_MODE: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./dev-media"),
  S3_ENDPOINT: z.string().optional().default(""),
  S3_REGION: z.string().optional().default("us-east-1"),
  S3_BUCKET: z.string().optional().default(""),
  S3_ACCESS_KEY: z.string().optional().default(""),
  S3_SECRET_KEY: z.string().optional().default(""),

  RATE_LIMIT_MAGIC_LINK: z.coerce.number().default(3),
  RATE_LIMIT_MAGIC_LINK_WINDOW_MS: z.coerce.number().default(3_600_000),
  RATE_LIMIT_VERIFY: z.coerce.number().default(10),
  RATE_LIMIT_VERIFY_WINDOW_MS: z.coerce.number().default(900_000),
  RATE_LIMIT_DISCOVERY: z.coerce.number().default(30),
  RATE_LIMIT_DISCOVERY_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_LIKES: z.coerce.number().default(20),
  RATE_LIMIT_LIKES_WINDOW_MS: z.coerce.number().default(3_600_000),
  RATE_LIMIT_MESSAGE: z.coerce.number().default(40),
  RATE_LIMIT_MESSAGE_WINDOW_MS: z.coerce.number().default(3_600_000),
  RATE_LIMIT_REPORT: z.coerce.number().default(5),
  RATE_LIMIT_REPORT_WINDOW_MS: z.coerce.number().default(3_600_000),
  RATE_LIMIT_PHOTO_UPLOAD: z.coerce.number().default(10),
  RATE_LIMIT_PHOTO_UPLOAD_WINDOW_MS: z.coerce.number().default(3_600_000),
});

export const config = envSchema.parse(process.env);

export type Config = z.infer<typeof envSchema>;