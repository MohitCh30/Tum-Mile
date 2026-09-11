// Checks the SMTP login WITHOUT sending an email, so it costs nothing
// against the daily quota. Prints OK or the provider's reason. Never
// prints the credentials.
//
//   cd server && DOTENV_CONFIG_PATH="$PWD/.env.production" node scripts/smtp-check.mjs
import "dotenv/config";
import nodemailer from "nodemailer";

const env = process.env;
const user = env.SMTP_USER ?? "";
const pass = env.SMTP_PASS ?? "";

console.log(`host=${env.SMTP_HOST}:${env.SMTP_PORT} secure=${env.SMTP_SECURE}`);
console.log(`login looks like: ${user ? user.replace(/^(.{3}).*(@.*)?$/, "$1***$2") : "(EMPTY)"}`);
console.log(`key present: ${pass ? "yes" : "NO"}; starts with xsmtpsib-: ${pass.startsWith("xsmtpsib-")}`);
console.log(`from: ${env.EMAIL_FROM}`);

const t = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: Number(env.SMTP_PORT),
  secure: env.SMTP_SECURE === "true",
  auth: user ? { user, pass } : undefined,
});

try {
  await t.verify();
  console.log("SMTP login: OK");
} catch (err) {
  console.log(`SMTP login FAILED: code=${err.code} smtp=${err.responseCode} reply=${err.response ?? err.message}`);
}
