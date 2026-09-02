/**
 * Backs up and verifies the trained model artifacts.
 *
 *   npm run backup:models                    # back up to the default location
 *   npm run backup:models -- <destination>   # ... or somewhere specific
 *   npm run backup:models -- --verify        # re-hash an existing backup
 *
 * WHY THIS EXISTS
 *
 * `dataset/` is gitignored, so none of this is version controlled. A clean
 * checkout gives you the code and no models, and the governance gate means an
 * unmeasured model does not serve — so losing this directory takes both
 * modalities offline until they are retrained, re-measured and re-bound.
 *
 * Both models are now rebuildable: scripts/train-skin-cancer-model.py and
 * scripts/train-lung-cancer-model.py. (This file used to say the lung script
 * referenced a class that no longer existed. That was true of an older script
 * and is no longer: the current one is self-contained, and its SEED, CLASSES
 * and split fractions reproduce exactly the 2575/551/554 recorded in
 * lung_model_training.json and lung_splits.json.)
 *
 * **Rebuildable is not the same as free to lose.** A retrain produces a
 * different artifact with a different fingerprint, so MEASUREMENT_BINDINGS stops
 * matching, the modality refuses to serve, and it stays off until someone
 * re-measures and re-binds it. Restoring a backup costs minutes; retraining
 * costs a training run plus a full re-measurement.
 *
 * ── What is backed up, and why it is more than the .h5 files ──────────────
 *
 * The weights alone do not reproduce the deployed behaviour. The calibration
 * temperature, the decision threshold, the OOD reference and the split manifest
 * are each load-bearing, and each fails quietly rather than loudly when absent:
 * a missing lung_model_calibration.json drops the temperature to 1.0 and moves
 * the operating point without any error, and a missing lung_splits.json makes
 * the published figures unverifiable again.
 *
 * Each artifact is copied and hashed, and the manifest records the hash, so a
 * silently corrupted backup is detectable rather than discovered at restore time.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

interface Artifact {
  /** Path relative to the repository root. */
  source: string;
  /** Whether it can be regenerated if lost. */
  reproducible: boolean;
  note: string;
}

const ARTIFACTS: Artifact[] = [
  {
    source: 'dataset/lung_cancer_MRI_dataset/resnet50v2_lung_cancer_model.h5',
    // Was irreplaceable until it was retrained with a working script. Losing it
    // now costs a training run rather than the modality.
    reproducible: true,
    note: 'Rebuildable with: python scripts/train-lung-cancer-model.py',
  },
  {
    source: 'dataset/lung_cancer_MRI_dataset/lung_model_training.json',
    reproducible: true,
    note: 'Split counts, held-out metrics and the deployed decision threshold.',
  },
  {
    source: 'dataset/data/resnet50v2_skin_cancer_model.h5',
    reproducible: true,
    note: 'Rebuildable with: python scripts/train-skin-cancer-model.py',
  },
  {
    source: 'dataset/data/skin_model_training.json',
    reproducible: true,
    note: 'Training metadata for the skin model; regenerated alongside it.',
  },
  {
    source: 'dataset/lung_cancer_MRI_dataset/lung_model_calibration.json',
    reproducible: true,
    note: 'Temperature 1.125, applied before thresholding. Absent, the service falls back to 1.0 and the deployed operating point moves silently.',
  },
  {
    source: 'dataset/lung_cancer_MRI_dataset/lung_splits.json',
    reproducible: true,
    note: 'The 554 held-out test paths. Without it the published lung figures are unverifiable and the binding drops to asserted.',
  },
  {
    source: 'dataset/lung_cancer_MRI_dataset/lung_model_ood.json',
    reproducible: true,
    note: 'Out-of-distribution screen threshold for lung.',
  },
  {
    source: 'dataset/data/skin_model_calibration.json',
    reproducible: true,
    note: 'Records that temperature scaling was fitted and deliberately NOT applied.',
  },
  {
    source: 'dataset/data/skin_model_ood.json',
    reproducible: true,
    note: 'Out-of-distribution screen threshold for skin.',
  },
  {
    source: 'dataset/data/skin_ood_reference.npz',
    reproducible: true,
    note: 'Reference distribution the skin OOD screen compares against. Absent, the screen cannot run and wrong-modality images reach the classifier.',
  },
  {
    source: 'dataset/data/skin_tone_performance.json',
    reproducible: true,
    note: 'The stratified fairness measurement, fingerprint-bound to the artifact. Regenerable with npm run fairness:measure, given the test set.',
  },
];

