// src/main.ts
import type { ProcessImagePayload } from "./core/workers/image.worker";
import type {
  SpriteInput,
  PackResult,
  PackedSprite,
} from "./core/workers/pack.worker";
import { HistoryManager } from "./core/state/HistoryManager";
import Pica from "pica";
import { AiEnhancer } from "./core/ai/AiEnhancer";
import { QoiEncoder } from "./core/formats/QoiEncoder";
import opentype from "opentype.js";

// Ініціалізуємо Pica з пріоритетом на WebAssembly
// @ts-ignore
const pica = new (Pica as any)({ features: ["js", "wasm"] });

// Офіційна 16-колірна палітра Garmin Memory-in-Pixel (MIP)
const GARMIN_MIP_PALETTE: [number, number, number][] = [
  [0, 0, 0],
  [255, 255, 255],
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [255, 0, 255],
  [0, 255, 255],
  [170, 170, 170],
  [85, 85, 85],
  [170, 0, 0],
  [0, 170, 0],
  [0, 0, 170],
  [255, 170, 0],
  [170, 255, 170],
  [0, 170, 255],
];

// --- ЕЛЕМЕНТИ ІНТЕРФЕЙСУ (МОДУЛЬ 1) ---
const progressBar = document.getElementById(
  "progressBar",
) as HTMLProgressElement;
const uploadInput = document.getElementById("upload") as HTMLInputElement;
const resizeW = document.getElementById("resizeW") as HTMLInputElement;
const resizeH = document.getElementById("resizeH") as HTMLInputElement;
const resizeMode = document.getElementById("resizeMode") as HTMLSelectElement;
const resizeBtn = document.getElementById("resizeBtn") as HTMLButtonElement;
const ditherCheckbox = document.getElementById("dither") as HTMLInputElement;
const processBtn = document.getElementById("processBtn") as HTMLButtonElement;
const statusText = document.getElementById("status") as HTMLSpanElement;
const aiBoostBtn = document.getElementById("aiBoostBtn") as HTMLButtonElement;

const sourceCanvas = document.getElementById(
  "sourceCanvas",
) as HTMLCanvasElement;
const outputCanvas = document.getElementById(
  "outputCanvas",
) as HTMLCanvasElement;
const ctxSource = sourceCanvas.getContext("2d", { willReadFrequently: true })!;
const ctxOutput = outputCanvas.getContext("2d")!;

// --- ЕЛЕМЕНТИ ІНТЕРФЕЙСУ (МОДУЛЬ 2) ---
const exportCBtn = document.getElementById("exportCBtn") as HTMLButtonElement;
const cCodeOutput = document.getElementById(
  "cCodeOutput",
) as HTMLTextAreaElement;
const exportQoiBtn = document.getElementById(
  "exportQoiBtn",
) as HTMLButtonElement;
const exportAvifBtn = document.getElementById(
  "exportAvifBtn",
) as HTMLButtonElement;
const exportBitDepth = document.getElementById(
  "exportBitDepth",
) as HTMLSelectElement;

// --- ЕЛЕМЕНТИ ІНТЕРФЕЙСУ (МОДУЛЬ 4) ---
const spriteUpload = document.getElementById(
  "spriteUpload",
) as HTMLInputElement;
const packPadding = document.getElementById("packPadding") as HTMLInputElement;
const packBtn = document.getElementById("packBtn") as HTMLButtonElement;
const atlasCanvas = document.getElementById("atlasCanvas") as HTMLCanvasElement;
const previewCanvas = document.getElementById(
  "previewCanvas",
) as HTMLCanvasElement;
const fpsSlider = document.getElementById("fpsSlider") as HTMLInputElement;
const fpsValue = document.getElementById("fpsValue") as HTMLSpanElement;
const atlasJsonOutput = document.getElementById(
  "atlasJsonOutput",
) as HTMLTextAreaElement;
const atlasCodeOutput = document.getElementById(
  "atlasCodeOutput",
) as HTMLTextAreaElement;

const ctxAtlas = atlasCanvas.getContext("2d")!;
const ctxPreview = previewCanvas.getContext("2d")!;

// --- ЕЛЕМЕНТИ ІНТЕРФЕЙСУ (МОДУЛЬ 5) ---
const fontUpload = document.getElementById("fontUpload") as HTMLInputElement;
const fontSizeInput = document.getElementById("fontSize") as HTMLInputElement;
const generateFontBtn = document.getElementById(
  "generateFontBtn",
) as HTMLButtonElement;
const fontCodeOutput = document.getElementById(
  "fontCodeOutput",
) as HTMLTextAreaElement;

// --- ЕЛЕМЕНТИ ІНТЕРФЕЙСУ (МОДУЛЬ 6) ---
const generatePipelineBtn = document.getElementById(
  "generatePipelineBtn",
) as HTMLButtonElement;
const nodeScriptOutput = document.getElementById(
  "nodeScriptOutput",
) as HTMLTextAreaElement;
const githubActionOutput = document.getElementById(
  "githubActionOutput",
) as HTMLTextAreaElement;

