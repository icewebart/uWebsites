// Minimal, dependency-free ZIP writer (STORE method — no compression). Enough to
// package the WordPress plugin as an installable .zip without pulling an
// archiver dependency (which the supply-chain release-age policy tends to block).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export type ZipEntry = { name: string; data: Buffer }

/** Build a valid ZIP archive (all entries stored uncompressed). */
export function zipStore(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  // A fixed DOS timestamp (1980-01-01) — deterministic output, date is irrelevant.
  const dosTime = 0, dosDate = 0x21

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const crc = crc32(e.data)
    const size = e.data.length

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4)         // version needed
    local.writeUInt16LE(0, 6)          // flags
    local.writeUInt16LE(0, 8)          // method 0 = store
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(size, 18)      // compressed size
    local.writeUInt32LE(size, 22)      // uncompressed size
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)         // extra length
    chunks.push(local, name, e.data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)    // central directory signature
    cd.writeUInt16LE(20, 4)            // version made by
    cd.writeUInt16LE(20, 6)            // version needed
    cd.writeUInt16LE(0, 8)             // flags
    cd.writeUInt16LE(0, 10)            // method
    cd.writeUInt16LE(dosTime, 12)
    cd.writeUInt16LE(dosDate, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(size, 20)
    cd.writeUInt32LE(size, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt16LE(0, 30)            // extra length
    cd.writeUInt16LE(0, 32)            // comment length
    cd.writeUInt16LE(0, 34)            // disk number start
    cd.writeUInt16LE(0, 36)            // internal attrs
    cd.writeUInt32LE(0, 38)            // external attrs
    cd.writeUInt32LE(offset, 42)       // offset of local header
    central.push(cd, name)

    offset += local.length + name.length + e.data.length
  }

  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)    // end of central directory signature
  eocd.writeUInt16LE(0, 4)             // disk number
  eocd.writeUInt16LE(0, 6)             // cd start disk
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)       // cd offset
  eocd.writeUInt16LE(0, 20)            // comment length

  return Buffer.concat([...chunks, cdBuf, eocd])
}
