import qrcode from 'qrcode-generator';

/** QR modules for `data`: matrix[row][col] is true for a dark square. */
export function qrMatrix(data: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => qr.isDark(r, c)));
}
