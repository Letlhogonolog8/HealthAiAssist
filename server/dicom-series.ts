/**
 * Ingesting one CT series: from a pile of uploaded files to an ordered,
 * quality-gated, de-identified series in the imaging store.
 *
 * ── The order of operations is the safety property ─────────────────────────
 *
 * Nothing is stored until the whole series has been assembled, ordered and
 * passed the quality gate, and nothing is recorded in the database until every
 * object is stored. A failure at any point leaves no trace: the stored objects
 * are deleted and no rows are written. The alternative — writing rows as
 * instances arrive — produces a half-series that looks like a complete study
 * to everything downstream, which is precisely the failure this pipeline
 * exists to prevent.
 *
 * ── What this establishes, and what it does not ────────────────────────────
 *
 * It establishes that a series is readable, internally consistent, ordered by
 * anatomy rather than by filename, and suitable for the lung pipeline. It
 * establishes nothing whatsoever about the patient. `ingestStatus` is a
 * statement about file handling; a finding is a different thing, produced by a
 * model, reviewed by a clinician, and recorded in `medical_scans` with its own
 * governance. Nothing here writes a clinical field.
 *
 * ── Identity ───────────────────────────────────────────────────────────────
 *
 * The service returns de-identified objects and remapped UIDs; the original
 * UIDs never cross this boundary and are never logged. The bytes written to
 * the object store are the de-identified ones, never the upload — the same
 * rule the single-image path follows, applied a few hundred times.
 */
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import { eq } from 'drizzle-orm';

import { db } from './db';
import {
  imagingInstances,
  imagingSeries,
  imagingStudies,
  type ImagingSeries,
} from '@shared/schema';
import {
  ingestDicomSeries,
  isInferenceServerConfigured,
  SeriesRejectedError,
  type SeriesManifest,
} from './inference-client';
import { isScanObjectStoreAvailable, uploadToGoogleCloudStorage } from './google-cloud-service';

export interface IngestRejection {
  accepted: false;
  stage: string;
  reasons: Array<{ code: string; message: string; [key: string]: unknown }>;
  /** Present when the series was assembled far enough to report on it. */
  ordering?: SeriesManifest['ordering'];
  qualityGate?: SeriesManifest['qualityGate'];
}

export interface IngestSuccess {
  accepted: true;
  studyId: number;
  seriesId: number;
  /** De-identified. The source UIDs are never returned. */
  seriesInstanceUid: string;
  studyInstanceUid: string | null;
  instanceCount: number;
  duplicatesDropped: number;
  ordering: SeriesManifest['ordering'];
  qualityGate: SeriesManifest['qualityGate'];
  uidMappingScope: 'deployment' | 'ingestion';
  ingestStatus: string;
  alreadyIngested: boolean;
}

export type IngestResult = IngestSuccess | IngestRejection;

/**
 * The same de-identified UID already exists under a different patient.
 *
 * Thrown inside the transaction so nothing is written, and caught outside so
 * the objects this run stored are removed before the caller is told.
 *
 * It carries no identifier for the other record. A clinician filing a study
 * for the wrong patient must be told the filing is refused; telling them
 * *whose* record the UID already belongs to would answer a question they did
 * not have a care relationship to ask.
 */
class PatientUidCollision extends Error {
  constructor(readonly level: 'study' | 'series') {
    super(
      `This ${level} is already filed under a different patient record. ` +
        'Ingestion was refused and nothing was stored or changed. Check the patient this ' +
        'study belongs to; if two patients genuinely share it, the records need correcting ' +
        'before it can be ingested.'
    );
    this.name = 'PatientUidCollision';
  }
}

/** Where one instance of a series is stored. Never the client's filename. */
function objectName(patientId: number, seriesUid: string, index: number): string {
  // The series UID is already de-identified, and it is what makes the layout
  // navigable when somebody has to go and look at what was stored.
  const safeUid = seriesUid.replace(/[^0-9.]/g, '');
  return `series/${patientId}/${safeUid}/${String(index).padStart(5, '0')}.dcm`;
}

