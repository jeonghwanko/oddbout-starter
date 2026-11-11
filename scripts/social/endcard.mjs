// @ts-check
// The export's ODDBOUT marks: a small corner mark on every frame and the end card a showcase closes on (the front painting, the fighter's
// name, his faces and oddbout.com). Drawn as SVG through sharp with the system's fonts; the name is the package's own.
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

const FONTS = "'Pretendard', 'Noto Sans KR', 'Noto Sans CJK KR', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

/** @param {string} text */
const xml = text => text.replace(/[<>&'"]/g, c => /** @type {Record<string, string>} */ ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

/**
 * Whether this host's fonts can draw the name. Windows and macOS ship Korean, Japanese and Chinese fonts; a Linux host (a Dots VM) often
 * has none, and the card would show empty boxes. Asks fontconfig for each character outside ASCII; null when the name draws or when there
 * is nothing to ask, else the warning to report.
 * @param {string} name @param {NodeJS.Platform} [platform]
 */
export function nameFontWarning(name, platform = process.platform) {
  if (platform === 'win32' || platform === 'darwin') return null;
  const wide = [...new Set([...name].filter(c => (c.codePointAt(0) ?? 0) > 0x7f && /\p{L}/u.test(c)))];
  if (!wide.length) return null;
  const missing = wide.filter(c => {
    const found = spawnSync('fc-list', [`:charset=${(c.codePointAt(0) ?? 0).toString(16)}`, 'family'], { encoding: 'utf8' });
    return found.status !== 0 || !found.stdout.trim();
  });
  return missing.length
    ? { code: 'NAME_FONT_MISSING', detail: `No font here draws ${missing.join('')}: the end card's name shows as boxes. Install fonts-noto-cjk, or export with --no-endcard.` }
    : null;
}

/**
 * How many em a name takes in a bold sans: Hangul, kana and CJK about one em each, a space a third, Latin and digits about 0.62.
 * @param {string} name
 */
export function nameEms(name) {
  let ems = 0;
  for (const c of name) {
    const code = c.codePointAt(0) ?? 0;
    ems += c === ' ' ? 0.33 : code >= 0x1100 ? 1.02 : 0.62;
  }
  return Math.max(2, ems);
}

/** Whether a background colour is dark, for the text on it. @param {{ r: number, g: number, b: number }} colour */
export const isDark = ({ r, g, b }) => 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;

/** The corner mark as a transparent PNG the size of the canvas. @param {number} width @param {number} height @param {{ r: number, g: number, b: number }} background */
export function cornerMark(width, height, background) {
  const size = Math.max(12, Math.round(Math.min(width, height) * 0.032));
  const ink = isDark(background) ? 'rgba(255,255,255,0.55)' : 'rgba(20,22,28,0.45)';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${width - size}" y="${height - size}" text-anchor="end" font-family="${FONTS}" font-size="${size}" font-weight="800" letter-spacing="${size * 0.12}" fill="${ink}">ODDBOUT</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * The end card as RGB pixels: the front painting at the left, the name and faces at the right, oddbout.com under them.
 * @param {{ width: number, height: number, background: { r: number, g: number, b: number }, name: string, front?: Buffer | null, faces?: Buffer[] }} card
 * @returns {Promise<Buffer>}
 */
export async function endCard({ width, height, background, name, front = null, faces = [] }) {
  const dark = isDark(background);
  const ink = dark ? '#f4f5f8' : '#15171c',
    soft = dark ? 'rgba(244,245,248,0.7)' : 'rgba(21,23,28,0.62)';
  /** @type {import('sharp').OverlayOptions[]} */
  const layers = [];
  const pad = Math.round(Math.min(width, height) * 0.06);
  let textLeft = pad;
  if (front) {
    const frontHeight = Math.round(height - pad * 2);
    const picture = await sharp(front).resize({ height: frontHeight, width: Math.round(width * 0.46), fit: 'inside' }).png().toBuffer();
    const meta = await sharp(picture).metadata();
    layers.push({ input: picture, left: pad, top: Math.round((height - (meta.height ?? frontHeight)) / 2) });
    textLeft = pad + (meta.width ?? 0) + pad;
  }
  const textWidth = width - textLeft - pad;
  const nameSize = Math.max(14, Math.min(Math.round(height * 0.11), Math.floor(textWidth / nameEms(name))));
  const faceSide = Math.max(16, Math.min(Math.round(height * 0.14), Math.floor((textWidth - pad * 0.2 * 5) / 3)));
  const shown = faces.slice(0, 6);
  const rows = shown.length > 3 ? 2 : shown.length ? 1 : 0;
  // "made in ODDBOUT" is the longer line: about 9 em wide in a bold sans.
  const small = Math.max(10, Math.min(Math.round(height * 0.042), Math.floor(textWidth / 9)));
  const block = nameSize * 1.3 + rows * (faceSide + pad * 0.25) + small * 3;
  const top = Math.round((height - block) / 2);
  const under = Math.round(top + nameSize * 1.3 + rows * (faceSide + pad * 0.25) + small * 1.4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<text x="${textLeft}" y="${top + nameSize}" font-family="${FONTS}" font-size="${nameSize}" font-weight="800" fill="${ink}">${xml(name)}</text>
<text x="${textLeft}" y="${under}" font-family="${FONTS}" font-size="${small}" font-weight="700" fill="${soft}">made in ODDBOUT</text>
<text x="${textLeft}" y="${Math.round(under + small * 1.35)}" font-family="${FONTS}" font-size="${small}" font-weight="800" fill="${ink}">oddbout.com</text>
</svg>`;
  layers.push({ input: Buffer.from(svg), left: 0, top: 0 });
  const round = Buffer.from(`<svg width="${faceSide}" height="${faceSide}"><circle cx="${faceSide / 2}" cy="${faceSide / 2}" r="${faceSide / 2}"/></svg>`);
  for (const [i, face] of shown.entries()) {
    const disc = await sharp(face)
      .resize({ width: faceSide, height: faceSide, fit: 'cover' })
      .flatten({ background: dark ? '#2a2d36' : '#ffffff' })
      .composite([{ input: round, blend: 'dest-in' }])
      .png()
      .toBuffer();
    layers.push({
      input: disc,
      left: Math.round(textLeft + (i % 3) * (faceSide + pad * 0.2)),
      top: Math.round(top + nameSize * 1.3 + Math.floor(i / 3) * (faceSide + pad * 0.25)),
    });
  }
  return sharp({ create: { width, height, channels: 3, background } }).composite(layers).removeAlpha().raw().toBuffer();
}
