/**
 * Persistence for genomic profiles, variants and risk assessments.
 *
 * Kept separate from server/storage.ts because genomic reads must always pass
 * through the consent gate in consent.ts. A caller reaching for `storage.getX`
 * out of habit should not find a genomic accessor sitting next to the others.
 */
import { getDb } from '../db';
import { encryptRow, decryptRow, decryptRows } from '../crypto';
import {
  genomicProfiles,
  genomicVariants,
  riskAssessments,
  genomicAccessLog,
  type GenomicProfile,
  type RiskAssessment,
} from '@shared/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import type { ParsedGenotype } from './parsers';

/** Insert in chunks; a single multi-thousand-row insert exceeds parameter limits. */
const INSERT_CHUNK = 500;

export async function createProfile(params: {
  patientId: number;
  source: string;
  genomeBuild: string | null;
  variantCount: number;
  selfReportedAncestry: string | null;
}): Promise<GenomicProfile> {
  const db = getDb() as any;
  const [profile] = await db
    .insert(genomicProfiles)
    .values({ ...params, status: 'processing' })
    .returning();
  return profile;
}

export async function setProfileStatus(
  profileId: number,
  status: 'ready' | 'rejected',
  rejectionReason?: string
): Promise<void> {
  const db = getDb() as any;
  await db
    .update(genomicProfiles)
    .set({ status, rejectionReason: rejectionReason ?? null })
    .where(eq(genomicProfiles.id, profileId));
}

/**
 * Persists only the genotypes a loaded panel actually needs.
 *
 * A consumer array carries ~600k calls; storing all of them multiplies the
 * blast radius of a breach for data no panel will ever read. `neededRsids`
 * is the union of every installed panel's variants.
 */
export async function storeVariants(
  profileId: number,
  genotypes: ParsedGenotype[],
  neededRsids: Set<string>
): Promise<number> {
  const db = getDb() as any;
  const rows = genotypes
    .filter((g) => neededRsids.has(g.rsid))
    .map((g) => ({
      profileId,
      rsid: g.rsid,
      chromosome: g.chromosome,
      position: g.position,
      genotype: g.genotype,
    }));

  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db.insert(genomicVariants).values(rows.slice(i, i + INSERT_CHUNK));
  }
  return rows.length;
}

export async function getLatestProfile(patientId: number): Promise<GenomicProfile | null> {
  const db = getDb() as any;
  const rows = await db
    .select()
    .from(genomicProfiles)
    .where(and(eq(genomicProfiles.patientId, patientId), eq(genomicProfiles.status, 'ready')))
    .orderBy(desc(genomicProfiles.uploadedAt), desc(genomicProfiles.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getProfiles(patientId: number): Promise<GenomicProfile[]> {
  const db = getDb() as any;
  return db
    .select()
    .from(genomicProfiles)
    .where(eq(genomicProfiles.patientId, patientId))
    .orderBy(desc(genomicProfiles.uploadedAt));
}

/** Genotype lookup for scoring. Only the rsIDs asked for are read. */
export async function getGenotypeMap(
  profileId: number,
  rsids: string[]
): Promise<Map<string, string>> {
  const db = getDb() as any;
  const map = new Map<string, string>();
  if (!rsids.length) return map;

  for (let i = 0; i < rsids.length; i += INSERT_CHUNK) {
    const chunk = rsids.slice(i, i + INSERT_CHUNK);
    const rows = await db
      .select()
      .from(genomicVariants)
      .where(and(eq(genomicVariants.profileId, profileId), inArray(genomicVariants.rsid, chunk)));
    for (const row of rows) map.set(row.rsid, row.genotype);
  }
  return map;
}

export async function saveRiskAssessment(
  values: Partial<RiskAssessment> & { patientId: number; condition: string }
): Promise<RiskAssessment> {
  const db = getDb() as any;
  // `caveats` and `contributions` are encrypted at rest: both are free text
  // about one identified person's genome, and neither is ever queried. The
  // structured columns beside them (riskBand, percentile, coverage) stay in
  // plaintext because the equity report aggregates over them.
  const [row] = await db
    .insert(riskAssessments)
    .values(encryptRow('genomic_risk_assessments', values))
    .returning();
  return decryptRow('genomic_risk_assessments', row);
}

export async function getRiskAssessments(patientId: number): Promise<RiskAssessment[]> {
  const db = getDb() as any;
  return decryptRows(
    'genomic_risk_assessments',
    await db
      .select()
      .from(riskAssessments)
      .where(eq(riskAssessments.patientId, patientId))
      .orderBy(desc(riskAssessments.createdAt))
  );
}

export async function getAccessLog(patientId: number, limit = 200) {
  const db = getDb() as any;
  return db
    .select()
    .from(genomicAccessLog)
    .where(eq(genomicAccessLog.patientId, patientId))
    .orderBy(desc(genomicAccessLog.occurredAt))
    .limit(limit);
}

/**
 * Deletes a patient's genomic data.
 *
 * The access log is deliberately NOT deleted: it records who touched the data
 * while it existed, which is the one thing a patient exercising a deletion right
 * most needs to be able to check afterwards. Risk assessments are unlinked
 * rather than removed, so clinical records referencing them do not dangle.
 */
export async function deleteGenomicData(patientId: number): Promise<{ profiles: number }> {
  const db = getDb() as any;
  const profiles = await getProfiles(patientId);

  for (const profile of profiles) {
    await db.delete(genomicVariants).where(eq(genomicVariants.profileId, profile.id));
  }

  await db
    .update(riskAssessments)
    .set({ profileId: null })
    .where(eq(riskAssessments.patientId, patientId));

  await db.delete(genomicProfiles).where(eq(genomicProfiles.patientId, patientId));

  return { profiles: profiles.length };
}
