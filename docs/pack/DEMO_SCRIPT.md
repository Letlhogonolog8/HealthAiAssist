# Demonstration Script

**Runtime: 8 minutes.** Written for a panel that has been shown clinical AI
before and has learned to discount accuracy claims.

## The one decision this script makes

**Three of the five demonstrations are the system refusing to answer.**

That is deliberate and it is the whole argument. Every entrant will show a scan
going in and a confident result coming out. What distinguishes this platform is
what happens when it *should not* answer — and those paths are invisible unless
you show them on purpose.

Do not cut them for a tidier demo. A video showing only successes is
indistinguishable from everyone else's.

---

## Before you start

```bash
# 1. Inference service — without it every scan takes 8-14 s instead of ~500 ms
pip install -r inference/requirements.txt
uvicorn inference.server:app --host 127.0.0.1 --port 8001

# 2. Application
export INFERENCE_URL=http://127.0.0.1:8001
npm run dev

# 3. Confirm both models are resident and their hashes match what gets recorded
curl -s localhost:8001/healthz | python -m json.tool
```

Checklist:

- [ ] `/healthz` shows `"loaded": true` for **skin** and **lung_nodule**. (The
      legacy lung model is also resident, for measurement; it is withdrawn from
      serving and the application will not route to it — `GET /api/models/cards`
      shows `lung` as DISABLED and `lung_nodule` as VALIDATION.)
- [ ] A LIDC slice and a labelled nodule centre to hand:
      `python scripts/lidc_find_nodule_slice.py` prints the path and (cx, cy).
- [ ] A warm scan returns in **~470 ms**. Run two before the panel arrives — the
      first request after start-up traces the graphs and is slower.
- [ ] Know the Grad-CAM number: turning it on costs **~1.2 s extra**, so Act I
      lands at roughly 1.7 s, not 500 ms. Say "about a second and a half, and
      most of that is the explanation" rather than letting a panellist notice a
      gap between the claim and the clock.
- [ ] Test images to hand: a malignant dermoscopic image, a held-out chest PNG,
      a real LIDC-IDRI DICOM (any `.dcm` under `dataset/manifest-1600709154662/`)
- [ ] Signed in as a patient in one browser profile, a radiologist in another
- [ ] Browser zoom at 100%; DevTools closed until Act IV

---

## Act I — A result, and what travels with it *(90 s)*

Upload a malignant dermoscopic image as the patient.

**Say:**
> This is a screening triage tool. It has just produced a probability, and it has
> not produced a diagnosis. Notice what came back with the number.

**Point at:**
- The calibrated probability — *"calibration measured at 0.024 expected error, so when it says 90% it is right about 90% of the time"*
- **Clinician review required** — *"there is no path through this system that skips it"*
- The model version — *"a hash of the artifact that produced this, so this result can still be explained after the model is retrained"*

Toggle the **Grad-CAM overlay**. It adds about 1.2 s — say so rather than
letting it look like the base latency.

> This shows where the model looked. It is not a lesion boundary and not a
> measurement, and the caption says so. It is here because a clinician will not
> act on a bare probability, and nor should they.

---

## Act II — The refusal that matters most *(2 min)*

**The centrepiece.** Take the *same* skin classifier and give it a chest image.

**Say before you press anything:**
> Most clinical AI, given the wrong modality, returns a confident answer. It has
> no way to know it is out of its depth. Watch.

Upload the chest image to the **skin** analyser.

**Expected:**
```
rejected_input
"This image does not resemble the dermoscopic images the model was
 trained on, so no classification was produced."
oodScore: 37.04   threshold: 22.63
```

> No classification. Not a low-confidence one — none. The measurement behind that
> is in the model card: wrong-modality images flag at 100%, held-out
> same-modality images at 0.8%.

> The screen is validated in both directions — the domains it must accept and
> the domains it must refuse, with the bars set before measurement. That
> measurement can fail, and Act V is what happened when it did.

---

## Act III — Refusing a modality it has no model for *(60 s)*

Open the scan-type menu.

> Breast, colon and prostate are not on this menu. They have no trained
> classifier, so the system will not offer them. Lung is not on it either, as
> of five days ago — that is Act V.

If a panellist asks what happens if one is submitted directly to the API:

```bash
curl -X POST .../api/scan/upload -F "image=@x.jpg" -F "scanType=breast"
# HTTP 503 — no diagnostic content, scan queued for manual review
```

> An earlier version of this system filled that gap with `Math.random()`,
> including a lung path that defaulted to `no_cancer` whenever the model failed
> to load — which it always did, because the path pointed at a directory that
> existed on no deployed machine. Nothing in the response distinguished that
> fabricated negative from a real one. That is why the refusal is now the
> designed behaviour rather than an error case.

---

## Act IV — Offline capture *(2 min)*

The most memorable moment. DevTools → Network → **Offline**.

> A clinic on intermittent connectivity is the target user, so this is not a
> degraded mode — it is the mode.

Capture a scan while offline.

**Point at the wording, not the mechanism:**
> "Nothing has been analysed yet. These are held on this device and will upload
> when there is a connection."
>
> The queue holds an upload. It never holds a result. An offline mode that showed
> a cached or estimated finding would contradict everything in the last three
> minutes, in the one situation where the patient is least able to check.

Go back online. The queue flushes and the real result appears.

---

## Act V — The finding we published against ourselves *(2 min)*

