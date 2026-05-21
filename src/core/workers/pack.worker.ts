// src/core/workers/pack.worker.ts

export interface SpriteInput {
  id: string;
  name: string;
  width: number;
  height: number;
  buffer: ArrayBuffer; // Сирі RGBA пікселі
}

export interface PackedSprite {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  trimmed: boolean;
  trimX: number; // КРИТИЧНО: додаємо зміщення, щоб анімацію не трясло
  trimY: number; // КРИТИЧНО: додаємо зміщення
  sourceWidth: number;
  sourceHeight: number;
}

export interface PackResult {
  atlasWidth: number;
  atlasHeight: number;
  sprites: PackedSprite[];
  atlasBuffer: ArrayBuffer;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Автоматичне обрізання (trim) прозорих країв спрайту
 */
function trimSprite(width: number, height: number, data: Uint32Array) {
  let top = height,
    bottom = 0,
    left = width,
    right = 0;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const alpha = (data[rowOffset + x] >> 24) & 0xff;
      if (alpha > 0) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  if (left > right || top > bottom) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }

  return {
    x: left,
    y: top,
    w: right - left + 1,
    h: bottom - top + 1,
  };
}

/**
 * Імплементація MaxRects алгоритму
 */
class MaxRectsPacker {
  private freeRects: Rect[] = [];
  // @ts-ignore
  private width: number;
  // @ts-ignore
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.freeRects.push({ x: 0, y: 0, w: width, h: height });
  }

  public insert(w: number, h: number): Rect | null {
    let bestNode: Rect | null = null;
    let bestShortSideFit = Infinity;
    let bestLongSideFit = Infinity;

    for (const rect of this.freeRects) {
      if (rect.w >= w && rect.h >= h) {
        const leftoverW = rect.w - w;
        const leftoverH = rect.h - h;
        const shortSideFit = Math.min(leftoverW, leftoverH);
        const longSideFit = Math.max(leftoverW, leftoverH);

        if (
          shortSideFit < bestShortSideFit ||
          (shortSideFit === bestShortSideFit && longSideFit < bestLongSideFit)
        ) {
          bestNode = { x: rect.x, y: rect.y, w, h };
          bestShortSideFit = shortSideFit;
          bestLongSideFit = longSideFit;
        }
      }
    }

    if (!bestNode) return null;

    const numRectsToProcess = this.freeRects.length;
    for (let i = 0; i < numRectsToProcess; i++) {
      if (this.splitFreeNode(this.freeRects[i], bestNode)) {
        this.freeRects.splice(i, 1);
        i--;
      }
    }

    this.pruneFreeRects();
    return bestNode;
  }

  private splitFreeNode(free: Rect, used: Rect): boolean {
    if (
      used.x >= free.x + free.w ||
      used.x + used.w <= free.x ||
      used.y >= free.y + free.h ||
      used.y + used.h <= free.y
    ) {
      return false;
    }

    if (used.x < free.x + free.w && used.x + used.w > free.x) {
      if (used.y > free.y && used.y < free.y + free.h) {
        this.freeRects.push({
          x: free.x,
          y: free.y,
          w: free.w,
          h: used.y - free.y,
        });
      }
      if (used.y + used.h < free.y + free.h) {
        this.freeRects.push({
          x: free.x,
          y: used.y + used.h,
          w: free.w,
          h: free.y + free.h - (used.y + used.h),
        });
      }
    }

    if (used.y < free.y + free.h && used.y + used.h > free.y) {
      if (used.x > free.x && used.x < free.x + free.w) {
        this.freeRects.push({
          x: free.x,
          y: free.y,
          w: used.x - free.x,
          h: free.h,
        });
      }
      if (used.x + used.w < free.x + free.w) {
        this.freeRects.push({
          x: used.x + used.w,
          y: free.y,
          w: free.x + free.w - (used.x + used.w),
          h: free.h,
        });
      }
    }

    return true;
  }

  private pruneFreeRects() {
    // Фікс алгоритмічного багу зсуву індексів при чищенні дублікатів
    for (let i = 0; i < this.freeRects.length; i++) {
      for (let j = i + 1; j < this.freeRects.length; j++) {
        if (this.isContainedIn(this.freeRects[i], this.freeRects[j])) {
          this.freeRects.splice(i, 1);
          i--;
          break;
        }
        if (this.isContainedIn(this.freeRects[j], this.freeRects[i])) {
          this.freeRects.splice(j, 1);
          j--;
        }
      }
    }
  }

  private isContainedIn(a: Rect, b: Rect): boolean {
    return (
      a.x >= b.x &&
      a.y >= b.y &&
      a.x + a.w <= b.x + b.w &&
      a.y + a.h <= b.y + b.h
    );
  }
}

