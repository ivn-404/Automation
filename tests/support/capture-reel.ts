/**
 * Rolling canvas capture — last N seconds of JPEG frames, dumped as a replayable clip.
 *
 * Parallel Playwright video is off (it corrupts under 4 headed lanes). This buffer
 * lives in memory and is written only when a hunt scenario completes.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import type { Locator } from '@playwright/test';

export interface CaptureFrame {
  readonly at: number;
  readonly jpeg: Buffer;
}

export interface CaptureReelOptions {
  readonly seconds?: number;
  readonly fps?: number;
  readonly quality?: number;
}

export interface DumpedClip {
  readonly dir: string;
  readonly stillPath: string;
  readonly replayPath: string;
  readonly webmPath?: string;
  readonly frameCount: number;
}

function dataUrlToJpeg(dataUrl: string): Buffer | undefined {
  const match = /^data:image\/jpeg;base64,(.+)$/u.exec(dataUrl);
  if (match === undefined || match[1] === undefined) {
    return undefined;
  }
  return Buffer.from(match[1], 'base64');
}

export class CaptureReel {
  private readonly canvas: Locator;
  private readonly seconds: number;
  private readonly intervalMs: number;
  private readonly quality: number;
  private readonly frames: CaptureFrame[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private grabbing = false;

  constructor(canvas: Locator, options?: CaptureReelOptions) {
    this.canvas = canvas;
    this.seconds = options?.seconds ?? 40;
    this.intervalMs = Math.max(80, Math.round(1000 / (options?.fps ?? 5)));
    this.quality = options?.quality ?? 0.5;
  }

  start(): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private maxFrames(): number {
    return Math.max(1, Math.round((this.seconds * 1000) / this.intervalMs));
  }

  private async tick(): Promise<void> {
    if (this.grabbing) {
      return;
    }
    this.grabbing = true;
    try {
      const quality = this.quality;
      const dataUrl = await this.canvas.evaluate((node, q) => {
        const canvas = node instanceof HTMLCanvasElement ? node : node.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 8 || canvas.height < 8) {
          return '';
        }
        return canvas.toDataURL('image/jpeg', q);
      }, quality);
      const jpeg = dataUrlToJpeg(dataUrl);
      if (jpeg === undefined) {
        return;
      }
      this.frames.push({ at: Date.now(), jpeg });
      const overflow = this.frames.length - this.maxFrames();
      if (overflow > 0) {
        this.frames.splice(0, overflow);
      }
    } catch {
      // Frame drops are fine; the ring keeps going.
    } finally {
      this.grabbing = false;
    }
  }

  async dump(dir: string, still?: Buffer): Promise<DumpedClip> {
    mkdirSync(path.join(dir, 'frames'), { recursive: true });
    const stillPath = path.join(dir, 'still.jpg');
    const last = this.frames[this.frames.length - 1]?.jpeg;
    writeFileSync(stillPath, still ?? last ?? Buffer.alloc(0));

    const names: string[] = [];
    this.frames.forEach((frame, index) => {
      const name = `frames/${String(index + 1).padStart(4, '0')}.jpg`;
      writeFileSync(path.join(dir, name), frame.jpeg);
      names.push(name);
    });

    const replayPath = path.join(dir, 'replay.html');
    const fps = Math.round(1000 / this.intervalMs);
    writeFileSync(
      replayPath,
      `<!doctype html>
<meta charset="utf-8">
<title>SGAP 40s capture replay</title>
<style>
  body { margin: 0; background: #111; color: #eee; font: 14px/1.4 sans-serif; }
  img { display: block; width: min(100vw, 390px); margin: 0 auto; background: #000; }
  #bar { padding: 8px 12px; }
</style>
<p id="bar">Replay ${this.seconds}s · <span id="n">0</span>/${names.length} · ${fps} fps</p>
<img id="v" alt="capture">
<script>
const frames = ${JSON.stringify(names)};
const fps = ${fps};
const img = document.getElementById('v');
const n = document.getElementById('n');
let i = 0;
function tick() {
  if (frames.length === 0) return;
  img.src = frames[i];
  n.textContent = String(i + 1);
  i = (i + 1) % frames.length;
}
tick();
setInterval(tick, Math.round(1000 / fps));
</script>
`,
    );

    let webmPath: string | undefined;
    const ffmpeg = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-framerate',
        String(fps),
        '-i',
        path.join(dir, 'frames', '%04d.jpg'),
        '-c:v',
        'libvpx-vp9',
        '-pix_fmt',
        'yuv420p',
        '-an',
        path.join(dir, 'clip.webm'),
      ],
      { encoding: 'utf8' },
    );
    if (ffmpeg.status === 0) {
      webmPath = path.join(dir, 'clip.webm');
    }

    return {
      dir,
      stillPath,
      replayPath,
      webmPath,
      frameCount: this.frames.length,
    };
  }
}
