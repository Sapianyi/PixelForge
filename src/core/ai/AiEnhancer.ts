// src/core/ai/AiEnhancer.ts

export class AiEnhancer {
  /**
   * Інтелектуальний підсилювач контрасту та насиченості під MIP-дисплеї.
   * Працює на базі адаптивного розтягування гістограми
   */
  public enhance(imageData: ImageData): ImageData {
    const { width, height, data } = imageData;
    const outputImageData = new ImageData(
      new Uint8ClampedArray(data),
      width,
      height,
    );
    const outData = outputImageData.data;

    let minR = 255,
      maxR = 0;
    let minG = 255,
      maxG = 0;
    let minB = 255,
      maxB = 0;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      if (data[i] < minR) minR = data[i];
      if (data[i] > maxR) maxR = data[i];
      if (data[i + 1] < minG) minG = data[i + 1];
      if (data[i + 1] > maxG) maxG = data[i + 1];
      if (data[i + 2] < minB) minB = data[i + 2];
      if (data[i + 2] > maxB) maxB = data[i + 2];
    }

    if (maxR === minR) {
      maxR = 255;
      minR = 0;
    }
    if (maxG === minG) {
      maxG = 255;
      minG = 0;
    }
    if (maxB === minB) {
      maxB = 255;
      minB = 0;
    }

    const saturationFactor = 1.35;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;

      let r = ((data[i] - minR) / (maxR - minR)) * 255;
      let g = ((data[i + 1] - minG) / (maxG - minG)) * 255;
      let b = ((data[i + 2] - minB) / (maxB - minB)) * 255;

      const luma = 0.299 * r + 0.587 * g + 0.114 * b;

      r = luma + (r - luma) * saturationFactor;
      g = luma + (g - luma) * saturationFactor;
      b = luma + (b - luma) * saturationFactor;

      outData[i] = Math.max(0, Math.min(255, r));
      outData[i + 1] = Math.max(0, Math.min(255, g));
      outData[i + 2] = Math.max(0, Math.min(255, b));
    }

    return outputImageData;
  }
}
