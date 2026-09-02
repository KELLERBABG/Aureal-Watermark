const fs = require("node:fs");
const buf = fs.readFileSync("assets/icon.ico");
const count = buf.readUInt16LE(4);
console.log("Image count in assets/icon.ico:", count);
for (let i = 0; i < count; i++) {
  const o = 6 + i * 16;
  const w = buf[o] || 256;
  const h = buf[o+1] || 256;
  const bpp = buf.readUInt16LE(o+6);
  const size = buf.readUInt32LE(o+8);
  const offset = buf.readUInt32LE(o+12);
  const magic = buf.slice(offset, offset + 4).toString("hex");
  console.log(`Entry ${i}: ${w}x${h}, bpp: ${bpp}, size: ${size}, offset: ${offset}, headerMagic: ${magic}`);
}