// --- ЕЛЕМЕНТИ ІНТЕРФЕЙСУ (МОДУЛЬ TILEMAP) ---
const tileMapSizeSelect = document.getElementById(
  "tileMapSize",
) as HTMLSelectElement;
const generateTilemapBtn = document.getElementById(
  "generateTilemapBtn",
) as HTMLButtonElement;
const tilesetCanvas = document.getElementById(
  "tilesetCanvas",
) as HTMLCanvasElement;
const tilemapCodeOutput = document.getElementById(
  "tilemapCodeOutput",
) as HTMLTextAreaElement;
const ctxTileset = tilesetCanvas.getContext("2d")!;

// --- КОНСТАНТИ ТА СТАН СИСТЕМИ ---
const MAX_WIDTH = 4096;
const MAX_HEIGHT = 4096;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

const history = new HistoryManager();
const aiEnhancer = new AiEnhancer();

let activeSvgUrl: string | null = null;
let imageWorker: Worker | null = null;
let packWorker: Worker | null = null;

let loadedSpritesQueue: SpriteInput[] = [];
let animationFrames: PackedSprite[] = [];
let currentFrameIndex = 0;
let animationIntervalId: number | null = null;
let atlasImageElement: HTMLImageElement | null = null;
let loadedFontBuffer: ArrayBuffer | null = null;

// --- ДОПОМІЖНІ ФУНКЦІЇ ПРОГРЕСУ ---
function showProgress(current: number, total: number) {
  if (progressBar) {
    progressBar.style.display = "inline-block";
    progressBar.max = total;
    progressBar.value = current;
  }
}

function hideProgress() {
  if (progressBar) {
    progressBar.style.display = "none";
    progressBar.value = 0;
  }
}

// --- ЛОКАЛЬНЕ ЗБЕРЕЖЕННЯ НАЛАШТУВАНЬ (LOCAL STORAGE) ---
function loadSavedSettings() {
  const savedResizeMode = localStorage.getItem("lastResizeMode");
  const savedDither = localStorage.getItem("lastDither");
  const savedBitDepth = localStorage.getItem("lastExportBitDepth");

  if (savedResizeMode && resizeMode) resizeMode.value = savedResizeMode;
  if (savedDither && ditherCheckbox)
    ditherCheckbox.checked = savedDither === "true";
  if (savedBitDepth && exportBitDepth) exportBitDepth.value = savedBitDepth;
}

function setupSettingsAutosave() {
  resizeMode?.addEventListener("change", () =>
    localStorage.setItem("lastResizeMode", resizeMode.value),
  );
  ditherCheckbox?.addEventListener("change", () =>
    localStorage.setItem("lastDither", ditherCheckbox.checked.toString()),
  );
  exportBitDepth?.addEventListener("change", () =>
    localStorage.setItem("lastExportBitDepth", exportBitDepth.value),
  );
}

loadSavedSettings();
setupSettingsAutosave();

// --- СИСТЕМНІ ХОТ-РЕСТАРТИ ВОРКЕРІВ (ЗАХИСТ RACE CONDITION) ---
function initImageWorker() {
  if (imageWorker) imageWorker.terminate();
  imageWorker = new Worker(
    new URL("./core/workers/image.worker.ts", import.meta.url),
    { type: "module" },
  );

  imageWorker.addEventListener("message", async (e) => {
    if (e.data.result) {
      const resultImageData = e.data.result as ImageData;
      ctxOutput.putImageData(resultImageData, 0, 0);
      ctxSource.putImageData(resultImageData, 0, 0);
      await history.saveState(resultImageData);
      statusText.innerText = "Quantization done!";
      statusText.style.color = "#39ff14";
    }
    hideProgress();
    processBtn.disabled = false;
  });
}

