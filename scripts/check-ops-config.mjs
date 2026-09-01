/**
 * Keeps the alert rules and the dashboard honest about what the code exports.
 *
 * Monitoring config fails silently in the worst possible way: a metric gets
 * renamed, the PromQL still parses, the panel draws an empty graph, and the
 * alert that was supposed to catch a broken model never fires again because its
 * expression matches nothing. Nobody notices, because "no data" and "nothing
 * wrong" look identical on a dashboard.
 *
 * So this asserts four things:
 *
 *   1. Every healthai_* metric named in ops/alerts.yml and ops/dashboard.json
 *      is actually defined in server/metrics.ts.
 *   2. Every alert carries a runbook annotation.
 *   3. Every runbook anchor resolves to a heading in ops/RUNBOOK.md.
 *   4. Every alert is exercised by at least one case in ops/alerts_test.yml.
 *
 * Deliberately regex-based rather than parsing YAML: `yaml` is only a
 * transitive dependency here, and a check that fails when someone prunes the
 * dependency tree is a check that gets deleted.
 *
 * Run: node scripts/check-ops-config.mjs
 */
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const metricsSrc = read('server/metrics.ts');
const alertsSrc = read('ops/alerts.yml');
const dashSrc = read('ops/dashboard.json');
const runbookSrc = read('ops/RUNBOOK.md');

const failures = [];

// ── 1. Metric names ────────────────────────────────────────────────────────

const defined = new Set(
  [...metricsSrc.matchAll(/name:\s*'(healthai_[a-z_]+)'/g)].map((m) => m[1])
);
// Histograms expose _bucket/_sum/_count; prom-client derives them, so a
// reference to one is a reference to the histogram that produced it.
for (const base of [...defined]) {
  for (const suffix of ['_bucket', '_sum', '_count']) defined.add(base + suffix);
}
// collectDefaultMetrics adds process/runtime series under the same prefix.
const isDefaultMetric = (n) =>
  /^healthai_(process_|nodejs_|up$)/.test(n);

if (defined.size === 0) {
  failures.push('server/metrics.ts: no metric definitions matched — has the shape changed?');
}

for (const [file, src] of [['ops/alerts.yml', alertsSrc], ['ops/dashboard.json', dashSrc]]) {
  const used = new Set([...src.matchAll(/healthai_[a-z_]+/g)].map((m) => m[0]));
  for (const name of used) {
    if (!defined.has(name) && !isDefaultMetric(name)) {
      failures.push(`${file}: references "${name}", which server/metrics.ts does not define`);
    }
  }
}

// ── 2 & 3. Runbook coverage ────────────────────────────────────────────────

const anchors = new Set(
  [...runbookSrc.matchAll(/^#{2,}\s+(.+)$/gm)].map((m) =>
    m[1].trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  )
);

const alertNames = [...alertsSrc.matchAll(/^\s*-\s*alert:\s*(\S+)/gm)].map((m) => m[1]);
const runbookRefs = [...alertsSrc.matchAll(/runbook:\s*"ops\/RUNBOOK\.md#([a-z0-9]+)"/g)].map(
  (m) => m[1]
);

if (alertNames.length === 0) failures.push('ops/alerts.yml: no alert rules found');

if (alertNames.length !== runbookRefs.length) {
  failures.push(
    `ops/alerts.yml: ${alertNames.length} alerts but ${runbookRefs.length} runbook annotations — ` +
      'every alert needs one, or the person paged at 03:00 has nothing to act on'
  );
}

for (const anchor of runbookRefs) {
  if (!anchors.has(anchor)) {
    failures.push(`ops/RUNBOOK.md: no section matching "#${anchor}"`);
  }
}

// ── 4. Every alert is exercised by a test ──────────────────────────────────
//
// An untested alert is a guess about PromQL semantics. NoScanSubmissions was
// silent in exactly the case it existed for — sum(increase(...)) over a metric
// with no series returns an empty vector, not zero — and only a test found it.

const testSrc = read('ops/alerts_test.yml');
const tested = new Set(
  [...testSrc.matchAll(/alertname:\s*(\S+)/g)].map((m) => m[1])
);

for (const name of alertNames) {
  if (!tested.has(name)) {
    failures.push(
      `ops/alerts_test.yml: no test exercises "${name}" — add a firing or a ` +
        'stays-silent case before shipping it'
    );
  }
}

// ── Report ─────────────────────────────────────────────────────────────────

if (failures.length) {
  console.error('Ops config check FAILED:\n');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}

console.log(
  `Ops config OK: ${alertNames.length} alerts, all metric references defined, ` +
    `all runbook anchors resolve, all alerts covered by ${tested.size} tested names.`
);
