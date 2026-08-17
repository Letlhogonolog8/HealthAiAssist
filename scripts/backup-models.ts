/**
 * Backs up and verifies the trained model artifacts.
 *
 *   npm run backup:models                    # back up to the default location
 *   npm run backup:models -- <destination>   # ... or somewhere specific
 *   npm run backup:models -- --verify        # re-hash an existing backup
 *
 * WHY THIS EXISTS
 *
 * `dataset/` is gitignored, so the .h5 files are not version controlled. The skin
 * model can be rebuilt from scripts/train-skin-cancer-model.py. **The lung model
 * cannot** — its training script references a class that no longer exists, and no
 * equivalent remains in the repository. If that file is lost, the model is gone
 * permanently and the lung modality goes with it.
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
    reproducible: false,
    note: 'IRREPLACEABLE. No working training script exists for this model.',
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
      'failure mode that would lose the lung model for good. Copy this directory ' +
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
