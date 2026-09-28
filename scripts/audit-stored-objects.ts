/**
 * Report stored objects that no database row points at. Report only.
 *
 *   npx tsx scripts/audit-stored-objects.ts --references refs.txt --inventory inventory.txt
 *   npx tsx scripts/audit-stored-objects.ts --references refs.txt --uploads-dir ./uploads
 *   … --out report.json --min-age-hours 24
 *
 * Inputs, and how to produce them, are in docs/ERASURE_ORPHAN_AUDIT.md. This
 * script opens no database connection, needs no credentials and has no way to
 * delete anything; see server/object-audit.ts for why.
 *
 * Exit codes: 0 nothing unreferenced; 1 candidates listed for review;
 * 2 bad arguments or unreadable input.
 */
import fs from 'node:fs';
import path from 'node:path';

import { compareObjects, parseInventory, parseReferences, type InventoryEntry } from '../server/object-audit';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function walkUploads(root: string): InventoryEntry[] {
  const out: InventoryEntry[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const relative = path.relative(root, full).split(path.sep).join('/');
        out.push({ uri: `file://${relative}`, updated: fs.statSync(full).mtime });
      }
    }
  };
  walk(root);
  return out;
}

function main(): number {
  const referencesPath = arg('references');
  const inventoryPath = arg('inventory');
  const uploadsDir = arg('uploads-dir');
  const outPath = arg('out');
  const minAgeHours = Number(arg('min-age-hours') ?? '24');

  if (!referencesPath || (!inventoryPath && !uploadsDir) || (inventoryPath && uploadsDir)
      || !Number.isFinite(minAgeHours) || minAgeHours < 0) {
    console.error(
      'usage: --references <file> (--inventory <file> | --uploads-dir <dir>) ' +
        '[--out report.json] [--min-age-hours 24]'
    );
    return 2;
  }

  let report;
  try {
    const references = parseReferences(fs.readFileSync(referencesPath, 'utf8'));
    const inventory = uploadsDir
      ? walkUploads(path.resolve(uploadsDir))
      : parseInventory(fs.readFileSync(inventoryPath!, 'utf8'));
    report = compareObjects(references, inventory, { now: new Date(), minAgeHours });
  } catch (error) {
    console.error(`could not read the inputs: ${error instanceof Error ? error.message : error}`);
    return 2;
  }

  console.log(report.label);
  console.log(`references ${report.referencesRead} · inventory ${report.inventoryRead} · ` +
    `scopes ${report.scopes.join(', ') || 'none'} · matched ${report.matched}`);
  console.log(`unreferenced objects (candidates for review): ${report.unreferencedObjects.length}`);
  for (const uri of report.unreferencedObjects) console.log(`  ${uri}`);
  console.log(`too recent to judge (< ${minAgeHours} h): ${report.tooRecentToJudge.length}`);
  console.log(`rows whose object is absent: ${report.referencesWithoutObjects.length}`);
  for (const uri of report.referencesWithoutObjects) console.log(`  ${uri}`);
  console.log(`references outside the inventory's scope (not judged): ${report.referencesOutOfScope}`);
  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`report written to ${outPath}`);
  }
  return report.unreferencedObjects.length ? 1 : 0;
}

process.exitCode = main();
