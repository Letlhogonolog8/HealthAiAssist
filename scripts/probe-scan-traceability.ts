/**
 * Confirms a scan result records which model produced it.
 *
 *   npx tsx scripts/probe-scan-traceability.ts <baseUrl> <imagePath> <scanType>
 */
import fs from 'fs';

const BASE = (process.argv[2] || 'http://localhost:5000').replace(/\/+$/, '');
const IMAGE = process.argv[3];
const SCAN_TYPE = process.argv[4] || 'lung';
let cookie = '';

async function call(method: string, path: string, body?: any, form?: FormData) {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: form ? (form as any) : body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function main() {
  const username = `trace_${Math.random().toString(36).slice(2, 8)}`;
  await call('POST', '/api/auth/register', {
    username, password: 'TraceProbe123', role: 'patient',
    fullName: 'Trace Probe', email: `${username}@example.com`,
  });
  await call('POST', '/api/auth/login', { username, password: 'TraceProbe123' });

  const form = new FormData();
  form.append('scanType', SCAN_TYPE);
  // multer checks the declared MIME type, so the Blob needs one.
  form.append('image', new Blob([fs.readFileSync(IMAGE)], { type: 'image/jpeg' }), 'scan.jpg');

  const res = await call('POST', '/api/scan/upload', undefined, form);
  console.log(`HTTP ${res.status}`);
  if (res.status !== 200) {
    console.log(JSON.stringify(res.json, null, 2).slice(0, 600));
    process.exit(1);
  }
  const { analysis, scan } = res.json;
  console.log(`  status            : ${analysis?.status}`);
  console.log(`  confidence        : ${analysis?.confidence}`);
  console.log(`  modelVersion      : ${analysis?.modelVersion}`);
  console.log(`  scan.modelVersion : ${scan?.modelVersion}`);
  console.log(`  scan.riskLevel    : ${scan?.riskLevel}`);
  console.log(`  scan.processingTime: ${scan?.processingTime}`);
  if (!scan?.modelVersion) {
    console.error('\nFAIL: the stored scan has no modelVersion.');
    process.exit(1);
  }
  console.log('\nStored result is attributable to a specific model.');
}

main();
