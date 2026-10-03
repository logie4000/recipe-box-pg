/** Longest side of an uploaded photo, in pixels. */
export const MAX_IMAGE_SIDE = 2000;

/** The write-api's limit (RecipeImage::MAX_BYTES). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Turns a dropped or chosen photo into what we upload: at most
 * MAX_IMAGE_SIDE pixels on its longest side, re-encoded as JPEG.
 * Re-encoding drops EXIF data such as the GPS position phones record, which
 * matters once a recipe is shared. Browsers apply the EXIF rotation when
 * decoding, so the result is the right way up. Transparent areas become white.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('That image could not be read. Try a JPEG or PNG.');
  }

  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('This browser cannot prepare images.');
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  );
  if (!blob) {
    throw new Error('That image could not be converted.');
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error('That image is too large.');
  }
  return blob;
}
