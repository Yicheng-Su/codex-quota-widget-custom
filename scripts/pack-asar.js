"use strict";

// A deliberately small, dependency-free ASAR writer for the files shipped by
// this project. It implements Chromium Pickle framing and Electron's per-file
// SHA-256 integrity metadata, then reads the archive back before reporting
// success. It is not intended to be a general replacement for @electron/asar.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const INTEGRITY_ALGORITHM = "SHA256";
const INTEGRITY_BLOCK_SIZE = 4 * 1024 * 1024;
const UINT32_MAX = 0xffffffff;

function align4(value) {
  return value + ((4 - (value % 4)) % 4);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function getIntegrity(buffer) {
  const blocks = [];
  for (let offset = 0; offset < buffer.length; offset += INTEGRITY_BLOCK_SIZE) {
    blocks.push(sha256(buffer.subarray(offset, Math.min(offset + INTEGRITY_BLOCK_SIZE, buffer.length))));
  }
  if (blocks.length === 0) blocks.push(sha256(buffer));
  return {
    algorithm: INTEGRITY_ALGORITHM,
    hash: sha256(buffer),
    blockSize: INTEGRITY_BLOCK_SIZE,
    blocks
  };
}

function makeUInt32Pickle(value) {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new Error(`UInt32 Pickle value is out of range: ${value}`);
  }
  const pickle = Buffer.alloc(8);
  pickle.writeUInt32LE(4, 0); // Pickle payload size.
  pickle.writeUInt32LE(value, 4);
  return pickle;
}

function makeStringPickle(value) {
  const bytes = Buffer.from(value, "utf8");
  const paddedLength = align4(bytes.length);
  const payloadLength = 4 + paddedLength; // String length prefix + padded UTF-8 bytes.
  if (payloadLength > UINT32_MAX) throw new Error("ASAR JSON header is too large.");

  const pickle = Buffer.alloc(4 + payloadLength);
  pickle.writeUInt32LE(payloadLength, 0);
  pickle.writeUInt32LE(bytes.length, 4);
  bytes.copy(pickle, 8);
  return pickle;
}

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateRelativeArchivePath(relativePath) {
  if (!relativePath || relativePath.includes("\0") || relativePath.includes("\\")) {
    throw new Error(`Invalid archive path: ${JSON.stringify(relativePath)}`);
  }
  if (path.posix.isAbsolute(relativePath)) throw new Error(`Archive path must be relative: ${relativePath}`);
  const parts = relativePath.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === ".." || part.includes("/") || part.includes("\\")) {
      throw new Error(`Invalid archive path segment in: ${relativePath}`);
    }
  }
}

function collectDirectory(rootPath, relativeDirectory, files) {
  const absoluteDirectory = path.join(rootPath, ...relativeDirectory.split("/").filter(Boolean));
  const directoryStat = fs.lstatSync(absoluteDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`Expected a real directory, not a link: ${absoluteDirectory}`);
  }

  const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
  entries.sort((left, right) => compareOrdinal(left.name, right.name));
  for (const entry of entries) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    validateRelativeArchivePath(relativePath);
    const absolutePath = path.join(absoluteDirectory, entry.name);
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) throw new Error(`Refusing to package a symbolic link: ${absolutePath}`);
    if (stat.isDirectory()) {
      collectDirectory(rootPath, relativePath, files);
    } else if (stat.isFile()) {
      files.push({ relativePath, absolutePath, size: stat.size });
    } else {
      throw new Error(`Unsupported filesystem entry: ${absolutePath}`);
    }
  }
}