const MANIFEST = 'manifest.json';

function sha256(file: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function humanSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Windows drive letter or POSIX root, for the same-volume warning. */
function volumeOf(target: string): string {
  return path.parse(path.resolve(target)).root.toLowerCase();
}

function freeBytes(target: string): number | null {
  try {
    // statfsSync is available on Node 18.15+. Absence is not fatal.
    const stats = (fs as any).statfsSync?.(target);
    if (!stats) return null;
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

function backup(destination: string): number {
  fs.mkdirSync(destination, { recursive: true });

  const present = ARTIFACTS.filter((a) => fs.existsSync(a.source));
  const missing = ARTIFACTS.filter((a) => !fs.existsSync(a.source));

  for (const artifact of missing) {
    const severity = artifact.reproducible ? 'missing (reproducible)' : 'MISSING AND IRREPLACEABLE';
    console.error(`  ${severity}: ${artifact.source}`);
  }

  if (!present.length) {
    console.error('\nNothing to back up — no artifacts found.');
    return 1;
  }

  const totalBytes = present.reduce((sum, a) => sum + fs.statSync(a.source).size, 0);
  const available = freeBytes(destination);
  if (available !== null && available < totalBytes * 1.1) {
    console.error(
      `\nNot enough free space at ${destination}: need ~${humanSize(totalBytes)}, ` +
      `have ${humanSize(available)}.`
    );
    return 1;
  }

  const entries: Array<{
    name: string;
    source: string;
    bytes: number;
    sha256: string;
    reproducible: boolean;
    note: string;
  }> = [];

  for (const artifact of present) {
    const name = path.basename(artifact.source);
    const target = path.join(destination, name);
    const size = fs.statSync(artifact.source).size;

    process.stdout.write(`  ${name} (${humanSize(size)}) ... `);
    fs.copyFileSync(artifact.source, target);

    const sourceHash = sha256(artifact.source);
    const targetHash = sha256(target);
    if (sourceHash !== targetHash) {
      console.log('FAILED');
      console.error(`    Hash mismatch after copy. Backup of ${name} is not trustworthy.`);
      return 1;
    }
    console.log('ok');

    entries.push({
      name,
      source: artifact.source,
      bytes: size,
      sha256: sourceHash,
      reproducible: artifact.reproducible,
      note: artifact.note,
    });
  }

  fs.writeFileSync(
    path.join(destination, MANIFEST),
    `${JSON.stringify({ createdAt: new Date().toISOString(), artifacts: entries }, null, 2)}\n`
  );

  console.log(`\nBacked up ${entries.length} artifact(s) to ${destination}`);

  if (volumeOf(destination) === volumeOf(process.cwd())) {
    console.warn(
      '\nWARNING: the backup is on the same volume as the source. That protects ' +
      'against an accidental delete, but not against a disk failure — which is the ' +
      'failure mode that takes both modalities offline until they are retrained, ' +
      're-measured and re-bound. Copy this directory ' +
      'to external or cloud storage.'
    );
  }

  return 0;
}

function verify(destination: string): number {
  const manifestPath = path.join(destination, MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    console.error(`No manifest at ${manifestPath}. Nothing to verify.`);
    return 1;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  console.log(`Backup created ${manifest.createdAt}\n`);

  let failures = 0;
  for (const entry of manifest.artifacts) {
    const file = path.join(destination, entry.name);
    process.stdout.write(`  ${entry.name} ... `);

    if (!fs.existsSync(file)) {
      console.log('MISSING');
      failures++;
      continue;
    }
    if (sha256(file) !== entry.sha256) {
      console.log('CORRUPT (hash mismatch)');
      failures++;
      continue;
    }
    console.log('ok');
  }

  if (failures) {
    console.error(`\n${failures} artifact(s) failed verification.`);
    return 1;
  }
  console.log('\nAll artifacts verified against the manifest.');
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  const verifyMode = args.includes('--verify');
  const positional = args.filter((a) => !a.startsWith('--'));

  const destination = path.resolve(
    positional[0] ||
    process.env.MODEL_BACKUP_DIR ||
    path.join(process.cwd(), '..', 'HealthAiAssist-model-backups')
  );

  console.log(`${verifyMode ? 'Verifying' : 'Backing up'}: ${destination}\n`);
  process.exit(verifyMode ? verify(destination) : backup(destination));
}

main();
