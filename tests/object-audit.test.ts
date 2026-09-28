/**
 * The stored-object audit: finds objects no row points at, and cannot delete.
 *
 * Pure comparison plus the CLI run against a real temporary uploads tree,
 * with every file checked to still be there afterwards.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  REPORT_LABEL,
  compareObjects,
  normaliseUri,
  parseInventory,
  parseReferences,
  scopeOf,
} from '../server/object-audit.ts';

const NOW = new Date('2026-09-28T12:00:00Z');
const OLD = new Date('2026-01-01T00:00:00Z');

describe('parsing', () => {
  test('locations normalise to the form rows store', () => {
    assert.equal(normaliseUri('  gs://b/scans/1.jpg \n'), 'gs://b/scans/1.jpg');
    assert.equal(normaliseUri('file://series\\7\\a.dcm'), 'file://series/7/a.dcm');
    assert.equal(normaliseUri('"file://x.png"'), 'file://x.png');
    assert.equal(normaliseUri('/etc/passwd'), null);
    assert.equal(normaliseUri(''), null);
  });

  test('gsutil ls -l output is read, headings and totals skipped', () => {
    const inventory = parseInventory([
      'gs://bucket/scans/:',
      '     12345  2026-01-02T03:04:05Z  gs://bucket/scans/a.jpg',
      '        11  2026-09-28T11:00:00Z  gs://bucket/scans/b.jpg',
      '                                 gs://bucket/series/',
      'TOTAL: 2 objects, 12356 bytes (12.07 KiB)',
    ].join('\n'));
    assert.deepEqual(inventory.map((e) => e.uri), ['gs://bucket/scans/a.jpg', 'gs://bucket/scans/b.jpg']);
    assert.equal(inventory[0].updated?.toISOString(), '2026-01-02T03:04:05.000Z');
  });

  test('references ignore comments and blanks', () => {
    const refs = parseReferences('# exported 2026-09-28\n\ngs://b/x.jpg\nfile://y.dcm\n');
    assert.deepEqual([...refs].sort(), ['file://y.dcm', 'gs://b/x.jpg']);
  });

  test('scope is the scheme and bucket', () => {
    assert.equal(scopeOf('gs://one/a/b.jpg'), 'gs://one');
    assert.equal(scopeOf('file://a/b.jpg'), 'file://');
  });
});

describe('comparison', () => {
  const inventory = [
    { uri: 'gs://b/scans/kept.jpg', updated: OLD },
    { uri: 'gs://b/scans/orphan.jpg', updated: OLD },
    { uri: 'gs://b/scans/just-written.jpg', updated: new Date('2026-09-28T11:30:00Z') },
  ];
  const references = new Set([
    'gs://b/scans/kept.jpg',
    'gs://b/scans/row-without-object.jpg',
    'gs://other-bucket/x.jpg',
    'file://local.dcm',
  ]);
  const report = compareObjects(references, inventory, { now: NOW, minAgeHours: 24 });

  test('an object no row points at is a candidate', () => {
    assert.deepEqual(report.unreferencedObjects, ['gs://b/scans/orphan.jpg']);
    assert.equal(report.matched, 1);
  });

  test('a recent object is not judged: it may be mid-upload', () => {
    assert.deepEqual(report.tooRecentToJudge, ['gs://b/scans/just-written.jpg']);
  });

  test('a row whose object is missing is reported, within scope only', () => {
    assert.deepEqual(report.referencesWithoutObjects, ['gs://b/scans/row-without-object.jpg']);
    assert.equal(report.referencesOutOfScope, 2, 'another bucket and local files are not judged');
  });

  test('the report says it is a list for review, not a verdict', () => {
    assert.equal(report.label, REPORT_LABEL);
    assert.match(report.label, /cannot delete/);
    assert.match(report.label, /not a confirmed orphan/);
  });
});

describe('the CLI', () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'scripts/audit-stored-objects.ts', ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 120_000,
    });

  test('finds the unreferenced file in an uploads tree and touches nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthai-object-audit-'));
    try {
      const uploads = path.join(dir, 'uploads');
      fs.mkdirSync(path.join(uploads, 'series', '7'), { recursive: true });
      const kept = path.join(uploads, 'series', '7', 'a.dcm');
      const orphan = path.join(uploads, 'scan-orphan.jpg');
      fs.writeFileSync(kept, 'x');
      fs.writeFileSync(orphan, 'y');
      const old = new Date('2026-01-01T00:00:00Z');
      fs.utimesSync(kept, old, old);
      fs.utimesSync(orphan, old, old);
      const refs = path.join(dir, 'refs.txt');
      fs.writeFileSync(refs, 'file://series/7/a.dcm\n');
      const out = path.join(dir, 'report.json');

      const result = run('--references', refs, '--uploads-dir', uploads, '--out', out);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      const report = JSON.parse(fs.readFileSync(out, 'utf8'));
      assert.deepEqual(report.unreferencedObjects, ['file://scan-orphan.jpg']);
      assert.ok(fs.existsSync(kept) && fs.existsSync(orphan), 'nothing was deleted');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('bad arguments exit 2', () => {
    assert.equal(run('--references').status, 2);
    assert.equal(run('--references', 'a', '--inventory', 'b', '--uploads-dir', 'c').status, 2);
  });

  test('the tool has no deletion code at all', () => {
    for (const file of ['scripts/audit-stored-objects.ts', 'server/object-audit.ts']) {
      const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      assert.ok(!/\b(unlink|rmSync|rmdirSync|rm\(|delete\(|deleteScanObject|removeStoredObject)/.test(src),
        `${file} contains a deletion call`);
    }
  });
});
