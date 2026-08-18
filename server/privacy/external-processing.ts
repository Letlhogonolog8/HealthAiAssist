/**
 * Consent gate and transfer record for sending data to processors abroad.
 *
 * The AI assistant forwards messages to OpenAI in the United States. Under POPIA
 * that is a cross-border transfer (s72) of personal information, and where the
 * message concerns someone's health it is special personal information (s26),
 * which may only be processed on one of the s27 grounds — consent being the
 * practical one here.
 *
 * Three things have to be true for that to be defensible, and this module
 * provides all three:
 *
 *   1. The person was told, specifically, before it happened.
 *   2. They agreed, and can withdraw — checked at each use, not once at signup.
 *   3. There is a record of what was sent, in what category, and when.
 *
 * None of this makes the transfer lawful on its own. It makes it *documentable*,
 * which is what the operator agreement and impact assessment are written against.
 * See CHATBOT-PRIVACY.md.
 */
import { getDb } from '../db';
import { processingConsents, auditEvents } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';

export const EXTERNAL_AI_SCOPE = 'external_ai_assistant';

/** Bump when the disclosure text changes; grants record what the person saw. */
export const DISCLOSURE_VERSION = '2026-08-18.v1';

/**
 * Shown before the assistant can be used. Deliberately concrete about the
 * recipient, the country and the limits — a notice that says "we may share data
 * with third parties" does not satisfy s18.
 */
export const DISCLOSURE_TEXT = [
  'This assistant is powered by OpenAI, a company based in the United States.',
  'What you type is sent to their servers to generate a reply, so it leaves South Africa.',
  'Your name is never sent. Identifiers found in your message — ID numbers, phone numbers, email addresses, dates of birth — are removed before it is sent.',
  'Your scan results and appointment history are not sent.',
  'Please do not type anything you would not want processed abroad.',
  'The assistant gives general information only. It cannot interpret your results or give you a diagnosis.',
  'You can withdraw this permission at any time, and the assistant will stop working for you immediately.',
];

/** True when the newest record for this person grants the scope. */
export async function hasExternalAiConsent(patientId: number): Promise<boolean> {
  try {
    const db = getDb() as any;
    const rows = await db
      .select()
      .from(processingConsents)
      .where(and(
        eq(processingConsents.patientId, patientId),
        eq(processingConsents.scope, EXTERNAL_AI_SCOPE)
      ))
      .orderBy(desc(processingConsents.recordedAt), desc(processingConsents.id))
      .limit(1);
    return rows[0]?.granted === true;
  } catch (error) {
    // Fail closed. An unreachable consent table is not permission.
    console.error('Could not read external AI consent; refusing:', error);
    return false;
  }
}

/** Records a grant or withdrawal. Never updates an existing row. */
export async function recordExternalAiConsent(
  patientId: number,
  granted: boolean,
  notes = ''
): Promise<void> {
  const db = getDb() as any;
  await db.insert(processingConsents).values({
    patientId,
    scope: EXTERNAL_AI_SCOPE,
    granted,
    consentVersion: DISCLOSURE_VERSION,
    notes,
  });
}

/**
 * Records that a transfer happened, and what category of content it carried.
 *
 * Deliberately stores no message content and no redacted values — only the
 * categories that were stripped. An audit log holding the personal information
 * it audits has doubled the exposure rather than controlled it.
 */
export async function recordExternalTransfer(params: {
  patientId: number | null;
  recipient: string;
  model: string;
  messageCount: number;
  redactedCategories: string[];
  includedClinicalContext: boolean;
}): Promise<void> {
  try {
    const db = getDb() as any;
    await db.insert(auditEvents).values({
      action: 'EXTERNAL_AI_TRANSFER',
      actorUserId: params.patientId,
      method: 'POST',
      path: '/api/chatbot/chat',
      statusCode: 200,
      detail: JSON.stringify({
        recipient: params.recipient,
        model: params.model,
        messages: params.messageCount,
        redacted: params.redactedCategories,
        clinicalContextIncluded: params.includedClinicalContext,
        crossBorder: true,
      }),
    });
  } catch (error) {
    console.error('[AUDIT] Failed to record external AI transfer:', error);
  }
}