function initPackWorker() {
  if (packWorker) packWorker.terminate();
  packWorker = new Worker(
    new URL("./core/workers/pack.worker.ts", import.meta.url),
    { type: "module" },
  );

  packWorker.addEventListener("message", (e) => {
    packBtn.disabled = false;
    hideProgress();
    if (e.data.error) {
      statusText.innerText = `Packing Error: ${e.data.error}`;
      statusText.style.color = "#f85149";
      return;
    }

    const { atlasWidth, atlasHeight, sprites, atlasBuffer } =
      e.data as PackResult;
    atlasCanvas.width = atlasWidth;
    atlasCanvas.height = atlasHeight;

    const atlasImgData = new ImageData(
      new Uint8ClampedArray(atlasBuffer),
      atlasWidth,
      atlasHeight,
    );
    ctxAtlas.putImageData(atlasImgData, 0, 0);

    atlasImageElement = new Image();
    atlasImageElement.onload = () => {
      animationFrames = [...sprites].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      currentFrameIndex = 0;
      startAnimationLoop();
    };
    atlasImageElement.src = atlasCanvas.toDataURL();

    const jsonMeta: any = {
      frames: {},
      meta: {
        app: "PixelForge",
        version: "1.0.0",
        image: "atlas.png",
        format: "RGBA8888",
        size: { w: atlasWidth, h: atlasHeight },
      },
    };

    sprites.forEach((s) => {
      jsonMeta.frames[s.name] = {
        frame: { x: s.x, y: s.y, w: s.width, h: s.height },
        rotated: false,
        trimmed: s.trimmed,
        spriteSourceSize: { x: s.trimX, y: s.trimY, w: s.width, h: s.height },
        sourceSize: { w: s.sourceWidth, h: s.sourceHeight },
      };
    });

    atlasJsonOutput.value = JSON.stringify(jsonMeta, null, 2);

    try {
      const atlasCtxData = atlasImgData.data;
      const atlasIndices: number[] = [];

      for (let i = 0; i < atlasCtxData.length; i += 4) {
        const r = atlasCtxData[i];
        const g = atlasCtxData[i + 1];
        const b = atlasCtxData[i + 2];
        const alpha = atlasCtxData[i + 3];
        atlasIndices.push(alpha === 0 ? 0 : getPaletteIndex(r, g, b));
      }

      const packedAtlasBytes: string[] = [];
      for (let i = 0; i < atlasIndices.length; i += 2) {
        const pixel1 = atlasIndices[i];
        const pixel2 = i + 1 < atlasIndices.length ? atlasIndices[i + 1] : 0;
        const packedByte = (pixel1 << 4) | pixel2;
        packedAtlasBytes.push(
          `0x${packedByte.toString(16).toUpperCase().padStart(2, "0")}`,
        );
      }

      const cOffsets: number[] = [];
      sprites.forEach((s) => {
        cOffsets.push(Math.floor((s.y * atlasWidth + s.x) / 2));
      });

      let cAtlasCode = `// PixelForge Generated Sprite Sheet Atlas\n// Atlas Resolution: ${atlasWidth}x${atlasHeight} px\n// Total Packed Frames: ${sprites.length}\n// Format: 4-bit Packed Garmin MIP Palette (2 pixels per byte)\n\nconst uint8_t garmin_sprite_sheet[] = {\n    `;
      for (let i = 0; i < packedAtlasBytes.length; i++) {
        cAtlasCode += packedAtlasBytes[i];
        if (i < packedAtlasBytes.length - 1) cAtlasCode += ", ";
        if ((i + 1) % 12 === 0 && i < packedAtlasBytes.length - 1)
          cAtlasCode += "\n    ";
      }
      cAtlasCode += `\n};\n\n// Frame Look-Up Table\nconst uint32_t garmin_sprite_offsets[${cOffsets.length}] = {\n    ${cOffsets.join(", ")}\n};`;

      if (atlasCodeOutput) atlasCodeOutput.value = cAtlasCode;
    } catch (cExportError) {
      console.error("Garmin C-Export failed:", cExportError);
    }

    statusText.innerText = `Atlas compiled: ${atlasWidth}x${atlasHeight}px. C-Arrays generated!`;
    statusText.style.color = "#3fb950";
  });
}

function getPaletteIndex(r: number, g: number, b: number): number {
  for (let i = 0; i < GARMIN_MIP_PALETTE.length; i++) {
    const color = GARMIN_MIP_PALETTE[i];
    if (color[0] === r && color[1] === g && color[2] === b) return i;
  }
  return 0;
}

// Старт системних воркерів
initImageWorker();
initPackWorker();

function restoreCanvasState(imageData: ImageData | null) {
  if (!imageData) return;
  sourceCanvas.width = imageData.width;
  sourceCanvas.height = imageData.height;
  outputCanvas.width = imageData.width;
  outputCanvas.height = imageData.height;
  ctxSource.putImageData(imageData, 0, 0);
  ctxOutput.putImageData(imageData, 0, 0);
  resizeW.value = imageData.width.toString();
  resizeH.value = imageData.height.toString();
  statusText.innerText = "History state restored.";
  statusText.style.color = "#58a6ff";
}

// --- СЛУХАЧІ ПОДІЙ МОДУЛЯ 1 ---
aiBoostBtn.addEventListener("click", async () => {
  if (sourceCanvas.width === 0) return alert("Upload image first");
  statusText.innerText = "Optimizing contrast for hardware display...";
  aiBoostBtn.disabled = true;
  try {
    const currentData = ctxSource.getImageData(
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height,
    );
    const enhancedData = aiEnhancer.enhance(currentData);
    ctxSource.putImageData(enhancedData, 0, 0);
    ctxOutput.putImageData(enhancedData, 0, 0);
    await history.saveState(enhancedData);
    statusText.innerText = "Contrast Boost Applied!";
    statusText.style.color = "#39ff14";
  } catch (err) {
    statusText.innerText = `Error: ${(err as Error).message}`;
    statusText.style.color = "#f85149";
  } finally {
    aiBoostBtn.disabled = false;
  }
});

