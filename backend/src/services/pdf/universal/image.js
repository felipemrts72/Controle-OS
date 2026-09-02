export function imageAsset(doc, value) {
  if (!value) return null;
  const buffer = Buffer.isBuffer(value) ? value : value.buffer;
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  try {
    const opened = doc.openImage(buffer);
    return { buffer, width: opened.width, height: opened.height };
  } catch {
    return null;
  }
}

export function containSize(image, maxWidth, maxHeight) {
  if (!image?.width || !image?.height) return null;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  return { width: image.width * scale, height: image.height * scale };
}
