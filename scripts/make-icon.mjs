import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PATH = path.join(root, 'artwork', 'comgu-logo.jpg');
const ICO_SIZES = [256, 128, 64, 48, 32, 16];
const EXTENSION_SIZES = [128, 48, 32, 16];

async function pngFor(size) {
  return sharp(SOURCE_PATH)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

mkdirSync(path.join(root, 'build'), { recursive: true });
const icoImages = [];
for (const size of ICO_SIZES) icoImages.push({ size, png: await pngFor(size) });
writeFileSync(path.join(root, 'build', 'icon.ico'), encodeIco(icoImages));
writeFileSync(path.join(root, 'build', 'icon.png'), await pngFor(1024));
writeFileSync(path.join(root, 'build', 'icon-preview.png'), await pngFor(256));
writeFileSync(path.join(root, 'build', 'runtime-icon.png'), await pngFor(256));

const iconsDir = path.join(root, 'extension', 'icons');
mkdirSync(iconsDir, { recursive: true });
for (const size of EXTENSION_SIZES) writeFileSync(path.join(iconsDir, `icon${size}.png`), await pngFor(size));

console.log(`Wrote ComGu icons from artwork/comgu-logo.jpg (${ICO_SIZES.join(', ')} ICO; ${EXTENSION_SIZES.join(', ')} extension).`);