async function storeObject(bytes: Buffer, name: string): Promise<string> {
  if (isScanObjectStoreAvailable()) {
    try {
      return await uploadToGoogleCloudStorage(bytes, name, 'application/dicom');
    } catch (error) {
      console.error(
        'Cloud Storage upload failed during series ingestion; falling back to local disk:',
        error
      );
    }
  }
  const destination = path.join(process.cwd(), 'uploads', name);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(destination, bytes);
  return `file://${name}`;
}

/**
 * Best-effort removal of everything a failed ingestion wrote.
 *
 * Failure to clean up is logged and never raised: the caller is already
 * reporting a failure, and replacing that message with a cleanup error would
 * hide the thing that actually went wrong. What must not happen — and does
 * not — is a database row pointing at an object that was rolled back, because
 * the rows are written last.
 */
async function removeObjects(paths: string[]): Promise<void> {
  for (const stored of paths) {
    try {
      if (stored.startsWith('file://')) {
        const absolute = path.join(process.cwd(), 'uploads', stored.slice('file://'.length));
        await fs.promises.unlink(absolute).catch(() => {});
      }
      // Cloud objects are left to the bucket's lifecycle rule: deleting them
      // here needs a delete permission the upload path does not have, and an
      // orphaned de-identified object is not a privacy problem.
    } catch (error) {
      console.warn('Could not remove a stored object after a failed ingestion:', error);
    }
  }
}

/**
 * Ingests one series for one patient.
 *
 * `filePaths` are the staged uploads; this function does not delete them —
 * the caller owns the staging directory and removes it whatever happens.
 */
