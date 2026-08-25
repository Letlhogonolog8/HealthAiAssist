/**
 * What an upload actually is, decided from its bytes.
 *
 * multer's `fileFilter` checks `file.mimetype`, which is the Content-Type the
 * client put in the multipart part header. It is not derived from the file and
 * nothing verifies it: a caller can label anything `image/jpeg`. That check is
 * a convenience for rejecting obvious mistakes, not a control.
 *
 * It is also wrong in the ordinary case, not only the adversarial one. DICOM
 * objects arrive as `application/dicom`, `application/octet-stream`, or with no
 * type at all depending on the PACS that exported them — which is why that
 * allowlist had to be widened to include `application/octet-stream`, and why
 * widening it means the header now permits nearly anything.
 *
 * So the bytes decide. A JPEG starts with FF D8 FF; a PNG with the eight-byte
 * signature; a DICOM object carries "DICM" at offset 128.
 */
import { fileTypeFromBuffer } from 'file-type';

/** Raster formats the pipeline can decode. */
const ACCEPTED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
  'image/avif',
]);

const DICOM_MAGIC_OFFSET = 128;

export interface UploadVerdict {
  ok: boolean;
  /** What the bytes say it is. */
  detected: string | null;
  reason?: string;
}

export function looksLikeDicom(buffer: Buffer): boolean {
  return (
    buffer.length > DICOM_MAGIC_OFFSET + 4 &&
    buffer.toString('latin1', DICOM_MAGIC_OFFSET, DICOM_MAGIC_OFFSET + 4) === 'DICM'
  );
}

/**
 * Decides whether these bytes are something the pipeline should accept.
 *
 * Rejects rather than sanitises. There is no safe way to "clean" a file whose
 * type is not what it claimed — the only correct response is to refuse it and
 * say what was actually detected, which is also the more useful error for the
 * ordinary case of somebody uploading a PDF of a report by mistake.
 */
export async function verifyUpload(buffer: Buffer): Promise<UploadVerdict> {
  if (!buffer || buffer.length === 0) {
    return { ok: false, detected: null, reason: 'The file is empty.' };
  }

  // Checked first: a DICOM preamble is 128 bytes of anything at all, so a
  // content sniffer looking at the start of the file will frequently identify a
  // DICOM object as something else or as nothing.
  if (looksLikeDicom(buffer)) {
    return { ok: true, detected: 'application/dicom' };
  }

  const detected = await fileTypeFromBuffer(buffer);

  if (!detected) {
    return {
      ok: false,
      detected: null,
      // Deliberately not "invalid image". A file with no recognised signature is
      // frequently a text file, a script, or a truncated upload, and saying so
      // is more useful than a generic refusal.
      reason:
        'This file has no recognisable image format. Upload a JPEG, PNG, TIFF, ' +
        'WebP or AVIF image, or a DICOM object.',
    };
  }

  if (!ACCEPTED_IMAGE_MIME.has(detected.mime)) {
    return {
      ok: false,
      detected: detected.mime,
      reason:
        `This file is a ${detected.ext.toUpperCase()} (${detected.mime}), which the ` +
        'analysis pipeline cannot read. Upload a JPEG, PNG, TIFF, WebP or AVIF ' +
        'image, or a DICOM object.',
    };
  }

  return { ok: true, detected: detected.mime };
}