function collectProjectFiles(projectRoot) {
  const root = fs.realpathSync.native(path.resolve(projectRoot));
  const files = [];

  const packagePath = path.join(root, "package.json");
  const packageStat = fs.lstatSync(packagePath);
  if (!packageStat.isFile() || packageStat.isSymbolicLink()) {
    throw new Error(`Missing regular package.json: ${packagePath}`);
  }
  files.push({ relativePath: "package.json", absolutePath: packagePath, size: packageStat.size });

  collectDirectory(root, "src", files);
  for (const name of ["icon.icns", "icon.ico", "icon.png"]) {
    const relativePath = `assets/${name}`;
    const absolutePath = path.join(root, "assets", name);
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Missing regular asset: ${absolutePath}`);
    }
    files.push({ relativePath, absolutePath, size: stat.size });
  }

  files.sort((left, right) => compareOrdinal(left.relativePath, right.relativePath));
  const caseFolded = new Set();
  for (const file of files) {
    validateRelativeArchivePath(file.relativePath);
    const key = file.relativePath.toUpperCase();
    if (caseFolded.has(key)) throw new Error(`Case-insensitive duplicate archive path: ${file.relativePath}`);
    caseFolded.add(key);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > UINT32_MAX) {
      throw new Error(`File is too large for this ASAR writer: ${file.absolutePath}`);
    }
  }
  return { root, files };
}

function insertHeaderFile(rootHeader, relativePath, metadata) {
  const parts = relativePath.split("/");
  let node = rootHeader;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const name = parts[index];
    if (!node.files[name]) node.files[name] = { files: Object.create(null) };
    if (!node.files[name].files) throw new Error(`ASAR path collision at ${relativePath}`);
    node = node.files[name];
  }
  const fileName = parts[parts.length - 1];
  if (node.files[fileName]) throw new Error(`Duplicate ASAR entry: ${relativePath}`);
  node.files[fileName] = metadata;
}

function buildArchive(projectRoot) {
  const collected = collectProjectFiles(projectRoot);
  const header = { files: Object.create(null) };
  const payloads = [];
  let offset = 0n;

  for (const file of collected.files) {
    const data = fs.readFileSync(file.absolutePath);
    if (data.length !== file.size) throw new Error(`File changed while being packaged: ${file.absolutePath}`);
    insertHeaderFile(header, file.relativePath, {
      size: data.length,
      offset: offset.toString(),
      integrity: getIntegrity(data)
    });
    payloads.push(data);
    offset += BigInt(data.length);
  }

  const headerString = JSON.stringify(header);
  const headerPickle = makeStringPickle(headerString);
  const sizePickle = makeUInt32Pickle(headerPickle.length);
  return {
    archive: Buffer.concat([sizePickle, headerPickle, ...payloads]),
    fileCount: collected.files.length,
    payloadBytes: Number(offset),
    headerBytes: sizePickle.length + headerPickle.length
  };
}

function parseArchiveHeader(archive) {
  if (archive.length < 16) throw new Error("Invalid ASAR: archive is shorter than the Pickle header.");
  if (archive.readUInt32LE(0) !== 4) throw new Error("Invalid ASAR: outer Pickle payload size is not 4.");

  const headerPickleSize = archive.readUInt32LE(4);
  if (headerPickleSize < 8 || headerPickleSize > archive.length - 8) {
    throw new Error("Invalid ASAR: header Pickle size is outside the archive.");
  }
  const headerPayloadSize = archive.readUInt32LE(8);
  if (headerPayloadSize + 4 !== headerPickleSize) {
    throw new Error("Invalid ASAR: header Pickle payload length is inconsistent.");
  }
  const jsonLength = archive.readUInt32LE(12);
  if (jsonLength > headerPayloadSize - 4) throw new Error("Invalid ASAR: JSON length exceeds the Pickle payload.");

  const jsonStart = 16;
  const jsonEnd = jsonStart + jsonLength;
  const headerEnd = 8 + headerPickleSize;
  for (let index = jsonEnd; index < headerEnd; index += 1) {
    if (archive[index] !== 0) throw new Error("Invalid ASAR: non-zero Pickle padding.");
  }

  let header;
  try {
    header = JSON.parse(archive.toString("utf8", jsonStart, jsonEnd));
  } catch (error) {
    throw new Error(`Invalid ASAR JSON header: ${error.message}`);
  }
  return { header, dataOffset: headerEnd };
}

function flattenHeader(node, prefix, output) {
  if (!node || typeof node !== "object" || Array.isArray(node) || !node.files || typeof node.files !== "object") {
    throw new Error(`Invalid ASAR directory entry: ${prefix || "/"}`);
  }
  for (const [name, entry] of Object.entries(node.files)) {
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
      throw new Error(`Invalid ASAR entry name: ${name}`);
    }
    const relativePath = prefix ? `${prefix}/${name}` : name;
    if (entry && typeof entry === "object" && entry.files) {
      flattenHeader(entry, relativePath, output);
    } else {
      output.push({ relativePath, entry });
    }
  }
}

function verifyIntegrity(data, integrity, relativePath) {
  if (!integrity || integrity.algorithm !== INTEGRITY_ALGORITHM || integrity.blockSize !== INTEGRITY_BLOCK_SIZE) {
    throw new Error(`Invalid integrity metadata: ${relativePath}`);
  }
  const expected = getIntegrity(data);
  if (integrity.hash !== expected.hash) throw new Error(`SHA-256 mismatch: ${relativePath}`);
  if (!Array.isArray(integrity.blocks) || integrity.blocks.length !== expected.blocks.length) {
    throw new Error(`Integrity block count mismatch: ${relativePath}`);
  }
  for (let index = 0; index < expected.blocks.length; index += 1) {
    if (integrity.blocks[index] !== expected.blocks[index]) {
      throw new Error(`Integrity block mismatch at ${index}: ${relativePath}`);
    }
  }
}

function verifyArchiveBuffer(archive) {
  const parsed = parseArchiveHeader(archive);
  const files = [];
  flattenHeader(parsed.header, "", files);
  files.sort((left, right) => {
    const leftOffset = BigInt(String(left.entry && left.entry.offset));
    const rightOffset = BigInt(String(right.entry && right.entry.offset));
    return leftOffset < rightOffset ? -1 : leftOffset > rightOffset ? 1 : 0;
  });

  let nextOffset = 0n;
  const seen = new Set();
  for (const file of files) {
    validateRelativeArchivePath(file.relativePath);
    const key = file.relativePath.toUpperCase();
    if (seen.has(key)) throw new Error(`Case-insensitive duplicate in ASAR: ${file.relativePath}`);
    seen.add(key);

    const entry = file.entry;
    if (!entry || typeof entry !== "object" || !/^\d+$/.test(String(entry.offset))) {
      throw new Error(`Invalid file offset: ${file.relativePath}`);
    }
    const offset = BigInt(entry.offset);
    if (offset !== nextOffset) throw new Error(`Non-contiguous ASAR payload at: ${file.relativePath}`);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > UINT32_MAX) {
      throw new Error(`Invalid file size: ${file.relativePath}`);
    }
    const absoluteStartBig = BigInt(parsed.dataOffset) + offset;
    const absoluteEndBig = absoluteStartBig + BigInt(entry.size);
    if (absoluteEndBig > BigInt(archive.length)) throw new Error(`ASAR file extends beyond archive: ${file.relativePath}`);
    const absoluteStart = Number(absoluteStartBig);
    const absoluteEnd = Number(absoluteEndBig);
    verifyIntegrity(archive.subarray(absoluteStart, absoluteEnd), entry.integrity, file.relativePath);
    nextOffset += BigInt(entry.size);
  }
  if (BigInt(parsed.dataOffset) + nextOffset !== BigInt(archive.length)) {
    throw new Error("Invalid ASAR: trailing or unindexed payload bytes were found.");
  }
  return { fileCount: files.length, payloadBytes: Number(nextOffset), headerBytes: parsed.dataOffset };
}

function writeArchive(projectRoot, outputPath) {
  const output = path.resolve(outputPath);
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite an existing ASAR: ${output}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });

  const built = buildArchive(projectRoot);
  const verified = verifyArchiveBuffer(built.archive);
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, built.archive, { flag: "wx" });
    fs.renameSync(temporary, output);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* Best-effort cleanup. */ }
    throw error;
  }
  return { output, ...verified, sha256: sha256(built.archive), archiveBytes: built.archive.length };
}

function verifyArchiveFile(archivePath) {
  const input = path.resolve(archivePath);
  const archive = fs.readFileSync(input);
  return { input, ...verifyArchiveBuffer(archive), sha256: sha256(archive), archiveBytes: archive.length };
}

function readValue(args, index, option) {
  if (index + 1 >= args.length || args[index + 1].startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return args[index + 1];
}

function parseArguments(argv) {
  const options = { root: path.resolve(__dirname, ".."), output: null, verify: null };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--root") options.root = readValue(argv, index++, option);
    else if (option === "--output") options.output = readValue(argv, index++, option);
    else if (option === "--verify") options.verify = readValue(argv, index++, option);
    else if (option === "--help" || option === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${option}`);
  }
  return options;
}

function printHelp() {
  process.stdout.write(
    "Usage:\n" +
    "  node scripts/pack-asar.js --root <project> --output <app.asar>\n" +
    "  node scripts/pack-asar.js --verify <app.asar>\n"
  );
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = options.verify
    ? verifyArchiveFile(options.verify)
    : options.output
      ? writeArchive(options.root, options.output)
      : (() => { throw new Error("--output is required when creating an ASAR."); })();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[pack-asar] ${error && error.stack ? error.stack : error}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildArchive, verifyArchiveBuffer, verifyArchiveFile, writeArchive };
