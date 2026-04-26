import qrcode from 'qrcode-generator';

/**
 * Render a QR code of the given text onto `canvas`. The canvas is resized to
 * a square whose side is as close as possible to `targetSize` while keeping
 * crisp integer-pixel modules.
 *
 * Error-correction level `M` matches the legacy implementation.
 */
export function drawQrToCanvas(canvas: HTMLCanvasElement, text: string, targetSize: number): void {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const cellCount = qr.getModuleCount();
  const cellSize = Math.max(1, Math.floor(targetSize / cellCount));
  const actualSize = cellSize * cellCount;

  canvas.width = actualSize;
  canvas.height = actualSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, actualSize, actualSize);
  ctx.fillStyle = '#000000';
  for (let row = 0; row < cellCount; row++) {
    for (let col = 0; col < cellCount; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
  }
}