uploadInput.addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  if (file.size > MAX_FILE_SIZE) {
    alert(
      `File is too heavy! Max allowed size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
    );
    uploadInput.value = "";
    return;
  }
  statusText.innerText = "Loading file buffer...";

  if (file.type === "image/svg+xml") {
    if (activeSvgUrl) URL.revokeObjectURL(activeSvgUrl);
    activeSvgUrl = URL.createObjectURL(file);

    const img = new Image();
    img.onload = async () => {
      if (img.width > MAX_WIDTH || img.height > MAX_HEIGHT) {
        alert(
          `Vector canvas coordinates are too large! Max allowed: ${MAX_WIDTH}x${MAX_HEIGHT}px.`,
        );
        uploadInput.value = "";
        activeSvgUrl = "";
        return;
      }
      sourceCanvas.width = img.width;
      sourceCanvas.height = img.height;
      outputCanvas.width = img.width;
      outputCanvas.height = img.height;
      ctxSource.drawImage(img, 0, 0);
      ctxOutput.drawImage(img, 0, 0);

      const currentData = ctxSource.getImageData(0, 0, img.width, img.height);
      await history.saveState(currentData);
      statusText.innerText = `SVG Source ready: ${img.width}x${img.height}px`;
      statusText.style.color = "#00f0ff";
    };
    img.src = activeSvgUrl;
  } else {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = async () => {
        if (img.width > MAX_WIDTH || img.height > MAX_HEIGHT) {
          alert(
            `Image dimensions are too large! Max allowed: ${MAX_WIDTH}x${MAX_HEIGHT}px.`,
          );
          uploadInput.value = "";
          return;
        }
        sourceCanvas.width = img.width;
        sourceCanvas.height = img.height;
        outputCanvas.width = img.width;
        outputCanvas.height = img.height;
        ctxSource.drawImage(img, 0, 0);
        ctxOutput.drawImage(img, 0, 0);

        const currentData = ctxSource.getImageData(0, 0, img.width, img.height);
        await history.saveState(currentData);
        statusText.innerText = `Texture loaded: ${img.width}x${img.height}px`;
        statusText.style.color = "#39ff14";
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  }
});

resizeBtn.addEventListener("click", async () => {
  const targetW = parseInt(resizeW.value) || 0;
  const targetH = parseInt(resizeH.value) || 0;

  if (
    targetW <= 0 ||
    targetH <= 0 ||
    targetW > MAX_WIDTH ||
    targetH > MAX_HEIGHT
  ) {
    alert(
      `Please enter valid resolution parameters (Max ${MAX_WIDTH}x${MAX_HEIGHT}px).`,
    );
    return;
  }
  if (sourceCanvas.width === 0) return alert("Upload image first");

  statusText.innerText = "Resizing...";
  resizeBtn.disabled = true;

  if (activeSvgUrl) {
    const img = new Image();
    img.onload = async () => {
      sourceCanvas.width = targetW;
      sourceCanvas.height = targetH;
      outputCanvas.width = targetW;
      outputCanvas.height = targetH;
      ctxSource.imageSmoothingEnabled = true;
      ctxSource.imageSmoothingQuality = "high";
      ctxSource.drawImage(img, 0, 0, targetW, targetH);
      ctxOutput.drawImage(img, 0, 0, targetW, targetH);

      const newData = ctxSource.getImageData(0, 0, targetW, targetH);
      await history.saveState(newData);
      statusText.innerText = "SVG re-rendered perfectly sharp.";
      statusText.style.color = "#3fb950";
      resizeBtn.disabled = false;
    };
    img.src = activeSvgUrl;
    return;
  }

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = targetW;
  tempCanvas.height = targetH;
  const tempCtx = tempCanvas.getContext("2d")!;

  if (resizeMode.value === "nearest") {
    tempCtx.imageSmoothingEnabled = false;
    tempCtx.drawImage(sourceCanvas, 0, 0, targetW, targetH);
  } else {
    await pica.resize(sourceCanvas, tempCanvas);
  }

  sourceCanvas.width = targetW;
  sourceCanvas.height = targetH;
  outputCanvas.width = targetW;
  outputCanvas.height = targetH;
  ctxSource.drawImage(tempCanvas, 0, 0);
  ctxOutput.drawImage(tempCanvas, 0, 0);

  const newData = ctxSource.getImageData(0, 0, targetW, targetH);
  await history.saveState(newData);
  statusText.innerText = "Raster resized successfully.";
  statusText.style.color = "#3fb950";
  resizeBtn.disabled = false;
});

processBtn.addEventListener("click", () => {
  if (sourceCanvas.width === 0) return;
  statusText.innerText = "Quantizing (Thread safe)...";
  initImageWorker();
  processBtn.disabled = true;

  progressBar.removeAttribute("value");
  progressBar.style.display = "inline-block";

  const imageData = ctxSource.getImageData(
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  const payload: ProcessImagePayload = {
    imageData,
    palette: GARMIN_MIP_PALETTE,
    applyDithering: ditherCheckbox.checked,
  };
  imageWorker!.postMessage(payload);
});

// --- СИСТЕМНІ ГАРЯЧІ КЛАВІШІ (KEYBOARD SHORTCUTS) ---
window.addEventListener("keydown", async (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

  if (e.ctrlKey && e.key.toLowerCase() === "z" && !e.shiftKey) {
    e.preventDefault();
    restoreCanvasState(await history.undo());
  }
  if (
    (e.ctrlKey && e.key.toLowerCase() === "y") ||
    (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "z")
  ) {
    e.preventDefault();
    restoreCanvasState(await history.redo());
  }
  if (e.ctrlKey && e.key.toLowerCase() === "e") {
    e.preventDefault();
    if (exportCBtn) {
      exportCBtn.click();
      cCodeOutput?.scrollIntoView({ behavior: "smooth", block: "center" });
      cCodeOutput?.focus();
    }
  }
  if (e.ctrlKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (outputCanvas.width === 0)
      return alert(
        "Nothing to save. Please upload and process an image first.",
      );
    statusText.innerText = "Exporting PNG asset...";
    const dataUrl = outputCanvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "pixelforge_output.png";
    a.click();
    statusText.innerText = "PNG Asset saved via hotkey!";
    statusText.style.color = "#39ff14";
  }
});

// --- СЛУХАЧІ ПОДІЙ МОДУЛЯ 2 (KITCHEN FORMATS) ---
exportQoiBtn.addEventListener("click", () => {
  if (outputCanvas.width === 0) return alert("Please process an image first.");
  statusText.innerText = "Encoding QOI...";
  const imgData = ctxOutput.getImageData(
    0,
    0,
    outputCanvas.width,
    outputCanvas.height,
  );

  const qoiBuffer = QoiEncoder.encode(
    outputCanvas.width,
    outputCanvas.height,
    imgData.data,
  );
  const blob = new Blob([qoiBuffer], { type: "image/qoi" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "pixelforge_asset.qoi";
  a.click();
  URL.revokeObjectURL(url);
  statusText.innerText = `QOI downloaded (${blob.size} bytes).`;
  statusText.style.color = "#00f0ff";
});

exportAvifBtn.addEventListener("click", () => {
  if (outputCanvas.width === 0) return alert("Please process an image first.");
  statusText.innerText = "Encoding AVIF Container...";
  let dataUrl = outputCanvas.toDataURL("image/avif");
  let extension = "avif";

  if (!dataUrl.startsWith("data:image/avif")) {
    dataUrl = outputCanvas.toDataURL("image/webp", 0.9);
    extension = "webp";
  }

  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `pixelforge_asset.${extension}`;
  a.click();
  statusText.innerText = `${extension.toUpperCase()} compressed asset downloaded.`;
  statusText.style.color = "#39ff14";
});

exportCBtn.addEventListener("click", () => {
  if (outputCanvas.width === 0) return alert("Please process an image first.");
  statusText.innerText = "Generating C-Code...";

  const width = outputCanvas.width;
  const height = outputCanvas.height;
  const imgData = ctxOutput.getImageData(0, 0, width, height);
  const data = imgData.data;
  const mode = exportBitDepth.value;
  const packedBytes: string[] = [];
  let formatComment = "";

  if (mode === "4bit") {
    const indices: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const alpha = data[i + 3];
      indices.push(alpha === 0 ? 0 : getPaletteIndex(r, g, b));
    }
    for (let i = 0; i < indices.length; i += 2) {
      const p1 = indices[i];
      const p2 = i + 1 < indices.length ? indices[i + 1] : 0;
      packedBytes.push(
        `0x${((p1 << 4) | p2).toString(16).toUpperCase().padStart(2, "0")}`,
      );
    }
    formatComment = "4-bit Packed Palette (16 Colors, 2 pixels per byte)";
  } else {
    const bits: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const alpha = data[i + 3];
      if (alpha === 0) bits.push(0);
      else bits.push(0.299 * r + 0.587 * g + 0.114 * b > 127 ? 1 : 0);
    }
    for (let i = 0; i < bits.length; i += 8) {
      let packedByte = 0;
      for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
        if (i + bitIdx < bits.length)
          packedByte |= bits[i + bitIdx] << (7 - bitIdx);
      }
      packedBytes.push(
        `0x${packedByte.toString(16).toUpperCase().padStart(2, "0")}`,
      );
    }
    formatComment =
      "1-bit Monochrome Array (OLED SSD1306, 8 pixels per byte, MSB-first)";
  }

  let cCode = `// PixelForge Generated Asset\n// Dimensions: ${width}x${height} px\n// Format: ${formatComment}\n// Total bytes: ${packedBytes.length}\n\nconst uint8_t pixelforge_asset[] = {\n    `;
  for (let i = 0; i < packedBytes.length; i++) {
    cCode += packedBytes[i];
    if (i < packedBytes.length - 1) cCode += ", ";
    if ((i + 1) % 12 === 0 && i < packedBytes.length - 1) cCode += "\n    ";
  }
  cCode += "\n};";
  cCodeOutput.value = cCode;
  statusText.innerText = "C-Array generated successfully!";
  statusText.style.color = "#3fb950";
});

