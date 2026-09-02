/**
 * Individual Typology Angle, ported from scripts/measure-skin-tone-performance.py.
 *
 * ── Why a port and not a call ──────────────────────────────────────────────
 *
 * The Python implementation runs offline over the test set. This runs on the
 * bytes already in hand at submission, on the Node side, so it works whether or
 * not INFERENCE_URL is configured — the subprocess fallback path would
 * otherwise be the only place it could live, and that path is the one meant to
 * be rare.
 *
 * ── The constraint that matters more than anything else here ──────────────
 *
 * **These bins must be comparable to the test-set bins or the whole exercise is
 * worse than useless.** A second, subtly different ITA implementation would
 * produce production numbers that cannot be read against the published
 * per-bin sensitivities, while looking like they can. Every constant below is
 * transcribed from the Python rather than chosen, including the ones that look
 * arbitrary: the 18% ring, the 45/245 pixel cut, the 200-pixel floor, the b*>1
 * refusal, and the half-open bin edges. scripts/verify-skin-tone-port.ts
 * checks the two agree on the real test images.
 *
 * ── What this is not ───────────────────────────────────────────────────────
 *
 * A proxy for skin tone, not a Fitzpatrick score, and not a statement about
 * anyone's race. It is affected by lighting, white balance, dermoscopy
 * artefacts and tanning. It is defensible for detecting a large disparity
 * across a population; it is not defensible as a fact about an individual, and
 * nothing in this system shows it to a clinician for exactly that reason.
 */
import sharp from 'sharp';

/** Chardon / Del Bino cut points, darkest first. Edges are `low < ita <= high`. */
export const TONE_BINS: Array<[name: string, low: number, high: number]> = [
  ['dark', -Infinity, -30.0],
  ['brown', -30.0, 10.0],
  ['tan', 10.0, 28.0],
  ['intermediate', 28.0, 41.0],
  ['light', 41.0, 55.0],
  ['very_light', 55.0, Infinity],
];

export type ToneBinName =
  | 'dark'
  | 'brown'
  | 'tan'
  | 'intermediate'
  | 'light'
  | 'very_light'
  | 'unclassified';

/** sRGB (0-255) to CIELab under a D65 white point. */
function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = lin(r), G = lin(g), B = lin(b);

  // sRGB D65 primaries, transcribed from the Python matrix.
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) * 100;
  const Y = (0.2126729 * R + 0.7151522 * G + 0.0721750 * B) * 100;
  const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) * 100;

  const white = [95.047, 100.0, 108.883];
  const delta = 6 / 29;
  const f = (t: number) =>
    t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;

  const fx = f(X / white[0]), fy = f(Y / white[1]), fz = f(Z / white[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** numpy.median: on an even count, the mean of the two middle values. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function toneBin(ita: number): ToneBinName {
  for (const [name, low, high] of TONE_BINS) {
    if (low < ita && ita <= high) return name as ToneBinName;
  }
  return 'unclassified';
}

export interface ToneEstimate {
  ita: number;
  bin: ToneBinName;
  /** How many border pixels survived the non-skin filter. */
  pixelsSampled: number;
}

/**
 * ITA of the healthy skin surrounding a centred lesion.
 *
 * Returns null when too little usable skin is visible to judge — which is the
 * correct answer for 149 of the 660 test images, and must stay an answer rather
 * than becoming a guess.
 */
export async function estimateSkinTone(image: Buffer): Promise<ToneEstimate | null> {
  let data: Buffer;
  let info: sharp.OutputInfo;
  try {
    // Plain .raw(): channels may be 3 or 4 and the loop below indexes by
    // `channels`, so RGBA needs no special handling. An earlier version called
    // .ensureAlpha(false), which is not a valid argument — it throws, the catch
    // below swallowed it, and every image was silently refused. The port
    // verification caught it; nothing else would have.
    const raw = await sharp(image).raw().toBuffer({ resolveWithObject: true });
    data = raw.data;
    info = raw.info;
  } catch {
    // Not a decodable still image — DICOM, or something the OOD screen will
    // refuse anyway. Absence of an estimate, not a failure of the scan.
    return null;
  }

  const { width: w, height: h, channels } = info;
  if (!w || !h || channels < 3) return null;

  // Border ring: the outer 18% on each side. Lesions sit centrally in both
  // dermoscopic and clinical framing, so this is mostly perilesional skin.
  const marginH = Math.trunc(h * 0.18);
  const marginW = Math.trunc(w * 0.18);

  const Ls: number[] = [];
  const bs: number[] = [];
  let kept = 0;

  for (let y = 0; y < h; y++) {
    const inHorizontalBand = y < marginH || y >= h - marginH;
    for (let x = 0; x < w; x++) {
      // The Python mask is the union of the top/bottom bands and the
      // left/right bands, so a pixel qualifies on either axis.
      if (!inHorizontalBand && !(x < marginW || x >= w - marginW)) continue;

      const i = (y * w + x) * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2];

      // Drop what is plainly not skin: dermoscope vignetting and hair at the
      // dark end, specular highlights and blown-out white at the bright end.
      const value = Math.max(r, g, b);
      if (value <= 45 || value >= 245) continue;

      const lab = srgbToLab(r, g, b);
      Ls.push(lab[0]);
      bs.push(lab[2]);
      kept++;
    }
  }

  if (kept < 200) return null;

  const L = median(Ls);
  const bStar = median(bs);

  // Skin is always yellow-positive on b*. A non-positive b* means the sampled
  // ring is not skin — a blue-grey background, ink marking, or gel — and the
  // arctan would flip sign and produce a plausible-looking but meaningless
  // angle. Refuse rather than bin it wrongly.
  if (bStar <= 1.0) return null;

  const ita = (Math.atan((L - 50.0) / bStar) * 180) / Math.PI;
  return { ita, bin: toneBin(ita), pixelsSampled: kept };
}
