/**
 * One-time first-Admin bootstrap. Prompts interactively for email, name, and
 * a strong password. Never commits credentials to the repo.
 *
 * Usage: npm run bootstrap:admin
 *
 * Runs the insert directly against local D1 by default. Pass --remote to
 * create the admin in the production database.
 */
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

function ask(rl: ReturnType<typeof createInterface>, q: string): Promise<string> {
  return rl.question(q).then((a) => a.trim());
}

function runSql(sql: string, remote: boolean): void {
  execFileSync(
    "wrangler",
    ["d1", "execute", "ncpa-hire-db", remote ? "--remote" : "--local", "--command", sql],
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } }
  );
}

async function main() {
  const remote = process.argv.includes("--remote");
  console.log(`\n🔐 Bootstrap admin (${remote ? "PRODUCTION" : "local"} D1)\n`);

  const rl = createInterface({ input, output });
  const email = await ask(rl, "Admin email: ");
  const name = await ask(rl, "Admin name: ");
  const password = await ask(rl, "Password (min 12 chars): ");

  if (!email || !email.includes("@")) {
    console.error("❌ Valid email required.");
    process.exit(1);
  }
  if (!name) {
    console.error("❌ Name required.");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("❌ Password must be at least 12 characters.");
    process.exit(1);
  }

  rl.close();

  // We can't run the Worker's hashPassword in plain Node easily, so we compute
  // the scrypt hash inline using the same algorithm and write it directly.
  const { scrypt } = await import("@noble/hashes/scrypt");
  const { randomBytes } = await import("@noble/hashes/utils");
  const salt = randomBytes(16);
  const hash = scrypt(password.normalize("NFKC"), salt, { N: 16384, r: 8, p: 1, dkLen: 32 });
  const toHex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
  const passwordHash = `scrypt:${toHex(salt)}:${toHex(hash)}`;

  const id = `user_bootstrap_${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const esc = (s: string) => s.replace(/'/g, "''");

  // Idempotent: update existing admin email, else insert.
  runSql(
    `INSERT INTO users (id, email, name, role, password_hash, password_algo, password_updated_at, is_active, created_at, updated_at)
     VALUES ('${id}', '${esc(email.toLowerCase())}', '${esc(name)}', 'admin', '${esc(passwordHash)}', 'scrypt', '${now}', 1, '${now}', '${now}')
     ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin', is_active = 1, updated_at = excluded.updated_at;`,
    remote
  );

  console.log(`\n✅ Admin created: ${email} (role: admin)`);
  console.log(`   Database: ${remote ? "PRODUCTION" : "local"} ncpa-hire-db`);
  console.log(`   Sign in at ${remote ? "https://ncpa-hire.pages.dev" : "http://localhost:5173"}/login\n`);
}

main().catch((err) => {
  console.error("❌ Bootstrap failed:", err);
  process.exit(1);
});
