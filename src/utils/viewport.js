export function shouldScrollElementIntoView(rect, viewportHeight) {
  if (!rect || !Number.isFinite(viewportHeight)) return false;
  return rect.top < 0 || rect.bottom > viewportHeight;
}
