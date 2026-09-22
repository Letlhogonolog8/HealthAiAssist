/**
 * GET /api/capabilities — the server decides what the platform can do.
 *
 * Every misleading claim removed from this project's interface had the same
 * shape: a page said something the backend could not do. These tests pin the
 * mechanism that stops it recurring — a capability's status is computed from
 * the model registry and the governance check, the page renders what it is
 * given, and the page source carries no modality claims of its own.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { Session, startServer, stopServer } from './helpers/server.ts';

const TIMEOUT = 120_000;

const STATUSES = ['CURRENT', 'VALIDATION', 'IN_DEVELOPMENT', 'PLANNED', 'FUTURE', 'DISABLED'];
const STAGES = ['DETECT', 'SEGMENT', 'LOCALIZE', 'CHARACTERIZE', 'UNDERSTAND', 'ASSIST'];

let manifest: any;
let cards: any;

before(async () => {
  await startServer();
  const session = new Session();
  const m = await session.get('/api/capabilities');
  assert.equal(m.status, 200, m.text.slice(0, 200));
  manifest = m.json;
  const c = await session.get('/api/models/cards');
  assert.equal(c.status, 200);
  cards = c.json;
});

after(async () => {
  await stopServer();
});

describe('the manifest', { timeout: TIMEOUT }, () => {
  test('is public, and defines its own vocabulary', () => {
    assert.deepEqual(Object.keys(manifest.statuses).sort(), [...STATUSES].sort());
    assert.deepEqual(manifest.stages.map((s: any) => s.id), STAGES);
    for (const status of STATUSES) {
      assert.ok(manifest.statuses[status].length > 30, `${status} has no definition`);
    }
    // "Clinically validated" is not a status, because nothing has reached it.
    assert.ok(!Object.keys(manifest.statuses).some((s) => /CLINICAL/i.test(s)));
  });

  test('every capability carries evidence for its status', () => {
    assert.ok(manifest.capabilities.length >= 10);
    for (const cap of manifest.capabilities) {
      assert.ok(STATUSES.includes(cap.status), `${cap.id}: unknown status ${cap.status}`);
      assert.ok(cap.evidence && cap.evidence.length > 40, `${cap.id}: no evidence given`);
      assert.ok(cap.input && cap.input.length > 5, `${cap.id}: no input described`);
      for (const [stage, status] of Object.entries(cap.stages)) {
        assert.ok(STAGES.includes(stage), `${cap.id}: unknown stage ${stage}`);
        assert.ok(STATUSES.includes(status as string), `${cap.id}/${stage}: unknown status`);
      }
    }
  });

  test('CURRENT and VALIDATION are only ever backed by an enabled, matched model', () => {
    for (const cap of manifest.capabilities) {
      if (cap.status !== 'CURRENT' && cap.status !== 'VALIDATION') continue;
      assert.ok(cap.scanType, `${cap.id} is ${cap.status} with no model behind it`);
      const card = cards.models.find((m: any) => m.scanType === cap.scanType);
      assert.ok(card, `${cap.id} names a model the card endpoint does not know`);
      assert.equal(card.enabled, true, `${cap.id} is serving on a disabled model`);
      assert.equal(card.figuresDescribeDeployedArtifact, true, `${cap.id} serves an unmeasured artifact`);
      assert.equal(card.status, cap.status, 'the card and the manifest disagree');
      assert.equal(card.clinicallyValidated, false);
      assert.ok(card.modelClass, 'a serving model states its evidence class');
      assert.ok(
        !['CLINICAL_VALIDATION', 'PRODUCTION'].includes(card.modelClass),
        `${cap.id} claims an evidence class nothing here has reached`
      );
    }
  });

  test('a stage is never healthier than the capability it belongs to', () => {
    const rank = (s: string) => STATUSES.indexOf(s);
    for (const cap of manifest.capabilities) {
      if (cap.status === 'DISABLED') {
        for (const s of Object.values(cap.stages)) assert.equal(s, 'DISABLED', `${cap.id}`);
      }
      if (cap.status === 'PLANNED' || cap.status === 'FUTURE') {
        for (const s of Object.values(cap.stages)) {
          assert.ok(rank(s as string) >= rank('PLANNED'), `${cap.id} has a live stage while ${cap.status}`);
        }
      }
    }
  });

  test('the withdrawn lung model is DISABLED, and the future modalities are FUTURE', () => {
    const legacy = manifest.capabilities.find((c: any) => c.scanType === 'lung');
    assert.ok(legacy, 'the withdrawn model is still listed — a gap you can see');
    assert.equal(legacy.status, 'DISABLED');
    assert.match(legacy.evidence, /withdrawn/i);

    for (const id of ['breast-imaging', 'colon-gi-imaging', 'prostate-imaging', 'medical-video']) {
      const cap = manifest.capabilities.find((c: any) => c.id === id);
      assert.ok(cap, `${id} missing from the manifest`);
      assert.equal(cap.status, 'FUTURE');
      assert.equal(cap.scanType, null);
      assert.match(cap.evidence, /no model/i);
    }

    for (const id of ['lung-nodule-detection', 'lung-nodule-segmentation', 'ct-volume']) {
      const cap = manifest.capabilities.find((c: any) => c.id === id);
      assert.ok(cap, `${id} missing`);
      assert.ok(['PLANNED', 'IN_DEVELOPMENT'].includes(cap.status), `${id} is ${cap.status}`);
    }
  });

  test('the model cards agree with the manifest on every registered modality', () => {
    for (const m of manifest.modalities) {
      const card = cards.models.find((c: any) => c.scanType === m.scanType);
      assert.ok(card, `${m.scanType} on the manifest but not the cards`);
      assert.equal(card.status, m.status);
      if (m.status === 'DISABLED') assert.ok(m.reason || card.measurementBinding?.explanation);
    }
  });
});

describe('the page carries no claims of its own', { timeout: TIMEOUT }, () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'client', 'src', rel), 'utf8');

  test('the coverage and workflow sections name no modality in source', () => {
    for (const rel of [
      'components/cancer-detection-section.tsx',
      'components/pipeline-stages-section.tsx',
      'components/enhanced-hero-section.tsx',
    ]) {
      const src = read(rel);
      // Modality names and performance words belong to the server. A component
      // that mentions them has started deciding capabilities again.
      for (const word of ['breast', 'prostate', 'cervical', 'colon', 'mammograph', 'endoscop']) {
        assert.ok(!new RegExp(word, 'i').test(src), `${rel} names "${word}" — capabilities come from the server`);
      }
      assert.ok(!/\d{2}(\.\d)?%\s*(accuracy|sensitivity|specificity)/i.test(src), `${rel} hardcodes a figure`);
      assert.ok(/\/api\/(capabilities|models\/cards)/.test(src), `${rel} does not read the server`);
    }
  });
});
