/**
 * Operational metrics, in Prometheus exposition format.
 *
 * ── What is worth counting here, and what is not ───────────────────────────
 *
 * The obvious metrics for a healthcare API — request rate, latency, error rate —
 * are the least interesting ones, because they say nothing about whether the
 * clinically important behaviour is working. The counters below are chosen for
 * questions an operator of *this* system would actually need answered:
 *
 *   - How often does the system refuse to produce a result? A refusal rate that
 *     climbs means either the models have become unavailable or people are
 *     submitting images the pipeline cannot read, and those need different
 *     responses.
 *   - How often is an input rejected as out-of-distribution? A step change here
 *     is the earliest available signal that the input distribution has moved —
 *     a new scanner, a new capture device, a new clinic — and that the published
 *     performance figures may no longer describe what is happening.
 *   - How long does inference take, and how deep is the queue? Both are
 *     properties of the resident-model service rather than of Node, and both are
 *     what saturation looks like before it becomes a 503.
 *   - How often is emergency access used? Break-glass is meant to be rare. A
 *     rate rather than an audit query makes "rare" observable.
 *
 * ── No labels carrying identity ────────────────────────────────────────────
 *
 * Prometheus label values end up in a time series database with a long
 * retention, queried by whoever has a dashboard. A patient id or a username in a
 * label is a disclosure into a system with none of this application's access
 * controls — the same reasoning that keeps `audit_events.detail` non-identifying.
 * Labels here are modality, outcome and status class only.
 */
import type { Express, Request, Response } from 'express';
import client from 'prom-client';

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'healthai_' });

/**
 * Scan submissions by what happened to them.
 *
 * `outcome` is one of: analysed, refused_no_model, refused_no_consent,
 * rejected_input, rejected_upload, saturated, error. Deliberately not a boolean
 * success flag — "refused because no validated model exists" and "rejected
 * because the image is not assessable" are different operational situations with
 * different fixes, and collapsing them loses the distinction the whole platform
 * is built around.
 *
 * `refused_no_consent` is not a fault condition and must not be alerted on as
 * one: it is a patient exercising a choice, and the scan still reached a human.
 * It is counted so that the take-up rate of automated analysis is observable —
 * a sudden move in it usually means the consent copy or its placement changed,
 * not that anything broke.
 */
export const scanOutcomes = new client.Counter({
  name: 'healthai_scan_submissions_total',
  help: 'Scan submissions by modality and outcome',
  labelNames: ['modality', 'outcome'] as const,
  registers: [registry],
});

export const inferenceDuration = new client.Histogram({
  name: 'healthai_inference_duration_seconds',
  help: 'Time from receiving a scan to having a verdict',
  labelNames: ['modality'] as const,
  // Bucketed around what the resident-model service actually does (~0.5 s) and
  // what the subprocess fallback does (~8-14 s), so the two are distinguishable
  // on a graph without reading the configuration.
  buckets: [0.25, 0.5, 1, 2, 5, 10, 15, 30],
  registers: [registry],
});

/**
 * Inputs refused as unlike the training distribution.
 *
 * Separate from the outcome counter because the rate matters on its own. The
 * model cards record the measured flag rates — 0.8% on held-out same-modality
 * images, 100% on wrong-modality ones — and a production rate far from the
 * former is the first sign the deployed input distribution is not the one the
 * figures describe.
 */
export const oodRejections = new client.Counter({
  name: 'healthai_ood_rejections_total',
  help: 'Inputs refused as outside the model training distribution',
  labelNames: ['modality'] as const,
  registers: [registry],
});

/**
 * What the models actually called, in aggregate.
 *
 * The most dangerous failure available to this system is a model that keeps
 * answering while having silently become wrong: latency stays flat, the error
 * rate stays zero, and every dashboard above looks healthy while the verdicts
 * reaching radiologists have stopped meaning anything. Nothing else exported
 * here would move.
 *
 * There is no ground truth at inference time, so the only signal available in
 * real time is the rate at which the model says "positive". On a stable
 * population that rate is stable, and a collapse towards zero or a saturation
 * towards one is the signature of a wrong artifact, a preprocessing regression,
 * or a threshold misconfiguration — all of which have happened to this codebase
 * before and none of which any existing counter would reveal.
 *
 * `predicted` is the model's binary call, not a patient's condition. It is an
 * aggregate count with no subject, which is what keeps it inside the rule at
 * the top of this file: the series says "the lung model returned positive
 * 41 times this hour", never who any of them were.
 *
 * This does not measure whether the model is *right*. Only adjudicated outcomes
 * do that, and they live at GET /api/models/performance because they arrive
 * days later and belong in the database, not in a scrape.
 */
export const scanPredictions = new client.Counter({
  name: 'healthai_scan_predictions_total',
  help: 'Model calls by modality and predicted class',
  labelNames: ['modality', 'predicted'] as const,
  registers: [registry],
});

/**
 * Harm and near-harm, as reported.
 *
 * Counted here so that a cluster is visible without anyone opening the incident
 * list, which is the difference between a reporting system and an archive.
 *
 * `severity` and `category` are the fixed vocabularies from the schema — they
 * describe an event, not a person, so the rule at the top of this file holds.
 *
 * Read it as a report rate, never as a harm rate. Under-reporting is the normal
 * state of every incident system, so a fall in this series is not evidence that
 * the platform became safer; it is equally consistent with people having
 * stopped filing.
 */
export const adverseEventsReported = new client.Counter({
  name: 'healthai_adverse_events_total',
  help: 'Adverse events reported, by severity and category',
  labelNames: ['severity', 'category'] as const,
  registers: [registry],
});

export const breakGlassUses = new client.Counter({
  name: 'healthai_break_glass_total',
  help: 'Emergency accesses opened outside a recorded care relationship',
  registers: [registry],
});

export const careRelationshipDenials = new client.Counter({
  name: 'healthai_care_relationship_denials_total',
  help: 'Patient-record accesses without a care relationship',
  // "shadow" counts what enforcement would have refused; "enforced" counts what
  // it did refuse. Watching shadow fall towards zero is how you decide the
  // derivation is good enough to enforce.
  labelNames: ['mode'] as const,
  registers: [registry],
});

/**
 * Exposes /metrics.
 *
 * Unauthenticated, and that is a deployment decision rather than an oversight:
 * Prometheus scrapers generally do not carry session cookies, and the endpoint
 * exposes no personal information by construction. It should still be reachable
 * only from inside the cluster — bind the scrape target to the private network,
 * or put the path behind the ingress rather than in front of it.
 */
export function registerMetrics(app: Express): void {
  app.get('/metrics', async (_req: Request, res: Response) => {
    try {
      res.setHeader('Content-Type', registry.contentType);
      res.send(await registry.metrics());
    } catch (error) {
      console.error('Failed to render metrics:', error);
      res.status(500).send('# metrics unavailable\n');
    }
  });
}

export { registry };
