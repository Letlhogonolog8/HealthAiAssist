# Accessibility

Audited August 2026 against **WCAG 2.1 Level AA**, using axe-core 4.x driven
through a real browser against a running build — not a static scan, because
the defects found were only visible once components had rendered against the
backgrounds they actually get.

Pre-Application Guidelines §7 names "clinical utility and usability" as an
evaluation criterion. This is the usability half of it, measured.

---

## Result

| Surface | Violations before | After |
|---|---|---|
| Public home page | 1 rule, 32 nodes | **0** |
| Patient dashboard — Overview | 2 rules, 3 nodes | **0** |
| New Scan · Results · Appointments · Risk Assessment · Skin Scanner | 0 | **0** |
| Sign-in dialog | 0 | **0** |
| Account security dialog | 0 | **0** |
| Dashboard, light theme | 0 | **0** |

Rules run: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`.

---

## What was wrong

### Colour contrast — 32 nodes on the public pages

Two Tailwind greys, used as secondary text on near-black grounds:

| Class | Colour | Measured | Required |
|---|---|---|---|
| `text-slate-500` | `#64748b` | 3.84 – 4.23 : 1 | 4.5 : 1 |
| `text-slate-600` | `#475569` | 2.41 – 2.66 : 1 | 4.5 : 1 |

Affected the captions carrying the platform's most careful statements — "Balanced
acc.", "Evaluated on", "withheld", "2 of 5 available", the Martin et al.
citation. The text explaining what the system will not do was the text hardest
to read.

Both moved to `text-slate-400` (`#94a3b8`), which clears 4.5:1 on every ground
used. Applied only to components with no `dark:` variants — those render dark
regardless of theme, so there is no light surface where `slate-400` would be too
pale.

### Logout button — 1.48 : 1

`text-slate-300` on the outline variant's own light background. Not low contrast;
effectively invisible.

Worth recording *why* it survived review: the surrounding header is dark, so
`text-slate-300` looked correct in context. The button variant supplied a
background nobody had checked the class against. A colour is only readable
relative to what is behind it, and "what is behind it" was coming from a
different file.

### View Results button — 3.14 : 1

White on `bg-green-600`. Moved to `green-700`. Three instances, one per role's
quick actions.

### Unnamed button — critical

The chat launcher is icon-only, so it has no text node: a screen reader
announced "button" and nothing else. It now carries an `aria-label`, and the
icon is `aria-hidden`.

The unread count and the connection-error state go into the label too. Both were
signalled only visually — a red badge and a small orange dot — so a screen reader
user had no way to know either. `enhanced-chatbot.tsx` renders the launcher that
actually appears on the dashboard; `floating-chatbot.tsx` has a second one, and
both are fixed.

---

## What was already right

Not everything needed fixing, and the reasons are worth keeping:

- **Radix UI primitives** supply roles, focus management and keyboard handling
  for dialogs, tabs, dropdowns and tooltips. Every dialog traps focus, closes on
  Escape and returns focus on close without any code here doing it.
- **Forms are forms.** Both sign-in tabs are real `<form>` elements that submit
  on Enter and carry `autocomplete` tokens a password manager understands. They
  were not — the inputs sat in a `<div>` with an `onClick` button, so Enter did
  nothing.
- **Images carry alt text**, including the enrolment QR code.
- **Focus is visible**: `focus-visible:ring-2` throughout the button primitive.
- **Reduced motion** is respected in the artifact stylesheets.

---

## Not covered

An automated pass finds roughly a third of WCAG issues. It cannot judge whether
alt text is *accurate*, whether reading order matches visual order, or whether an
error message is comprehensible. What remains:

- **Screen reader walkthrough.** The interface has not been driven end to end
  with NVDA, JAWS or VoiceOver by someone who uses one. This is the largest
  remaining gap, and it is the one an automated tool cannot substitute for.
- **Keyboard-only journey.** Individual controls are reachable; a complete
  patient journey — sign in, upload a scan, read the result — has not been walked
  without a mouse.
- **Zoom and reflow.** WCAG 2.1 requires usability at 400% zoom / 320 CSS px.
  Untested.
- **Role dashboards beyond patient.** Doctor, radiologist and admin surfaces have
  not been audited. The admin dashboard is the largest component in the codebase
  and the most likely to hold further defects.
- **Language attribute per element.** Once a second language ships (see
  [`client/src/lib/language-availability.ts`](../client/src/lib/language-availability.ts)),
  mixed-language content needs `lang` attributes or a screen reader pronounces
  isiZulu with English phonetics.

---

## Reproducing this

```bash
npm run dev
cp node_modules/axe-core/axe.min.js client/public/__axe.js   # served same-origin
```

Then in the browser console, on each surface:

```js
const t = document.createElement('script');
t.src = '/__axe.js';
t.onload = async () => {
  const r = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] },
  });
  console.table(r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length })));
};
document.head.appendChild(t);
```

A `<script src>` rather than `eval()`: the app's CSP allows `script-src 'self'`
but not `'unsafe-eval'`. That the audit tool has to respect the policy under
audit is a good sign.

Remove `client/public/__axe.js` afterwards — it is a 580 kB development
dependency and has no business in a build.
