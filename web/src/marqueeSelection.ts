export type MarqueeGeometry = {
  contentLeft: number;
  contentRight: number;
  rows: ReadonlyArray<{ path: string; top: number; bottom: number }>;
};

export function pathsInsideMarquee(
  geometry: MarqueeGeometry,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  if (left >= geometry.contentRight || right <= geometry.contentLeft) return [];

  const top = Math.min(startY, endY);
  const bottom = Math.max(startY, endY);
  const first = firstRowWithBottomAfter(geometry.rows, top);
  const end = firstRowWithTopAtOrAfter(geometry.rows, bottom);
  if (first >= end) return [];

  const paths = new Array<string>(end - first);
  for (let index = first; index < end; index += 1) {
    paths[index - first] = geometry.rows[index].path;
  }
  return paths;
}

function firstRowWithBottomAfter(rows: MarqueeGeometry["rows"], y: number) {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (rows[middle].bottom <= y) low = middle + 1;
    else high = middle;
  }
  return low;
}

function firstRowWithTopAtOrAfter(rows: MarqueeGeometry["rows"], y: number) {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (rows[middle].top < y) low = middle + 1;
    else high = middle;
  }
  return low;
}