export async function ingestSeries(options: {
  filePaths: string[];
  patientId: number;
  ingestedBy: number;
}): Promise<IngestResult> {
  const { filePaths, patientId, ingestedBy } = options;

  if (!isInferenceServerConfigured()) {
    return {
      accepted: false,
      stage: 'service_unavailable',
      reasons: [
        {
          code: 'inference_unavailable',
          message:
            'Series ingestion needs the resident inference service (INFERENCE_URL is not set). ' +
            'Nothing was stored.',
        },
      ],
    };
  }

  let manifest: SeriesManifest | null = null;
  const stored: Array<{
    index: number;
    sopUid: string;
    positionMm: number | null;
    imagePositionPatient: [number, number, number] | null;
    objectPath: string;
  }> = [];

  try {
    for await (const event of ingestDicomSeries(filePaths)) {
      if (event.kind === 'manifest') {
        manifest = event.manifest;
        continue;
      }
      if (event.kind === 'failed') {
        throw new Error(`Instance ${event.index} could not be de-identified: ${event.reason}`);
      }
      if (event.kind === 'instance') {
        if (!manifest) throw new Error('The service sent an instance before its verdict.');
        const name = objectName(patientId, manifest.series.seriesInstanceUid, event.index);
        stored.push({
          index: event.index,
          sopUid: event.sopInstanceUid,
          positionMm: event.positionMm,
          imagePositionPatient: event.imagePositionPatient,
          objectPath: await storeObject(event.object, name),
        });
        continue;
      }
      if (event.kind === 'complete') {
        if (stored.length !== event.instanceCount) {
          throw new Error(
            `The stream ended with ${stored.length} of ${event.instanceCount} instances stored.`
          );
        }
      }
    }
  } catch (error) {
    await removeObjects(stored.map((s) => s.objectPath));
    if (error instanceof SeriesRejectedError) {
      const body = error.body ?? {};
      return {
        accepted: false,
        stage: body.stage ?? 'rejected',
        reasons:
          body.reasons ??
          (body.qualityGate?.failures?.length
            ? body.qualityGate.failures
            : [{ code: 'rejected', message: error.message }]),
        ordering: body.ordering,
        qualityGate: body.qualityGate,
      };
    }
    throw error;
  }

  if (!manifest) {
    await removeObjects(stored.map((s) => s.objectPath));
    throw new Error('The inference service returned no verdict for this series.');
  }
  if (stored.length !== manifest.instanceCount) {
    // A truncated stream. Partial is not a study.
    await removeObjects(stored.map((s) => s.objectPath));
    return {
      accepted: false,
      stage: 'incomplete',
      reasons: [
        {
          code: 'incomplete_series',
          message:
            `Only ${stored.length} of ${manifest.instanceCount} instances were received, so the ` +
            'series is incomplete and was not stored. A partial series is not a study.',
          received: stored.length,
          expected: manifest.instanceCount,
        },
      ],
      ordering: manifest.ordering,
      qualityGate: manifest.qualityGate,
    };
  }

  // Rows last, in one transaction. Until this commits, an interrupted
  // ingestion is invisible to everything but the object store.
  try {
    const written = await (db as any).transaction(async (tx: any) => {
      const studyUid =
        manifest!.study.studyInstanceUid ?? `series-only:${manifest!.series.seriesInstanceUid}`;

      // Looked up by UID across all patients, then checked against this one.
      //
      // The unique index on study_uid is global, so a lookup narrowed to the
      // patient would miss a row belonging to someone else and the insert
      // would then fail on the constraint with nothing useful to say. Finding
      // it and comparing is what turns a constraint violation into a refusal a
      // clinician can act on — and it is what stops a second patient's series
      // being attached to the first patient's study, which is what happened
      // before: the lookup was by UID alone and whatever it found was used.
      let [study] = await tx
        .select()
        .from(imagingStudies)
        .where(eq(imagingStudies.studyUid, studyUid))
        .limit(1);
      if (study && study.patientId !== patientId) throw new PatientUidCollision('study');
      if (!study) {
        [study] = await tx
          .insert(imagingStudies)
          .values({ patientId, studyUid })
          .returning();
      }

      const [existing] = await tx
        .select()
        .from(imagingSeries)
        .where(eq(imagingSeries.seriesUid, manifest!.series.seriesInstanceUid))
        .limit(1);
      if (existing && existing.patientId !== patientId) {
        // The dangerous one. Returning this row would hand the caller a
        // seriesId belonging to a patient they did not ask about, labelled as
        // a successful ingest of the study they did.
        throw new PatientUidCollision('series');
      }
      if (existing) {
        // Deterministic UID remapping makes a re-upload recognisable rather
        // than a duplicate. Reported, not silently ignored.
        //
        // The existing rows' object paths come back with it, because the
        // caller has to know which of the objects this run wrote are the ones
        // those rows already point at. See the cleanup below.
        const referenced = await tx
          .select({ objectPath: imagingInstances.objectPath })
          .from(imagingInstances)
          .where(eq(imagingInstances.seriesId, existing.id));
        return {
          study,
          series: existing as ImagingSeries,
          alreadyIngested: true,
          referenced: new Set(referenced.map((r: any) => r.objectPath as string)),
        };
      }

      const gate = manifest!.qualityGate;
      const [series] = await tx
        .insert(imagingSeries)
        .values({
          studyId: study.id,
          patientId,
          seriesUid: manifest!.series.seriesInstanceUid,
          modality: manifest!.series.modality,
          instanceCount: stored.length,
          orderingMethod: manifest!.ordering.method,
          orderingTrusted: manifest!.ordering.trusted,
          qualityGatePassed: gate.passed,
          qualityGate: JSON.stringify(gate),
          anatomyVerified: gate.anatomyVerified,
          rows: manifest!.series.rows,
          columns: manifest!.series.columns,
          pixelSpacingMm: manifest!.series.pixelSpacingMm?.[0] ?? null,
          // The geometry a coordinate system is built from. Stored as JSON
          // text for the vectors, following the qualityGate precedent in this
          // table, and as separate columns for the two spacings so that
          // neither can be mistaken for the other.
          imageOrientationPatient: manifest!.series.imageOrientationPatient
            ? JSON.stringify(manifest!.series.imageOrientationPatient)
            : null,
          pixelSpacingRowMm: manifest!.series.pixelSpacingRowMm ?? null,
          pixelSpacingColMm: manifest!.series.pixelSpacingColMm ?? null,
          slicePolarity: manifest!.ordering.polarity,
          slicePolarityNormalised: manifest!.ordering.polarityNormalised,
          sliceNormal: manifest!.ordering.normal
            ? JSON.stringify(manifest!.ordering.normal)
            : null,
          sliceThicknessMm: manifest!.series.sliceThicknessMm,
          medianSpacingMm: manifest!.ordering.medianSpacingMm,
          manufacturer: manifest!.series.manufacturer,
          manufacturerModel: manifest!.series.manufacturerModel,
          convolutionKernel: manifest!.series.convolutionKernel,
          bodyPart: manifest!.series.bodyPartExamined,
          uidMappingScope: manifest!.uidMappingScope,
          storagePrefix: `series/${patientId}/${manifest!.series.seriesInstanceUid.replace(/[^0-9.]/g, '')}`,
          ingestedBy,
          ingestStatus: 'ingested',
        })
        .returning();

      await tx.insert(imagingInstances).values(
        stored.map((instance) => ({
          seriesId: series.id,
          positionIndex: instance.index,
          sopUid: instance.sopUid,
          positionMm: instance.positionMm,
          ippX: instance.imagePositionPatient?.[0] ?? null,
          ippY: instance.imagePositionPatient?.[1] ?? null,
          ippZ: instance.imagePositionPatient?.[2] ?? null,
          objectPath: instance.objectPath,
        }))
      );

      return {
        study,
        series: series as ImagingSeries,
        alreadyIngested: false,
        referenced: new Set<string>(),
      };
    });

    if (written.alreadyIngested) {
      // Clean up only what nothing points at.
      //
      // The object name is derived from the patient, the de-identified series
      // UID and the slice position, every one of which is deterministic — so a
      // re-ingestion writes the *same* paths as the first, not a second copy.
      // Removing "the objects this run wrote" therefore deleted the objects
      // the existing rows reference, and turned a recognised re-upload into a
      // series of rows pointing at nothing. Measured: 45 of 45 objects gone,
      // rows intact.
      //
      // Anything genuinely unreferenced is still removed — which is the case
      // when the two ingestions landed on different storage backends, because
      // the object store falls back to local disk on a runtime failure.
      await removeObjects(
        stored.map((s) => s.objectPath).filter((p) => !written.referenced.has(p))
      );
    }

    return {
      accepted: true,
      studyId: written.study.id,
      seriesId: written.series.id,
      seriesInstanceUid: manifest.series.seriesInstanceUid,
      studyInstanceUid: manifest.study.studyInstanceUid,
      instanceCount: written.alreadyIngested ? written.series.instanceCount : stored.length,
      duplicatesDropped: manifest.assembly.duplicatesDropped,
      ordering: manifest.ordering,
      qualityGate: manifest.qualityGate,
      uidMappingScope: manifest.uidMappingScope,
      ingestStatus: written.series.ingestStatus,
      alreadyIngested: written.alreadyIngested,
    };
  } catch (error) {
    await removeObjects(stored.map((s) => s.objectPath));
    if (error instanceof PatientUidCollision) {
      // The transaction rolled back and the objects are gone, so neither
      // patient's records were touched.
      return {
        accepted: false,
        stage: 'uid_collision',
        reasons: [
          {
            code: `${error.level}_uid_belongs_to_another_patient`,
            message: error.message,
            level: error.level,
          },
        ],
      };
    }
    throw error;
  }
}

/** One ingested series, for the read endpoint. De-identified throughout. */
export async function getSeries(seriesId: number) {
  const [series] = await (db as any)
    .select()
    .from(imagingSeries)
    .where(eq(imagingSeries.id, seriesId))
    .limit(1);
  if (!series) return null;

  const instances = await (db as any)
    .select({
      positionIndex: imagingInstances.positionIndex,
      sopUid: imagingInstances.sopUid,
      positionMm: imagingInstances.positionMm,
      // The slice origin, so a caller holding a candidate coordinate can
      // place it without re-reading the stored objects.
      ippX: imagingInstances.ippX,
      ippY: imagingInstances.ippY,
      ippZ: imagingInstances.ippZ,
    })
    .from(imagingInstances)
    .where(eq(imagingInstances.seriesId, seriesId))
    .orderBy(imagingInstances.positionIndex);

  return { series, instances };
}