**This is the act that wins or loses the room.** Open `GET /api/models/cards`
and point at lung: `enabled: false`, `state: "withdrawn"`, and the reason.

**Say:**
> Until five days ago this platform served a lung model, and this script had an
> act where we uploaded a real CT to it and it refused — and we said that proved
> the out-of-distribution screen worked. It did refuse. The object we had tested
> was a 128-by-128 scan from the 1990s that ships with a Python library.
>
> On the twentieth of September we pointed the same validation script at
> eighty-seven real chest CT slices from LIDC-IDRI. Eighty-four passed the
> screen, and the model gave verdicts on them. It had never been measured on CT.
> A verdict with no measured basis is a guess, and this platform's rule is to
> refuse rather than guess. So the script exited non-zero, we switched the model
> off that day, and we rewrote the claim.

Then submit the real DICOM as a lung scan anyway. The interface no longer
offers lung — a tool with no model behind it is not shown as a tool — so this
goes to the API directly, which is also the more convincing demonstration:

```bash
curl -X POST .../api/scans/analyze -F "image=@LIDC-IDRI-0001.dcm" -F "scanType=lung"
```

**Expected:** HTTP 503 —
> *"Withdrawn 2026-09-20 … 84 of 87 LIDC-IDRI slices passed its
> out-of-distribution screen … Lung scans are stored and queued for a
> radiologist until a CT-trained model is bound."*

> That scan is now in the radiologist's queue with no automated result attached.
> The DICOM was de-identified on the way in, the same as before. What changed is
> that nothing pretends to have read it.
>
> We could have raised the threshold until the test passed, or quietly dropped
> the domain from the script. Either would have demoed better and been worthless
> in a clinic. The replacement — a nodule characteriser trained on that same CT
> data — is on disk, calibrated, and refuses whole slices at ninety percent. It
> serves when it has a binding, through the same process that withdrew this one.

**If there is time (60 s): the replacement.** Sign in as the radiologist, open
the Lung Nodule tab, upload the `.dcm` the script named, click the nodule at
the printed (cx, cy), and submit for a patient.

> This is what replaced it, four days later, through the same governance
> process. A radiologist marks one nodule; the model says how likely a
> radiologist would be to rate it malignant. Look at what comes back: the
> probability, the threshold, the calibration, the out-of-distribution score,
> the fingerprint, the evidence class — and the words "clinical validation:
> not established". Twenty-nine malignant nodules in its test set. It is
> served under validation terms, and every screen says so.

Then hand over the model card, open at the skin-tone section.

> The same applies here. We measured performance across skin tones and the
> finding is that **our dataset cannot answer the question** — 4.3% of our test
> images are brown or darker, and the darkest bin holds four images with no
> controls. We publish that rather than an encouraging average.

---

## Closing *(30 s)*

> One serving modality at 0.86 balanced accuracy on held-out data, and one we
> withdrew last week. Both numbers are respectable for the stage and unremarkable
> against the literature, and someone in this competition will claim higher.
>
> What we would ask you to weigh instead is that this system knows when it does
> not know — and that every limitation you have just seen, we found and published
> ourselves.

---

## Capacity, if asked

Measured on the development machine, one inference instance:

| | |
|---|---|
| Warm inference | ~470 ms (skin) |
| With Grad-CAM | ~1.7 s |
| Sustained throughput | ~2 scans/second — inference is serialised behind a lock, so this is the designed ceiling, not a bottleneck to fix |
| 30 concurrent requests | 27 served, **3 shed with 503 + Retry-After**, queue drained to zero |

The shedding is the point. Past the queue depth the service refuses rather than
accumulating work it cannot reach — and a 503 becomes a scan queued for manual
review, so nothing is lost. Roughly 7,000 scans an hour on one instance is well
beyond what a district hospital produces.

---

## Questions to expect

| Question | Answer |
|---|---|
| *"Where did your training data come from?"* | Skin: a public ISIC-derived collection, 96% light-skinned — documented. Lung: unrecorded web-sourced provenance, which is why it was withdrawn once it was found answering real CT. The replacement is LIDC-IDRI (TCIA, CC BY 3.0). All stated in the model card. **Do not improvise a source.** |
| *"Why is your accuracy lower than published work?"* | Small self-trained models on public data, CPU-only training. We report the measurement rather than the best number we could produce. |
| *"Is it a medical device?"* | Yes, under the Medicines and Related Substances Act, once it informs a clinical decision. No SAHPRA submission, no clearance, no compliance claim. Expected Class B/IIa, to be confirmed at pre-submission. |
| *"Has a clinician used it?"* | Answer honestly. `[CONFIRM before submission]` |
| *"What happens to a flagged scan overnight?"* | There is no on-call path today. `docs/pack/FAILURE_MODES.md` F-03 states it as the largest operational gap, and it is a facility commitment rather than a feature. |
| *"Is it POPIA compliant?"* | We make no compliance claim. The DPIA records 16 risks including six unmet conditions, and names an unassigned Information Officer as the first. |

**If you do not know, say so and offer to follow up.** Every document in this
pack is written to survive being checked; an improvised answer is the one thing
that would undermine it.

---

## Recording it

Same five acts. Screen capture at 1080p, no music, no speed-ramping.

Show the terminal alongside the browser for Acts II and V — the OOD scores and
the HTTP status are the evidence, and a viewer who only sees the UI has to take
your word for it.

Ninety seconds of it is the refusal paths. That is the correct proportion.