// --- СЛУХАЧІ ПОДІЙ МОДУЛЯ 4 (SPRITE PACKER) ---
spriteUpload.addEventListener("change", async (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;

  statusText.innerText = `Pre-processing ${files.length} frames...`;
  loadedSpritesQueue = [];

  for (let i = 0; i < files.length; i++) {
    showProgress(i + 1, files.length);
    const file = files[i];
    if (file.size > MAX_FILE_SIZE) {
      alert(
        `Frame "${file.name}" is excluded! Size exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
      );
      continue;
    }

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const imgObj = new Image();
          imgObj.onload = () => resolve(imgObj);
          imgObj.onerror = reject;
          imgObj.src = ev.target?.result as string;
        };
        reader.readAsDataURL(file);
      });

      if (img.width > MAX_WIDTH || img.height > MAX_HEIGHT) {
        alert(
          `Frame "${file.name}" is excluded! Dimensions exceed ${MAX_WIDTH}x${MAX_HEIGHT}px.`,
        );
        continue;
      }

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      tempCanvas.getContext("2d")!.drawImage(img, 0, 0);

      const imgData = tempCanvas
        .getContext("2d")!
        .getImageData(0, 0, img.width, img.height);
      loadedSpritesQueue.push({
        id: `sprite_${Date.now()}_${i}`,
        name: file.name,
        width: img.width,
        height: img.height,
        buffer: imgData.data.buffer,
      });
    } catch (err) {
      console.error(`Failed to read file ${file.name}:`, err);
    }
  }
  hideProgress();
  statusText.innerText = `Ready to pack: ${loadedSpritesQueue.length} validated frames.`;
  statusText.style.color = "#ffb86c";
});

packBtn.addEventListener("click", () => {
  if (loadedSpritesQueue.length === 0)
    return alert("Please select sprites first.");
  statusText.innerText = "Packing atlas (Thread safe)...";
  initPackWorker();
  packBtn.disabled = true;

  progressBar.removeAttribute("value");
  progressBar.style.display = "inline-block";

  const spriteInputs: SpriteInput[] = loadedSpritesQueue.map((s) => ({
    id: s.id,
    name: s.name,
    width: s.width,
    height: s.height,
    buffer: s.buffer.slice(0),
  }));

  const buffers = spriteInputs.map((s) => s.buffer);
  packWorker!.postMessage(
    { sprites: spriteInputs, padding: parseInt(packPadding.value) || 0 },
    buffers,
  );
});

function startAnimationLoop() {
  if (animationIntervalId) clearInterval(animationIntervalId);
  const renderFrame = () => {
    if (animationFrames.length === 0 || !atlasImageElement) return;
    const frame = animationFrames[currentFrameIndex];
    ctxPreview.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctxPreview.drawImage(
      atlasImageElement,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      (previewCanvas.width - frame.sourceWidth) / 2 + frame.trimX,
      (previewCanvas.height - frame.sourceHeight) / 2 + frame.trimY,
      frame.width,
      frame.height,
    );
    currentFrameIndex = (currentFrameIndex + 1) % animationFrames.length;
  };
  animationIntervalId = window.setInterval(
    renderFrame,
    1000 / (parseInt(fpsSlider.value) || 12),
  );
}

fpsSlider.addEventListener("input", () => {
  fpsValue.innerText = fpsSlider.value;
  if (animationFrames.length > 0) startAnimationLoop();
});

// --- СЛУХАЧІ ПОДІЙ МОДУЛЯ 5 (FONT GRID) ---
fontUpload.addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    loadedFontBuffer = event.target?.result as ArrayBuffer;
    statusText.innerText = `Font "${file.name}" loaded into memory.`;
    statusText.style.color = "#58a6ff";
  };
  reader.readAsArrayBuffer(file);
});

generateFontBtn.addEventListener("click", () => {
  if (!loadedFontBuffer)
    return alert("Please upload a .ttf or .otf font first.");
  const size = parseInt(fontSizeInput.value) || 8;
  statusText.innerText = "Parsing font metadata...";

  try {
    const font = (opentype as any).parse(loadedFontBuffer);
    const startChar = 32;
    const endChar = 126;
    const fontCanvas = document.createElement("canvas");
    fontCanvas.width = size;
    fontCanvas.height = size;
    const fontCtx = fontCanvas.getContext("2d", { willReadFrequently: true })!;

    let cCode = `// PixelForge Generated Embedded Font\n// Font Size: ${size}x${size} px\nconst uint8_t font_${size}x${size}[${endChar - startChar + 1}][${size}] = {\n`;

    for (let charCode = startChar; charCode <= endChar; charCode++) {
      const char = String.fromCharCode(charCode);
      fontCtx.clearRect(0, 0, size, size);
      fontCtx.fillStyle = "#000000";
      fontCtx.fillRect(0, 0, size, size);

      const path = font.getPath(char, 0, size * 0.8, size);
      fontCtx.fillStyle = "#FFFFFF";
      fontCtx.fill(new Path2D(path.toPathData(2)));

      const pixels = fontCtx.getImageData(0, 0, size, size).data;
      cCode += `    { `;

      for (let y = 0; y < size; y++) {
        let rowByte = 0;
        for (let x = 0; x < size; x++) {
          if (pixels[(y * size + x) * 4] > 127) rowByte |= 1 << (7 - x);
        }
        cCode += `0x${rowByte.toString(16).toUpperCase().padStart(2, "0")}${y < size - 1 ? ", " : ""}`;
      }
      cCode += ` }, // '${char}'\n`;
    }
    cCode += `};`;
    fontCodeOutput.value = cCode;
    statusText.innerText = "Bitmap font exported successfully!";
    statusText.style.color = "#3fb950";
  } catch (err) {
    statusText.innerText = `Font Engine Error: ${(err as Error).message}`;
    statusText.style.color = "#f85149";
  }
});

// --- СЛУХАЧІ ПОДІЙ МОДУЛЯ 6 (DEVOPS) ---
generatePipelineBtn.addEventListener("click", () => {
  const targetW = parseInt(resizeW.value) || 64;
  const targetH = parseInt(resizeH.value) || 64;
  const isNearest = resizeMode.value === "nearest";

  let nodeScript = `// PixelForge Automated Headless Pipeline\nconst fs = require('fs');\nconst sharp = require('sharp');\nconst GARMIN_MIP_PALETTE = ${JSON.stringify(GARMIN_MIP_PALETTE)};\n`;
  nodeScript += `function getPaletteIndex(r, g, b) {\n    let minDistanceSq = Infinity; let bestMatch = 0;\n    for (let i = 0; i < GARMIN_MIP_PALETTE.length; i++) {\n        const color = GARMIN_MIP_PALETTE[i];\n        const dist = (r - color[0])**2 + (g - color[1])**2 + (b - color[2])**2;\n        if (dist < minDistanceSq) { minDistanceSq = dist; bestMatch = i; }\n    }\n    return bestMatch;\n}\n`;
  nodeScript += `async function runPipeline(inputPath, outputPath) {\n    const { data, info } = await sharp(inputPath).resize(${targetW}, ${targetH}, { kernel: '${isNearest ? "nearest" : "lanczos3"}' }).raw().toBuffer({ resolveWithObject: true });\n    const indices = []; for (let i = 0; i < data.length; i += info.channels) indices.push(info.channels === 4 && data[i+3] === 0 ? 0 : getPaletteIndex(data[i], data[i+1], data[i+2]));\n`;
  nodeScript += `    const packedBytes = []; for (let i = 0; i < indices.length; i += 2) packedBytes.push('0x' + ((indices[i] << 4) | (indices[i+1] || 0)).toString(16).toUpperCase().padStart(2, '0'));\n`;
  nodeScript += `    fs.writeFileSync(outputPath, 'const uint8_t asset_bytes[] = { ' + packedBytes.join(', ') + ' };');\n}\nrunPipeline('src/assets/logo.svg', 'src/assets/generated_asset.h').catch(console.error);\n`;

  let githubYAML = `name: Auto-Compile PixelForge Assets\non:\n  push:\n    paths: [ 'src/assets/*.svg', 'src/assets/*.png' ]\njobs:\n  build-assets:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: 20, cache: 'npm' }\n      - run: npm install sharp\n      - run: node pixel-forge-pipeline.js\n      - run: | \n          git config --global user.name "PixelForge Bot"\n          git config --global user.email "bot@pixelforge.dev"\n          git add src/assets/*.h\n          git diff-index --quiet HEAD || (git commit -m "chore: auto-regenerate c-arrays [skip ci]" && git push)\n`;

  nodeScriptOutput.value = nodeScript;
  githubActionOutput.value = githubYAML;
  statusText.innerText = "CI/CD Pipeline scripts generated!";
  statusText.style.color = "#3fb950";
});

// --- СЛУХАЧІ ПОДІЙ (TILEMAP OPTIMIZER) ---
generateTilemapBtn.addEventListener("click", () => {
  if (outputCanvas.width === 0) return alert("Please process an image first.");
  statusText.innerText = "Analyzing tile structures...";
  const tileSize = parseInt(tileMapSizeSelect.value);
  const imgWidth = outputCanvas.width;
  const imgHeight = outputCanvas.height;

  if (imgWidth % tileSize !== 0 || imgHeight % tileSize !== 0)
    alert(
      `Warning: Image dimensions (${imgWidth}x${imgHeight}) are not perfectly divisible by tile size.`,
    );

  const cols = Math.floor(imgWidth / tileSize);
  const rows = Math.floor(imgHeight / tileSize);
  const data = ctxOutput.getImageData(0, 0, imgWidth, imgHeight).data;
  const uniqueTiles = new Map<string, number>();
  const tileMapMatrix: number[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(0),
  );
  const uniqueTilesBuffers: ImageData[] = [];
  let nextTileIndex = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tileBuffer = new Uint8ClampedArray(tileSize * tileSize * 4);
      let pixelHash = "";
      for (let ty = 0; ty < tileSize; ty++) {
        for (let tx = 0; tx < tileSize; tx++) {
          const srcIdx =
            ((r * tileSize + ty) * imgWidth + (c * tileSize + tx)) * 4;
          const destIdx = (ty * tileSize + tx) * 4;
          tileBuffer[destIdx] = data[srcIdx];
          tileBuffer[destIdx + 1] = data[srcIdx + 1];
          tileBuffer[destIdx + 2] = data[srcIdx + 2];
          tileBuffer[destIdx + 3] = data[srcIdx + 3];
          pixelHash += `${data[srcIdx]},${data[srcIdx + 1]},${data[srcIdx + 2]},${data[srcIdx + 3]}|`;
        }
      }
      if (!uniqueTiles.has(pixelHash)) {
        uniqueTiles.set(pixelHash, nextTileIndex);
        uniqueTilesBuffers.push(new ImageData(tileBuffer, tileSize, tileSize));
        tileMapMatrix[r][c] = nextTileIndex;
        nextTileIndex++;
      } else {
        tileMapMatrix[r][c] = uniqueTiles.get(pixelHash)!;
      }
    }
  }

  tilesetCanvas.width = uniqueTilesBuffers.length * tileSize;
  tilesetCanvas.height = tileSize;
  ctxTileset.clearRect(0, 0, tilesetCanvas.width, tilesetCanvas.height);
  uniqueTilesBuffers.forEach((tileImgData, index) =>
    ctxTileset.putImageData(tileImgData, index * tileSize, 0),
  );

  let cCode = `// PixelForge Tilemap Optimizer Summary\n#define TILEMAP_WIDTH ${cols}\n#define TILEMAP_HEIGHT ${rows}\nconst uint8_t game_tilemap[TILEMAP_HEIGHT][TILEMAP_WIDTH] = {\n`;
  for (let r = 0; r < rows; r++) {
    cCode +=
      "    { " +
      tileMapMatrix[r]
        .map((idx) => idx.toString().padStart(3, " "))
        .join(", ") +
      " }" +
      (r < rows - 1 ? ",\n" : "");
  }
  cCode += "\n};";
  tilemapCodeOutput.value = cCode;
  statusText.innerText = `Tilemap built! Found ${uniqueTilesBuffers.length} unique tiles.`;
  statusText.style.color = "#39ff14";
});

