// src/core/formats/QoiEncoder.ts

export class QoiEncoder {
  /**
   * Конвертує сирі RGBA пікселі у бінарний масив файлу .qoi
   * З повною фіксацією артефактів альфа-каналу (Alpha Cleansing)
   */
  public static encode(
    width: number,
    height: number,
    rgbaData: Uint8ClampedArray,
  ): ArrayBuffer {
    const descSize = 14;
    const paddingSize = 8;
    const maxBufferSize = descSize + width * height * 5 + paddingSize;

    const buffer = new ArrayBuffer(maxBufferSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // 1. Запис заголовку (QOI Header)
    bytes[0] = 113; // 'q'
    bytes[1] = 111; // 'o'
    bytes[2] = 105; // 'i'
    bytes[3] = 102; // 'f'
    view.setUint32(4, width, false); // Big-endian
    view.setUint32(8, height, false); // Big-endian
    bytes[12] = 4; // 4 канали (RGBA)
    bytes[13] = 0; // Специфікація кольору (0 = sRGB)

    const index = new Uint8Array(64 * 4);
    let pIdx = 14;
    let run = 0;

    // Попередній піксель (стартує з чорного, альфа = 255 за специфікацією QOI)
    let pr = 0,
      pg = 0,
      pb = 0,
      pa = 255;

    for (let i = 0; i < rgbaData.length; i += 4) {
      let r = rgbaData[i];
      let g = rgbaData[i + 1];
      let b = rgbaData[i + 2];
      let a = rgbaData[i + 3];

      // ФІКС АЛЬФА-АРТЕФАКТІВ: Якщо піксель повністю прозорий,
      // примусово зануляємо RGB, щоб уникнути колірного шуму та увімкнути масивні RUN-ранги
      if (a === 0) {
        r = 0;
        g = 0;
        b = 0;
      }

      if (r === pr && g === pg && b === pb && a === pa) {
        run++;
        if (run === 62 || i + 4 >= rgbaData.length) {
          bytes[pIdx++] = 0xc0 | (run - 1); // QOI_OP_RUN
          run = 0;
        }
      } else {
        if (run > 0) {
          bytes[pIdx++] = 0xc0 | (run - 1);
          run = 0;
        }

        const indexPos = ((r * 3 + g * 5 + b * 7 + a * 11) % 64) * 4;

        if (
          index[indexPos] === r &&
          index[indexPos + 1] === g &&
          index[indexPos + 2] === b &&
          index[indexPos + 3] === a
        ) {
          bytes[pIdx++] = 0x00 | (indexPos / 4); // QOI_OP_INDEX
        } else {
          index[indexPos] = r;
          index[indexPos + 1] = g;
          index[indexPos + 2] = b;
          index[indexPos + 3] = a;

          if (a === pa) {
            const dr = (r - pr) | 0;
            const dg = (g - pg) | 0;
            const db = (b - pb) | 0;

            const dr_dg = (dr - dg) | 0;
            const db_dg = (db - dg) | 0;

            if (
              dr >= -2 &&
              dr <= 1 &&
              dg >= -2 &&
              dg <= 1 &&
              db >= -2 &&
              db <= 1
            ) {
              bytes[pIdx++] =
                0x40 | ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2); // QOI_OP_DIFF
            } else if (
              dg >= -32 &&
              dg <= 31 &&
              dr_dg >= -8 &&
              dr_dg <= 7 &&
              db_dg >= -8 &&
              db_dg <= 7
            ) {
              bytes[pIdx++] = 0x80 | (dg + 32); // QOI_OP_LUMA
              bytes[pIdx++] = ((dr_dg + 8) << 4) | (db_dg + 8);
            } else {
              bytes[pIdx++] = 0xfe; // QOI_OP_RGB
              bytes[pIdx++] = r;
              bytes[pIdx++] = g;
              bytes[pIdx++] = b;
            }
          } else {
            bytes[pIdx++] = 0xff; // QOI_OP_RGBA
            bytes[pIdx++] = r;
            bytes[pIdx++] = g;
            bytes[pIdx++] = b;
            bytes[pIdx++] = a;
          }
        }
      }

      pr = r;
      pg = g;
      pb = b;
      pa = a;
    }

    // Кінцевий маркер файлу QOI
    const qoiPadding = [0, 0, 0, 0, 0, 0, 0, 1];
    for (let i = 0; i < qoiPadding.length; i++) {
      bytes[pIdx++] = qoiPadding[i];
    }

    return buffer.slice(0, pIdx);
  }
}
