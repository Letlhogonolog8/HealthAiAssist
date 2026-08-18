/**
 * Removes direct identifiers from text before it leaves this system.
 *
 * The chatbot forwards user messages to OpenAI, a processor outside South
 * Africa. Under POPIA that is a cross-border transfer of personal information,
 * and where the text concerns someone's health it is *special* personal
 * information under s26. The compliance burden scales with how identifiable the
 * payload is, so the cheapest control by far is not to send identifiers at all.
 *
 * This is a reduction measure, not a guarantee. Free text can identify someone
 * through combinations no regex will catch ("the radiologist at the Tygerberg
 * clinic who saw me on Tuesday"), so it is paired with consent, disclosure and
 * an audit record rather than relied on alone.
 *
 * Everything is replaced with a labelled placeholder rather than deleted, so the
 * model still understands the sentence structure and the user's question keeps
 * its meaning.
 */

export interface RedactionResult {
  text: string;
  /** Categories removed, for the audit record. Never the values themselves. */
  removed: string[];
}

interface Rule {
  label: string;
  pattern: RegExp;
  placeholder: string;
}

/**
 * Order matters: the more specific patterns run first so that, for example, an
 * SA ID number is not first partially consumed by the long-number rule.
 */
const RULES: Rule[] = [
  {
    // South African ID: 13 digits, YYMMDD + sequence + citizenship + checksum.
    // Matched before generic numbers because it is the highest-value identifier.
    label: 'sa_id_number',
    pattern: /\b\d{6}[ -]?\d{4}[ -]?\d{3}\b/g,
    placeholder: '[ID NUMBER REMOVED]',
  },
  {
    label: 'email',
    pattern: /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,
    placeholder: '[EMAIL REMOVED]',
  },
  {
    // SA mobile/landline in local or +27 form, with optional spaces or dashes.
    label: 'phone',
    pattern: /(?:\+27|0)(?:[ -]?\d){9}\b/g,
    placeholder: '[PHONE REMOVED]',
  },
  {
    label: 'date_of_birth',
    pattern: /\b(?:0?[1-9]|[12]\d|3[01])[/.-](?:0?[1-9]|1[0-2])[/.-](?:19|20)\d{2}\b/g,
    placeholder: '[DATE REMOVED]',
  },
  {
    // Medical record / patient / file numbers written with an explicit label.
    label: 'record_number',
    pattern: /\b(?:MRN|patient(?:\s+(?:no|number|id))?|file(?:\s+(?:no|number))?)\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi,
    placeholder: '[RECORD NUMBER REMOVED]',
  },
  {
    label: 'passport',
    pattern: /\bpassport\s*(?:no|number)?\s*[:#]?\s*[A-Z0-9]{6,10}\b/gi,
    placeholder: '[PASSPORT REMOVED]',
  },
  {
    // Long digit runs that survived the rules above: account numbers, medical
    // aid membership numbers, and similar.
    label: 'long_number',
    pattern: /\b\d{9,}\b/g,
    placeholder: '[NUMBER REMOVED]',
  },
];

/**
 * Strips direct identifiers from a single string.
 *
 * Names are deliberately NOT pattern-matched. Any regex broad enough to catch
 * South African names would shred ordinary clinical words, and one narrow enough
 * to be safe would miss most of them. Names are handled at the source instead:
 * the system never puts the account holder's name into the payload.
 */
export function redact(text: string): RedactionResult {
  if (!text) return { text: '', removed: [] };

  let output = text;
  const removed: string[] = [];

  for (const rule of RULES) {
    // Fresh lastIndex each call — these are global regexes held at module scope.
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(output)) {
      rule.pattern.lastIndex = 0;
      output = output.replace(rule.pattern, rule.placeholder);
      removed.push(rule.label);
    }
  }

  return { text: output, removed };
}

/** Redacts a conversation, reporting the union of categories removed. */
export function redactMessages<T extends { content: string }>(
  messages: T[]
): { messages: T[]; removed: string[] } {
  const removed = new Set<string>();
  const redacted = messages.map((message) => {
    const result = redact(message.content);
    for (const category of result.removed) removed.add(category);
    return { ...message, content: result.text };
  });
  return { messages: redacted, removed: [...removed] };
}