// --- ГЛОБАЛЬНИЙ ЗАХИСТ ВІД КРАШІВ ---
function handleGlobalCrash(message: string) {
  hideProgress();
  if (resizeBtn) resizeBtn.disabled = false;
  if (processBtn) processBtn.disabled = false;
  if (packBtn) packBtn.disabled = false;
  if (generateFontBtn) generateFontBtn.disabled = false;
  if (statusText) {
    statusText.innerText = `CRITICAL: ${message}`;
    statusText.style.color = "#f85149";
  }
  console.error(`[PixelForge Guard] Caught unhandled exception:`, message);
}

window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  handleGlobalCrash(
    event.reason instanceof Error ? event.reason.message : String(event.reason),
  );
});
window.addEventListener("error", (event) => {
  event.preventDefault();
  handleGlobalCrash(event.message);
});

// --- УНІВЕРСАЛЬНИЙ DRAG & DROP ДЛЯ ВСІХ МОДУЛІВ ---
function setupDragAndDrop(
  zoneElement: HTMLElement | null,
  fileHandler: (files: FileList) => void,
  acceptMultiple: boolean = false,
) {
  if (!zoneElement) return;

  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    zoneElement.addEventListener(eventName, (e) => e.preventDefault(), false);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    zoneElement.addEventListener(
      eventName,
      () => zoneElement.classList.add("drag-over"),
      false,
    );
  });

  ["dragleave", "drop"].forEach((eventName) => {
    zoneElement.addEventListener(
      eventName,
      () => zoneElement.classList.remove("drag-over"),
      false,
    );
  });

  zoneElement.addEventListener(
    "drop",
    (e: DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      if (!acceptMultiple && files.length > 1)
        return alert("This dropzone accepts only 1 single file at a time.");
      fileHandler(files);
    },
    false,
  );
}

// НАЙВАЖЛИВІШЕ: Пряма активація Drag & Drop без DOMContentLoaded конфліктів у модулях Vite
setupDragAndDrop(
  document.getElementById("raster"),
  (files) => {
    if (uploadInput) {
      const dt = new DataTransfer();
      dt.items.add(files[0]);
      uploadInput.files = dt.files;
      uploadInput.dispatchEvent(new Event("change"));
    }
  },
  false,
);

setupDragAndDrop(
  document.getElementById("packer"),
  (files) => {
    if (spriteUpload) {
      const dt = new DataTransfer();
      for (let i = 0; i < files.length; i++) dt.items.add(files[i]);
      spriteUpload.files = dt.files;
      spriteUpload.dispatchEvent(new Event("change"));
    }
  },
  true,
);

setupDragAndDrop(
  document.getElementById("fonts"),
  (files) => {
    if (fontUpload) {
      const dt = new DataTransfer();
      dt.items.add(files[0]);
      fontUpload.files = dt.files;
      fontUpload.dispatchEvent(new Event("change"));
    }
  },
  false,
);
