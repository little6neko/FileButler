export type PathSegment = {
  label: string;
  path: string;
};

export type FittedPathSegments = {
  visible: PathSegment[];
  hidden: PathSegment[];
};

export function displayPath(path: string) {
  return path && path !== "." ? `/${path.replace(/^\/+/, "")}` : "/";
}

export function normalizeInput(path: string) {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") return ".";
  return trimmed.replace(/^\/+/, "").replace(/\/+$/, "") || ".";
}

export function buildPathSegments(path: string): PathSegment[] {
  const normalized = normalizeInput(path);
  const segments: PathSegment[] = [{ label: "/", path: "." }];
  if (normalized === ".") return segments;

  const parts = normalized.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    segments.push({ label: part, path: current });
  }
  return segments;
}

export function fitPathSegments(
  segments: PathSegment[],
  widths: number[],
  separatorWidth: number,
  ellipsisWidth: number,
  availableWidth: number,
): FittedPathSegments {
  if (segments.length <= 3 || widths.length !== segments.length) {
    return { visible: segments, hidden: [] };
  }

  const completeWidth = widths.reduce((total, width) => total + width, 0) + separatorWidth * (segments.length - 1);
  if (completeWidth <= availableWidth) {
    return { visible: segments, hidden: [] };
  }

  const lastIndex = segments.length - 1;
  let suffixStart = lastIndex;
  let fittedWidth = widths[0] + widths[1] + widths[lastIndex] + ellipsisWidth + separatorWidth * 3;

  for (let index = lastIndex - 1; index >= 2; index -= 1) {
    const candidateWidth = fittedWidth + separatorWidth + widths[index];
    if (candidateWidth > availableWidth) break;
    fittedWidth = candidateWidth;
    suffixStart = index;
  }

  return {
    visible: [segments[0], segments[1], ...segments.slice(suffixStart)],
    hidden: segments.slice(2, suffixStart),
  };
}
