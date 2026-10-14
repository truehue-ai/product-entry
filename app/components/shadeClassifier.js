// Skin tone (F / FM / MD / D1 / D2 / VD) and undertone (W / N / C) for foundation & concealer shades.
//
// Fitted on two hand-labelled products: a 48-shade range (100w … 570n) and Benefit Porefessional (19 shades
// picked from Sephora India swatches).
//  - Skin tone is judged relative to the product's own shade range, because brands label their ranges that way:
//      score = 75% × position in the product's lightness range (0 = its deepest shade, 100 = its lightest)
//            + 25% × absolute lightness (CIELAB L*, how light the colour looks to the eye)
//    Lightness, not RGB brightness, so a muted shade isn't pushed darker and a saturated one isn't pushed lighter.
//    Both products: 57/67 (45/48 and 12/19), 51/67 when each shade is predicted with the rules refitted without it
//    (best of everything tried). Every miss is off by one level. Some Benefit labels can't be matched by any
//    colour rule: they follow shade numbers, e.g. 19n is darker than 22n but labelled lighter.
//    Ranges that don't run fair → deep (lightness span < 40, or fewer than 4 shades) use the absolute rule instead,
//    so a deep-only range isn't stretched up to F.
//  - Undertone follows hue, with separate cut-offs for F, FM and the deeper tones, because the same hue
//    reads warmer on a deep shade than on a fair one. Matches 45/48 (old rules: 44/48); the 3 misses are
//    shades whose labels overlap other undertones at the same hue.
// Values are computed from the exact hex (no rounding) — the F/FM boundary is less than 1 point wide.

const TONE_CUTOFFS = [
  // [tone, weight on V, weight on L*, minimum score] — a shade gets the first tone whose score it reaches
  ["F", 0.996, 0.087, 96.82],
  ["FM", 0.391, 0.921, 94.04],
  ["MD", 0.342, 0.940, 79.96],
  ["D1", 1.0, 0.0, 61.18],
  ["D2", 0.956, 0.292, 55.95],
];

// Score cut-offs for the range-relative rule (see top)
const RELATIVE_TONE_CUTOFFS = [["F", 79.05], ["FM", 64.71], ["MD", 51.65], ["D1", 31.98], ["D2", 19.63]];
const MIN_RANGE_SPAN = 40; // L* span below which a product isn't treated as a full fair-to-deep range
const MIN_RANGE_SHADES = 4;

const UNDERTONE_CUTOFFS = {
  // hue (degrees): below `cool` -> C, at/above `warm` -> W, in between -> N
  F: { cool: 25.3, warm: 29.0 },
  FM: { cool: 23.0, warm: 28.5 },
  deep: { cool: 19.2, warm: 23.5 }, // MD, D1, D2, VD
};

function hexToHsb(hex) {
  let clean = String(hex || "").trim().replace("#", "");
  if (clean.length === 3) clean = clean.split("").map((ch) => ch + ch).join("");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100, L: labLightness(r, g, b) };
}

// CIELAB L* (0-100) from sRGB channels in 0-1
function labLightness(r, g, b) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const f = Y > 0.008856 ? Math.cbrt(Y) : 7.787 * Y + 16 / 116;
  return 116 * f - 16;
}

export function classifySkinTone(hex) {
  const hsb = hexToHsb(hex);
  if (!hsb) return "";
  for (const [tone, wV, wL, min] of TONE_CUTOFFS) if (wV * hsb.v + wL * hsb.L >= min) return tone;
  return "VD";
}

export function classifyUndertone(hex, skintone = classifySkinTone(hex)) {
  const hsb = hexToHsb(hex);
  if (!hsb || !skintone) return "";
  // reds that wrap past 360° are the coolest (pinkest) shades
  const h = hsb.h > 300 ? hsb.h - 360 : hsb.h;
  const { cool, warm } = UNDERTONE_CUTOFFS[skintone] || UNDERTONE_CUTOFFS.deep;
  if (h < cool) return "C";
  if (h >= warm) return "W";
  return "N";
}

// Single shade, no product context: absolute rule.
export function classifyShade(hex) {
  const skintone = classifySkinTone(hex);
  return { skintone, undertone: classifyUndertone(hex, skintone) };
}

// All shades of one product (same order as given). Uses the range-relative rule when the product spans a full
// fair-to-deep range, otherwise the absolute rule. Invalid hex -> { skintone: "", undertone: "" }.
export function classifyShades(hexes) {
  const parsed = hexes.map((hex) => hexToHsb(hex));
  const Ls = parsed.filter(Boolean).map((p) => p.L);
  const lo = Math.min(...Ls), hi = Math.max(...Ls);
  const relative = Ls.length >= MIN_RANGE_SHADES && hi - lo >= MIN_RANGE_SPAN;
  return hexes.map((hex, i) => {
    const p = parsed[i];
    if (!p) return { skintone: "", undertone: "" };
    let skintone;
    if (relative) {
      const score = 0.75 * 100 * ((p.L - lo) / (hi - lo)) + 0.25 * p.L;
      skintone = (RELATIVE_TONE_CUTOFFS.find(([, min]) => score >= min) || ["VD"])[0];
    } else {
      skintone = classifySkinTone(hex);
    }
    return { skintone, undertone: classifyUndertone(hex, skintone) };
  });
}
