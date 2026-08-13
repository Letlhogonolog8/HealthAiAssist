/**
 * Real image-processing utilities used by the analysis pipeline.
 *
 * This module previously exported `performEnhancedMedicalAnalysis`, described as a
 * three-model consensus ensemble. It was not one: all three "models" returned
 * `Math.random()` values, and the ensemble voted on them to produce a cancer
 * verdict with a fabricated confidence score. It has been removed rather than
 * repaired — there was nothing underneath it to repair.
 *
 * Anything reintroduced here must be backed by an actual trained model. Modality
 * support is declared in `model-availability.ts`; scan types with no model now
 * fail with `ModelUnavailableError` instead of receiving an invented result.
 */
import sharp from 'sharp';

/** Normalise contrast, sharpen edges and gamma-correct a medical image. */
export async function preprocessMedicalImage(imageBuffer: Buffer): Promise<Buffer> {
  try {
    const processedImage = await sharp(imageBuffer)
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
      .normalize()
      .sharpen()
      .gamma(1.2)
      .jpeg({ quality: 95 })
      .toBuffer();

    return processedImage;
  } catch (error) {
    console.error('Image preprocessing failed:', error);
    return imageBuffer;
  }
}

/**
 * Heuristic image-quality score (0-100) based on resolution and format.
 * This measures the image, not the patient — it is not a clinical signal.
 */
export async function assessImageQuality(imageBuffer: Buffer): Promise<number> {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    let qualityScore = 100;

    if (metadata.width && metadata.width < 256) qualityScore -= 20;
    if (metadata.height && metadata.height < 256) qualityScore -= 20;

    if (metadata.format === 'jpeg' && metadata.density && metadata.density < 72) {
      qualityScore -= 10;
    }

    return Math.max(qualityScore, 0);
  } catch (error) {
    return 70; // Default quality score
  }
}

/** Standard deviation of a set of model predictions. */
export function calculateUncertainty(predictions: number[]): number {
  const mean = predictions.reduce((sum, p) => sum + p, 0) / predictions.length;
  const variance = predictions.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / predictions.length;
  return Math.sqrt(variance);
}
