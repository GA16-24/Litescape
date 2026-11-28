// Which of your shares a new share folds into. Mirrors the server's rule in LitWeb.upload, so the viewer can ask first.

// Either corner can come first (a rotated or mirrored sub-region), as Volume.union allows.
const union = (boxes) =>
  [0, 1, 2, 3, 4, 5].map((i) => (i < 3 ? Math.min : Math.max)(...boxes.flatMap((b) => [b[i % 3], b[(i % 3) + 3]])));

/**
 * The shares among `shares` (already only yours, in this dimension, not this placement's own) that a share of
 * `boxes` ([x0, y0, z0, x1, y1, z1], inclusive) would merge with: those it overlaps, then those the joint box reaches.
 */
export function mergesWith(boxes, shares) {
  let box = union(boxes);
  const over = [];
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of shares) {
      const b = [...s.origin, ...s.origin.map((v, i) => v + s.size[i] - 1)];
      if (over.includes(s) || [0, 1, 2].some((i) => b[i] > box[i + 3] || b[i + 3] < box[i])) continue;
      over.push(s);
      box = union([box, b]);
      grew = true;
    }
  }
  return over;
}
