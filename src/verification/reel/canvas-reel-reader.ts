/**
 * Read visible reel symbols from the game canvas after spin settles.
 */

import type { PlaywrightGameDriver } from '../../driver/playwright-game-driver.js';
import { captureLocator } from '../../platform/stable-screenshot.js';
import {
  bestTemplateMatch,
  cropImage,
  decodePng,
  type RgbaImage,
} from './image-match.js';
import type { LoadedSymbolTemplate } from './symbol-catalog.js';
import type { NormalizedRect, ReelGrid, ReelValidationConfig } from './types.js';

export interface FrontendCellRead {
  readonly column: number;
  readonly row: number;
  readonly symbolId: number | undefined;
  readonly symbolName: string;
  readonly score: number;
}

export interface FrontendReelRead {
  readonly columns: number;
  readonly rows: number;
  readonly cells: ReadonlyArray<ReadonlyArray<FrontendCellRead>>;
  readonly canvasPng: Buffer;
}

function nameFor(
  templates: readonly LoadedSymbolTemplate[],
  id: number | undefined,
  fallbackSymbols?: ReelGrid['cells'],
): string {
  if (id === undefined) {
    return 'UNKNOWN';
  }
  const fromTemplate = templates.find((entry) => entry.id === id)?.name;
  if (fromTemplate !== undefined) {
    return fromTemplate;
  }
  if (fallbackSymbols !== undefined) {
    for (const column of fallbackSymbols) {
      for (const cell of column) {
        if (cell.symbolId === id) {
          return cell.symbolName;
        }
      }
    }
  }
  return `Symbol(${id})`;
}

export function cellRect(
  reelRegion: NormalizedRect,
  columns: number,
  rows: number,
  columnIndex: number,
  rowIndex: number,
  inset: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number; width: number; height: number } {
  const boardX = reelRegion.x * canvasWidth;
  const boardY = reelRegion.y * canvasHeight;
  const boardW = reelRegion.width * canvasWidth;
  const boardH = reelRegion.height * canvasHeight;
  const cellW = boardW / columns;
  const cellH = boardH / rows;
  const padX = cellW * inset;
  const padY = cellH * inset;
  return {
    x: boardX + columnIndex * cellW + padX,
    y: boardY + rowIndex * cellH + padY,
    width: Math.max(2, cellW - padX * 2),
    height: Math.max(2, cellH - padY * 2),
  };
}

export async function captureCanvasRgba(
  driver: PlaywrightGameDriver,
): Promise<{ image: RgbaImage; png: Buffer }> {
  const canvas = driver.gameCanvas();
  await canvas.waitFor({ state: 'visible' });
  const png = await captureLocator(canvas, { label: 'reel check' });
  return { image: decodePng(png), png };
}

/**
 * Build symbol templates from the live canvas using backend Column/Row labels.
 * Keeps multiple crops per id (all occurrences) so matcher is not limited to one sample.
 */
export function learnLiveSymbolTemplates(options: {
  readonly canvasImage: RgbaImage;
  readonly backendGrid: ReelGrid;
  readonly config: ReelValidationConfig;
}): LoadedSymbolTemplate[] {
  const { canvasImage, backendGrid, config } = options;
  const inset = config.cellInset ?? 0.12;
  const templates: LoadedSymbolTemplate[] = [];

  for (let col = 0; col < backendGrid.columns; col += 1) {
    for (let row = 0; row < backendGrid.rows; row += 1) {
      const cell = backendGrid.cells[col]![row]!;
      const rect = cellRect(
        config.reelRegion,
        backendGrid.columns,
        backendGrid.rows,
        col,
        row,
        inset,
        canvasImage.width,
        canvasImage.height,
      );
      const crop = cropImage(canvasImage, rect.x, rect.y, rect.width, rect.height);
      templates.push({
        id: cell.symbolId,
        name: cell.symbolName,
        image: crop,
      });
    }
  }

  return templates;
}

/**
 * Identify every visible cell using templates (Help/Payout and/or live-learned).
 * Grid size comes from the backend reel grid (dynamic).
 */
export async function readFrontendReelGrid(options: {
  readonly driver: PlaywrightGameDriver;
  readonly backendGrid: Pick<ReelGrid, 'columns' | 'rows'> & {
    readonly cells?: ReelGrid['cells'];
  };
  readonly config: ReelValidationConfig;
  readonly templates: readonly LoadedSymbolTemplate[];
  readonly canvasImage?: RgbaImage;
  readonly canvasPng?: Buffer;
}): Promise<FrontendReelRead> {
  const { driver, backendGrid, config, templates } = options;
  const threshold = config.matchThreshold ?? 0.35;
  const inset = config.cellInset ?? 0.12;

  const captured =
    options.canvasImage !== undefined && options.canvasPng !== undefined
      ? { image: options.canvasImage, png: options.canvasPng }
      : await captureCanvasRgba(driver);

  const { columns, rows } = backendGrid;
  const cells: FrontendCellRead[][] = [];

  for (let col = 0; col < columns; col += 1) {
    const columnCells: FrontendCellRead[] = [];
    for (let row = 0; row < rows; row += 1) {
      const rect = cellRect(
        config.reelRegion,
        columns,
        rows,
        col,
        row,
        inset,
        captured.image.width,
        captured.image.height,
      );
      const crop = cropImage(captured.image, rect.x, rect.y, rect.width, rect.height);
      const match = bestTemplateMatch(
        crop,
        templates.map((entry) => ({ id: entry.id, image: entry.image })),
      );
      const accepted =
        match !== undefined && match.score >= threshold ? match.id : undefined;
      columnCells.push({
        column: col + 1,
        row: row + 1,
        symbolId: accepted,
        symbolName: nameFor(templates, accepted, backendGrid.cells),
        score: match?.score ?? 0,
      });
    }
    cells.push(columnCells);
  }

  return {
    columns,
    rows,
    cells,
    canvasPng: captured.png,
  };
}
