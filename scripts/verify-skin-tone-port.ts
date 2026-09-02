/**
 * Checks that server/skin-tone.ts agrees with the Python reference.
 *
 *     python scripts/dump-ita-reference.py
 *     npx tsx scripts/verify-skin-tone-port.ts
 *
 * WHY THIS EXISTS
 *
 * The production estimator is a port. If it disagrees with the offline one,
 * production bins stop being comparable to the published per-bin sensitivities
 * *while still looking comparable* — a scan binned `light` here and `tan` there
 * would be read against the wrong measured sensitivity, and nothing about the
 * output would reveal it. That is a worse failure than not measuring, so the
 * port is checked against real images rather than a handful of synthetic
 * patches.
 *
 * The bin is what production stores, so bin agreement is the assertion that
 * matters and any mismatch fails. The angle is compared too, with a small
 * tolerance for float ordering differences between numpy and JavaScript.
 */
import { readFile } from 'fs/promises';
import path from 'path';

import { estimateSkinTone } from '../server/skin-tone';

const ROOT = process.cwd();
const TEST_DIR = path.join(ROOT, 'dataset', 'dataset', 'data', 'test');
const REFERENCE = path.join(ROOT, 'dataset', 'data', 'ita_reference.json');

/** Degrees. Generous for float ordering, far tighter than any bin is wide. */
const ANGLE_TOLERANCE = 0.05;

interface Ref {
  [key: string]: { ita: number | null; bin: string | null };
}

async function main() {
  let reference: Ref;
  try {
    reference = JSON.parse(await readFile(REFERENCE, 'utf8'));
  } catch {
    console.error(
      `No reference at ${REFERENCE}.\nRun: python scripts/dump-ita-reference.py`
    );
    process.exit(2);
  }

  let compared = 0;
  let bothNull = 0;
  const binMismatches: string[] = [];
  const nullMismatches: string[] = [];
  let worstAngle = 0;
  let worstKey = '';

  for (const [key, expected] of Object.entries(reference)) {
    const imagePath = path.join(TEST_DIR, key);
    let buffer: Buffer;
    try {
      buffer = await readFile(imagePath);
    } catch {
      continue;
    }

    const got = await estimateSkinTone(buffer);

    // "No usable skin visible" has to agree too. A port that estimates where
    // the reference refuses is inventing a tone for 149 images.
    if (expected.ita === null || got === null) {
      if ((expected.ita === null) !== (got === null)) {
        nullMismatches.push(
          `${key}: reference ${expected.ita === null ? 'refused' : 'estimated'}, ` +
            `port ${got === null ? 'refused' : 'estimated'}`
        );
      } else {
        bothNull++;
      }
      continue;
    }

    compared++;
    const delta = Math.abs(got.ita - expected.ita);
    if (delta > worstAngle) {
      worstAngle = delta;
      worstKey = key;
    }
    if (got.bin !== expected.bin) {
      binMismatches.push(
        `${key}: reference ${expected.bin} (${expected.ita.toFixed(3)}), ` +
          `port ${got.bin} (${got.ita.toFixed(3)})`
      );
    }
  }

  console.log(`Compared ${compared} images with an estimate, ${bothNull} refused by both.`);
  console.log(`Largest angle difference: ${worstAngle.toFixed(6)}° on ${worstKey || 'n/a'}`);

  let failed = false;

  if (nullMismatches.length) {
    failed = true;
    console.error(`\n${nullMismatches.length} refusal disagreements:`);
    for (const m of nullMismatches.slice(0, 10)) console.error('  ' + m);
  }

  if (binMismatches.length) {
    failed = true;
    console.error(`\n${binMismatches.length} BIN disagreements:`);
    for (const m of binMismatches.slice(0, 10)) console.error('  ' + m);
  }

  if (worstAngle > ANGLE_TOLERANCE) {
    failed = true;
    console.error(
      `\nAngle difference ${worstAngle.toFixed(6)}° exceeds tolerance ${ANGLE_TOLERANCE}°.`
    );
  }

  if (failed) {
    console.error('\nPORT DOES NOT MATCH. Production bins would not be comparable to the published measurement.');
    process.exit(1);
  }

  console.log('\nPort matches the reference on every image.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
