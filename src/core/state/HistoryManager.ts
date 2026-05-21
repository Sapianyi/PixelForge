// src/core/state/HistoryManager.ts
import { openDB } from "idb";
import type { IDBPDatabase } from "idb";

export class HistoryManager {
  private dbPromise: Promise<IDBPDatabase>;
  private currentIndex: number = -1;
  private maxIndex: number = -1;
  private readonly MAX_STATES = 20; // Обмеження історії, щоб не засмічувати диск

  constructor() {
    // Ініціалізація бази даних PixelForgeDB
    this.dbPromise = openDB("PixelForgeDB", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("history")) {
          db.createObjectStore("history");
        }
      },
    });
  }

  /**
   * Зберігає поточний стан Canvas в IndexedDB
   */
  async saveState(imageData: ImageData): Promise<void> {
    const db = await this.dbPromise;

    // Якщо ми зробили Undo, а потім нову дію — жорстко видаляємо всю гілку "майбутнього"
    if (this.currentIndex < this.maxIndex) {
      for (let i = this.currentIndex + 1; i <= this.maxIndex; i++) {
        await db.delete("history", i);
      }
    }

    this.currentIndex++;
    this.maxIndex = this.currentIndex;

    // Зберігаємо поточний знімок екрана
    await db.put("history", imageData, this.currentIndex);

    // КОРЕКТНЕ ОЧИЩЕННЯ ХВОСТА ІСТОРІЇ:
    // Видаляємо найстаріші записи, які випали за межі вікна двадцяти останніх станів
    const oldestAllowedIndex = this.maxIndex - this.MAX_STATES;

    if (oldestAllowedIndex >= 0) {
      // Очищаємо абсолютно всі застарілі індекси, які могли накопичитися з самого початку (0...до дозволеної межі)
      // Це гарантує захист диска, навіть якщо раніше був збій індексації
      for (let i = 0; i <= oldestAllowedIndex; i++) {
        await db.delete("history", i);
      }
    }
  }

  /**
   * Крок назад (Undo)
   */
  async undo(): Promise<ImageData | null> {
    const oldestAllowedIndex = Math.max(0, this.maxIndex - this.MAX_STATES + 1);

    // Не даємо опуститися нижче нуля або нижче межі зачищених слайсів
    if (this.currentIndex <= oldestAllowedIndex) {
      console.log("[History] Reached the end of available undo steps.");
      return null;
    }

    this.currentIndex--;
    const db = await this.dbPromise;
    return ((await db.get("history", this.currentIndex)) as ImageData) || null;
  }

  /**
   * Крок вперед (Redo)
   */
  async redo(): Promise<ImageData | null> {
    if (this.currentIndex >= this.maxIndex) return null;

    this.currentIndex++;
    const db = await this.dbPromise;
    return ((await db.get("history", this.currentIndex)) as ImageData) || null;
  }
}
