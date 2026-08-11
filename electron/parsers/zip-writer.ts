import * as zlib from 'zlib';

// Minimal ZIP archive builder using Node's built-in zlib (no external deps).
// Produces a valid ZIP with deflate-compressed entries.
export function buildZipArchive(files: { name: string; data: Buffer }[]): Buffer {
  const entries: { name: Buffer; compressed: Buffer; crc: number; sizeRaw: number; sizeComp: number; offset: number }[] = [];
  const chunks: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const compressed = zlib.deflateRawSync(f.data, { level: 9 });

    // Local file header (30 bytes + name + compressed data)
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);  // signature
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(8, 8);           // compression: deflate
    local.writeUInt16LE(0, 10);          // mod time
    local.writeUInt16LE(0, 12);          // mod date
    local.writeUInt32LE(crc, 14);        // crc-32
    local.writeUInt32LE(compressed.length, 18);  // compressed size
    local.writeUInt32LE(f.data.length, 22);      // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);   // filename length
    local.writeUInt16LE(0, 28);          // extra field length

    entries.push({ name: nameBytes, compressed, crc, sizeRaw: f.data.length, sizeComp: compressed.length, offset });
    chunks.push(local, nameBytes, compressed);
    offset += 30 + nameBytes.length + compressed.length;
  }

  // Central directory
  const cdStart = offset;
  for (const e of entries) {
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);   // signature
    cd.writeUInt16LE(20, 4);           // version made by
    cd.writeUInt16LE(20, 6);           // version needed
    cd.writeUInt16LE(0, 8);            // flags
    cd.writeUInt16LE(8, 10);           // compression: deflate
    cd.writeUInt16LE(0, 12);           // mod time
    cd.writeUInt16LE(0, 14);           // mod date
    cd.writeUInt32LE(e.crc, 16);       // crc-32
    cd.writeUInt32LE(e.sizeComp, 20);  // compressed size
    cd.writeUInt32LE(e.sizeRaw, 24);   // uncompressed size
    cd.writeUInt16LE(e.name.length, 28); // filename length
    cd.writeUInt16LE(0, 30);           // extra field length
    cd.writeUInt16LE(0, 32);           // comment length
    cd.writeUInt16LE(0, 34);           // disk number start
    cd.writeUInt16LE(0, 36);           // internal file attributes
    cd.writeUInt32LE(0, 38);           // external file attributes
    cd.writeUInt32LE(e.offset, 42);    // offset of local header
    chunks.push(cd, e.name);
    offset += 46 + e.name.length;
  }
  const cdSize = offset - cdStart;

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);   // signature
  eocd.writeUInt16LE(0, 4);            // disk number
  eocd.writeUInt16LE(0, 6);            // disk with CD
  eocd.writeUInt16LE(entries.length, 8);  // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(cdSize, 12);      // CD size
  eocd.writeUInt32LE(cdStart, 16);     // CD offset
  eocd.writeUInt16LE(0, 20);           // comment length
  chunks.push(eocd);

  return Buffer.concat(chunks);
}

// CRC-32 for ZIP (IEEE 802.3)
function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
