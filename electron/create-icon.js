const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Tạo file PNG hợp lệ bằng zlib thuần của Node.js
function createSolidPng(width, height, r, g, b, a = 255) {
  // Raw RGBA scanlines (1 filter byte (0) per row)
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowSize);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter None
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      
      // Tạo hiệu ứng gradient nhẹ từ trên xuống dưới
      const factor = 1 - (y / height) * 0.3;
      // Bo góc nhẹ
      const dx = Math.min(x, width - 1 - x);
      const dy = Math.min(y, height - 1 - y);
      const isCorner = (dx < 4 && dy < 4 && (dx - 4) * (dx - 4) + (dy - 4) * (dy - 4) > 16);

      if (isCorner) {
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      } else {
        rawData[pxOffset] = Math.min(255, Math.floor(r * factor));
        rawData[pxOffset + 1] = Math.min(255, Math.floor(g * factor));
        rawData[pxOffset + 2] = Math.min(255, Math.floor(b * factor));
        rawData[pxOffset + 3] = a;
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);

  // PNG Header
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // IDAT chunk
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);

  const crc = crc32(chunk.subarray(4, 8 + len));
  chunk.writeInt32BE(crc, 8 + len);
  return chunk;
}

// CRC32 implementation
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return ~c;
}

// Tạo file .ico chứa ảnh PNG (Vista+ ICO format hỗ trợ PNG nhúng)
function createIcoFromPng(pngBuffer, width, height) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type 1 = ICO
  header.writeUInt16LE(1, 4); // Number of images

  const entry = Buffer.alloc(16);
  entry.writeUInt8(width >= 256 ? 0 : width, 0);
  entry.writeUInt8(height >= 256 ? 0 : height, 1);
  entry.writeUInt8(0, 2); // Color palette
  entry.writeUInt8(0, 3); // Reserved
  entry.writeUInt16LE(1, 4); // Color planes
  entry.writeUInt16LE(32, 6); // Bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8); // Size of image data
  entry.writeUInt32LE(22, 12); // Offset to image data (6 header + 16 entry)

  return Buffer.concat([header, entry, pngBuffer]);
}

const buildDir = path.resolve(__dirname, '../build');
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// Màu xanh dương thương hiệu MKT Tools (#2563EB: 37, 99, 235)
const iconPng = createSolidPng(256, 256, 37, 99, 235);
const iconIco = createIcoFromPng(iconPng, 256, 256);
const trayPng = createSolidPng(32, 32, 37, 99, 235);

fs.writeFileSync(path.join(buildDir, 'icon.png'), iconPng);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), iconIco);
fs.writeFileSync(path.join(buildDir, 'tray.png'), trayPng);

const publicDir = path.resolve(__dirname, '../public');
fs.writeFileSync(path.join(publicDir, 'tray.png'), trayPng);

console.log('✅ Đã tạo thành công bộ icon: build/icon.png, build/icon.ico, build/tray.png, public/tray.png');
