/**
 * Seed runner: applies reference data (dropdowns + checklist definitions) and,
 * when the Excel workbook is available, transactional seed events.
 *
 * Usage:
 *   npm run db:seed:local     → local D1
 *   npm run db:seed:preview    → remote/preview D1 (explicit opt-in)
 *
 * Idempotent: uses INSERT OR IGNORE / ON CONFLICT upsert by natural key, safe to rerun.
 * Never deletes existing rows. Uses batched SQL for speed.
 */
import { ALL_DROPDOWNS } from "./seed-data";
import { CHECKLIST_DEFINITIONS } from "./checklist-definitions";
import { SqlBatch, queryAll, sqlStr, type SeedEnv } from "./d1-client";
import { seedEventsFromExcel } from "./import-events";

function parseEnv(): SeedEnv {
  const arg = process.argv.find((a) => a.startsWith("--env="));
  const env = arg ? arg.replace("--env=", "") : "local";
  if (env !== "local" && env !== "preview" && env !== "remote") {
    throw new Error(`Unknown --env: ${env}. Use local|preview|remote.`);
  }
  return env as SeedEnv;
}

function now(): string {
  return new Date().toISOString();
}

function seedDropdowns(env: SeedEnv): number {
  const batch = new SqlBatch(50);
  for (const d of ALL_DROPDOWNS) {
    const id = `dd_${d.list_key}_${d.value}`.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    batch.add(
      `INSERT OR IGNORE INTO dropdown_options (id, list_key, value, sort_order, is_active, metadata, created_at)
       VALUES (${sqlStr(id)}, ${sqlStr(d.list_key)}, ${sqlStr(d.value)}, ${d.sort_order}, 1, ${sqlStr(d.metadata ? JSON.stringify(d.metadata) : null)}, ${sqlStr(now())});`
    );
    batch.add(
      `UPDATE dropdown_options SET is_active = 1, sort_order = ${d.sort_order} WHERE id = ${sqlStr(id)};`
    );
  }
  batch.flush(env);
  return ALL_DROPDOWNS.length;
}

function seedChecklistDefinitions(env: SeedEnv): number {
  const batch = new SqlBatch(30);
  let order = 0;
  for (const d of CHECKLIST_DEFINITIONS) {
    order++;
    const id = `cd_${d.module}_${d.field_key}`.toLowerCase();
    batch.add(
      `INSERT INTO checklist_definitions (id, module, section, field_key, label, field_type, options, default_value, vfh_only, is_computed, triggers_task, sort_order, created_at)
       VALUES (${sqlStr(id)}, ${sqlStr(d.module)}, ${sqlStr(d.section)}, ${sqlStr(d.field_key)}, ${sqlStr(d.label)}, ${sqlStr(d.field_type)}, ${sqlStr(d.options ? JSON.stringify(d.options) : null)}, ${sqlStr(d.default_value ?? null)}, ${d.vfh_only ? 1 : 0}, ${d.is_computed ? 1 : 0}, ${sqlStr(d.triggers_task ? JSON.stringify(d.triggers_task) : null)}, ${order}, ${sqlStr(now())})
       ON CONFLICT(module, field_key) DO UPDATE SET
         section=excluded.section, label=excluded.label, field_type=excluded.field_type,
         options=excluded.options, default_value=excluded.default_value,
         vfh_only=excluded.vfh_only, is_computed=excluded.is_computed,
         triggers_task=excluded.triggers_task, sort_order=excluded.sort_order;`
    );
  }
  batch.flush(env);
  return CHECKLIST_DEFINITIONS.length;
}

async function main() {
  const env = parseEnv();
  console.log(`\n🌱 Seeding ${env} D1 (ncpa-hire-db)…\n`);

  console.log("  • Reference dropdowns + venues…");
  const ddCount = seedDropdowns(env);
  console.log(`    → ${ddCount} dropdown options upserted.`);

  console.log("  • Checklist definitions (Operations + Accounts)…");
  const cdCount = seedChecklistDefinitions(env);
  console.log(`    → ${cdCount} checklist definitions upserted.`);

  console.log("  • Transactional events from Excel…");
  const eventCount = await seedEventsFromExcel(env, now);
  console.log(`    → ${eventCount} events upserted.`);

  const ddRows = queryAll<{ c: number }>(`SELECT COUNT(*) AS c FROM dropdown_options;`, env);
  const cdRows = queryAll<{ c: number }>(`SELECT COUNT(*) AS c FROM checklist_definitions;`, env);
  const evRows = queryAll<{ c: number }>(`SELECT COUNT(*) AS c FROM events;`, env);
  const orgRows = queryAll<{ c: number }>(`SELECT COUNT(*) AS c FROM organisations;`, env);
  const ctRows = queryAll<{ c: number }>(`SELECT COUNT(*) AS c FROM contacts;`, env);
  const vbRows = queryAll<{ c: number }>(`SELECT COUNT(*) AS c FROM venue_bookings;`, env);

  console.log(`\n✅ Seed complete (${env}).`);
  console.log(`     dropdown_options:      ${ddRows[0]?.c ?? 0}`);
  console.log(`     checklist_definitions: ${cdRows[0]?.c ?? 0}`);
  console.log(`     organisations:         ${orgRows[0]?.c ?? 0}`);
  console.log(`     contacts:              ${ctRows[0]?.c ?? 0}`);
  console.log(`     events:                ${evRows[0]?.c ?? 0}`);
  console.log(`     venue_bookings:        ${vbRows[0]?.c ?? 0}`);
  console.log("");
}

main().catch((err) => {
  console.error("\n❌ Seed failed:", err);
  process.exit(1);
});
