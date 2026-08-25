/**
 * Identifies which model artifact produced a result, by hashing the artifact.
 *
 * `medical_scans.model_version` exists so that a stored result can be explained
 * later: models get retrained and thresholds move, so a figure from six months
 * ago may not be reproducible from today's artifact. That only works if the
 * recorded version actually tracks the file.
 *
 * It did not. The value was a hardcoded string literal — `'resnet50v2-skin-v1'`
 * and `'resnet50v2-lung-v2'` — written inline at the two call sites. Retraining
 * a model without remembering to edit those literals produced rows claiming to
 * come from a model that no longer existed, which is worse than recording
 * nothing: a wrong provenance label is believed, and a missing one is
 * investigated. The lung model has already been retrained once during this
 * project's life, so this is not a hypothetical.
 *
 * A digest of the artifact cannot drift from the artifact. Two deployments
 * serving the same file report the same version without coordinating, and a
 * retrain changes it whether or not anyone remembers to.
 *
 * Twelve hex characters of SHA-256 — 48 bits. Collisions are not a concern for
 * a handful of artifacts, and it stays short enough to read in a table.
 */
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import path from 'path';

export type Modality = 'lung' | 'skin';

/**
 * Where each artifact lives.
 *
 * The environment overrides match the ones the Python services already honour
 * (`server/lung-cancer-service.py`, `server/skin-cancer-service.ts`), so a
 * deployment that mounts its models elsewhere is fingerprinting the same file it
 * is serving from — rather than hashing a default path that nothing loads.
 */
function artifactPath(modality: Modality): string {
  if (modality === 'lung') {
    return (
      process.env.LUNG_CANCER_MODEL_PATH ||
      path.join(process.cwd(), 'dataset', 'lung_cancer_MRI_dataset', 'resnet50v2_lung_cancer_model.h5')
    );
  }
  return (
    process.env.SKIN_CANCER_MODEL_PATH ||
    path.join(process.cwd(), 'dataset', 'data', 'resnet50v2_skin_cancer_model.h5')
  );
}

/** Architecture and modality, so a stored row is readable without a lookup. */
const FAMILY: Record<Modality, string> = {
  lung: 'resnet50v2-lung',
  skin: 'resnet50v2-skin',
};

/**
 * Cached per modality, keyed by resolved path so an env change is picked up.
 * The promise is cached rather than the value, so concurrent first calls hash
 * the file once between them.
 */
const cache = new Map<string, Promise<string>>();

async function digest(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').slice(0, 12)));
  });
}

/**
 * The version string to record against a scan this model produced.
 *
 * Never throws. If the artifact cannot be read, returns `<family>-unknown`
 * rather than null: null already means "no model ran" on this column, and
 * conflating "we could not identify the model" with "there was no model" would
 * put scans that DID receive a prediction into the bucket that measurement
 * excludes. In practice this branch is unreachable from the analysis path —
 * inference has already failed by then — but it is reachable from a
 * misconfigured PYTHON_BIN pointing at a different checkout.
 */
export async function modelVersionFor(modality: Modality): Promise<string> {
  const filePath = artifactPath(modality);

  let pending = cache.get(filePath);
  if (!pending) {
    pending = digest(filePath).catch((error) => {
      console.warn(
        `Could not fingerprint the ${modality} model at ${filePath}; ` +
          `results will be recorded as ${FAMILY[modality]}-unknown:`,
        error instanceof Error ? error.message : error
      );
      return 'unknown';
    });
    cache.set(filePath, pending);
  }

  return `${FAMILY[modality]}-${await pending}`;
}