/**
 * Головний обробник воркера
 */
self.addEventListener(
  "message",
  (e: MessageEvent<{ sprites: SpriteInput[]; padding: number }>) => {
    try {
      const { sprites, padding } = e.data;
      const packedSprites: PackedSprite[] = [];

      // Крок 1: Обробка та Auto-Trim
      const prepared = sprites.map((s) => {
        const view = new Uint32Array(s.buffer);
        const bounds = trimSprite(s.width, s.height, view);
        return {
          source: s,
          bounds,
          view,
        };
      });

      // Евристичне сортування MaxRects
      prepared.sort(
        (a, b) =>
          Math.max(b.bounds.w, b.bounds.h) - Math.max(a.bounds.w, a.bounds.h),
      );

      let atlasW = 512;
      let atlasH = 512;
      let success = false;

      // Крок 2: Цикл пакування з динамічним розширенням контейнера
      while (!success) {
        const packer = new MaxRectsPacker(atlasW, atlasH);
        packedSprites.length = 0;
        success = true;

        for (const item of prepared) {
          const fit = packer.insert(
            item.bounds.w + padding * 2,
            item.bounds.h + padding * 2,
          );
          if (!fit) {
            if (atlasW <= atlasH) atlasW *= 2;
            else atlasH *= 2;
            success = false;
            break;
          }
          packedSprites.push({
            id: item.source.id,
            name: item.source.name,
            x: fit.x + padding,
            y: fit.y + padding,
            width: item.bounds.w,
            height: item.bounds.h,
            trimmed:
              item.bounds.w !== item.source.width ||
              item.bounds.h !== item.source.height,
            trimX: item.bounds.x, // ПІДТРИМКА АНІМАЦІЇ: Зберігаємо точку старту вирізання
            trimY: item.bounds.y,
            sourceWidth: item.source.width,
            sourceHeight: item.source.height,
          });
        }
        if (atlasW > 4096 || atlasH > 4096) {
          throw new Error("Sprites exceed max atlas limit (4096x4096px)");
        }
      }

      // Крок 3: Створення фінального буфера
      const atlasBuffer = new ArrayBuffer(atlasW * atlasH * 4);
      const atlasView = new Uint32Array(atlasBuffer);

      // ОПТИМІЗАЦІЯ Х20: Будуємо швидку Map-карту замість важкого .find() всередині циклів
      const packedMap = new Map<string, PackedSprite>();
      for (const ps of packedSprites) {
        packedMap.set(ps.id, ps);
      }

      // Крок 4: Блітінг (копіювання) пікселів
      for (const item of prepared) {
        const p = packedMap.get(item.source.id)!;
        const srcW = item.source.width;
        const bounds = item.bounds;

        for (let row = 0; row < bounds.h; row++) {
          const srcRowOffset = (bounds.y + row) * srcW + bounds.x;
          const destRowOffset = (p.y + row) * atlasW + p.x;

          for (let col = 0; col < bounds.w; col++) {
            atlasView[destRowOffset + col] = item.view[srcRowOffset + col];
          }
        }
      }

      // Крок 5: Безпечний трансфер контролю над пам'яттю
      const result: PackResult = {
        atlasWidth: atlasW,
        atlasHeight: atlasH,
        sprites: packedSprites,
        atlasBuffer,
      };

      // Явно віддаємо буфер головному потоку, обнуляючи посилання тут
      self.postMessage(result, { transfer: [result.atlasBuffer] });
    } catch (err) {
      self.postMessage({ error: (err as Error).message });
    }
  },
);
