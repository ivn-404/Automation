/**
 * Print the colour-blob scan for a PNG so manifest ratios can be checked against
 * what the game actually draws.
 *
 * Usage: node dist/eye/scan-controls-cli.js <png> [--crop x0,y0,x1,y1]
 * Crop bounds are 0–1 ratios of the source image, used to strip host chrome so
 * the reported ratios line up with canvas action ratios.
 */

import { readFileSync } from 'node:fs';

import { cropImage, decodePng, encodePng } from '../verification/reel/image-match.js';
import { scanControls, type ControlHue } from './canvas-vision.js';

function parseCrop(raw: string | undefined): readonly number[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const parts = raw.split(',').map(Number);
  return parts.length === 4 && parts.every((value) => Number.isFinite(value)) ? parts : undefined;
}

function main(): void {
  const [file, ...rest] = process.argv.slice(2);
  if (file === undefined) {
    console.error('usage: scan-controls-cli <png> [--crop x0,y0,x1,y1]');
    process.exitCode = 1;
    return;
  }

  const cropIndex = rest.indexOf('--crop');
  const crop = parseCrop(cropIndex >= 0 ? rest[cropIndex + 1] : undefined);

  let image = decodePng(readFileSync(file));
  if (crop !== undefined) {
    const [x0, y0, x1, y1] = crop as [number, number, number, number];
    image = cropImage(
      image,
      x0 * image.width,
      y0 * image.height,
      (x1 - x0) * image.width,
      (y1 - y0) * image.height,
    );
    console.log(`cropped to ${image.width}x${image.height}`);
    encodePng(image);
  }

  console.log(`image ${image.width}x${image.height}`);
  for (const hue of ['green', 'red', 'amber'] as readonly ControlHue[]) {
    const found = scanControls(image, hue).slice(0, 8);
    console.log(`\n[${hue}] ${found.length} blob(s)`);
    for (const control of found) {
      console.log(
        `  center=${control.center.x.toFixed(3)},${control.center.y.toFixed(3)}` +
          `  area=${(control.areaRatio * 100).toFixed(2)}%` +
          `  fill=${control.fill.toFixed(2)}` +
          `  box=${control.box.x0.toFixed(2)},${control.box.y0.toFixed(2)}` +
          `-${control.box.x1.toFixed(2)},${control.box.y1.toFixed(2)}`,
      );
    }
  }
}

main();
