import qrcode from 'qrcode-generator';

/**
 * Render a QR code of the given text onto `canvas`. The canvas is resized to
 * a square whose side is as close as possible to `targetSize` while keeping
 * crisp integer-pixel modules.
 *
 * Error-correction level `M` matches the legacy implementation.
 */
/**
 * Quiet zone (margin) in modules. QR spec requires minimum 4 modules of white
 * space around the QR code for reliable scanning.
 */
const QUIET_ZONE_MODULES = 4;

export function drawQrToCanvas(canvas: HTMLCanvasElement, text: string, targetSize: number): void {
	const qr = qrcode(0, 'M');
	qr.addData(text);
	qr.make();

	const cellCount = qr.getModuleCount();
	const totalModules = cellCount + 2 * QUIET_ZONE_MODULES;
	const cellSize = Math.max(1, Math.floor(targetSize / totalModules));
	const actualSize = cellSize * totalModules;
	const offset = cellSize * QUIET_ZONE_MODULES;

	canvas.width = actualSize;
	canvas.height = actualSize;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	// Fill entire canvas with white (includes quiet zone)
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, actualSize, actualSize);

	// Draw QR code with offset for quiet zone
	ctx.fillStyle = '#000000';
	for (let row = 0; row < cellCount; row++) {
		for (let col = 0; col < cellCount; col++) {
			if (qr.isDark(row, col)) {
				ctx.fillRect(offset + col * cellSize, offset + row * cellSize, cellSize, cellSize);
			}
		}
	}
}
