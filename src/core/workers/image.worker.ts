// src/core/workers/image.worker.ts

export type RgbColor = [number, number, number];

export interface ProcessImagePayload {
  imageData: ImageData;
  palette: RgbColor[];
  applyDithering: boolean;
}

function findNearestColor(
  r: number,
  g: number,
  b: number,
  palette: RgbColor[],
): RgbColor {
  let minDistanceSq = Infinity;
  let bestMatch = palette[0];
  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = palette[i];
    const dr = r - pr;
    const dg = g - pg;
    const db = b - pb;
    const distanceSq = dr * dr + dg * dg + db * db;
    if (distanceSq < minDistanceSq) {
      minDistanceSq = distanceSq;
      bestMatch = palette[i];
    }
  }
  return bestMatch;
}

function applyQuantization(
  imageData: ImageData,
  palette: RgbColor[],
  useDithering: boolean,
): ImageData {
  const width = imageData.width;
  const height = imageData.height;
  const data = new Uint8ClampedArray(imageData.data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const oldR = data[index];
      const oldG = data[index + 1];
      const oldB = data[index + 2];
      if (data[index + 3] === 0) continue;

      const [newR, newG, newB] = findNearestColor(oldR, oldG, oldB, palette);
      data[index] = newR;
      data[index + 1] = newG;
      data[index + 2] = newB;

      if (useDithering) {
        const errR = oldR - newR;
        const errG = oldG - newG;
        const errB = oldB - newB;
        const distributeError = (
          offsetX: number,
          offsetY: number,
          factor: number,
        ) => {
          const targetX = x + offsetX;
          const targetY = y + offsetY;
          if (targetX >= 0 && targetX < width && targetY < height) {
            const errIndex = (targetY * width + targetX) * 4;
            if (data[errIndex + 3] === 0) return;
            data[errIndex] += errR * factor;
            data[errIndex + 1] += errG * factor;
            data[errIndex + 2] += errB * factor;
          }
        };
        distributeError(1, 0, 7 / 16);
        distributeError(-1, 1, 3 / 16);
        distributeError(0, 1, 5 / 16);
        distributeError(1, 1, 1 / 16);
      }
    }
  }
  return new ImageData(data, width, height);
}

self.addEventListener("message", (e: MessageEvent<ProcessImagePayload>) => {
  try {
    const resultImageData = applyQuantization(
      e.data.imageData,
      e.data.palette,
      e.data.applyDithering,
    );
    self.postMessage(
      { result: resultImageData },
      { transfer: [resultImageData.data.buffer] },
    );
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
});
