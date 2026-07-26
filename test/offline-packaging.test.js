const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildArchive, verifyArchiveBuffer } = require("../scripts/pack-asar");

const projectRoot = path.join(__dirname, "..");

test("dependency-free ASAR writer packages and verifies the current runtime files", () => {
  const built = buildArchive(projectRoot);
  const verified = verifyArchiveBuffer(built.archive);

  assert.ok(verified.fileCount >= 18);
  assert.ok(verified.payloadBytes > 800_000);
  assert.equal(verified.headerBytes + verified.payloadBytes, built.archive.length);
});

test("ASAR verification rejects payload tampering", () => {
  const built = buildArchive(projectRoot);
  const tampered = Buffer.from(built.archive);
  tampered[tampered.length - 1] ^= 0xff;

  assert.throws(() => verifyArchiveBuffer(tampered), /SHA-256|Integrity block/);
});

test("offline portable launcher validates its footer and blocks ZIP path traversal", () => {
  const launcher = fs.readFileSync(path.join(projectRoot, "scripts", "PortableLauncher.cs"), "utf8");
  const buildScript = fs.readFileSync(path.join(projectRoot, "scripts", "build-custom-portable.ps1"), "utf8");

  assert.match(launcher, /CQWZIP-PAYLOAD01/);
  assert.match(launcher, /StartsWith\(root, StringComparison\.OrdinalIgnoreCase\)/);
  assert.match(launcher, /FileMode\.CreateNew/);
  assert.doesNotMatch(launcher, /SetForegroundWindow|SendInput|Alt\+Tab/);
  assert.match(buildScript, /Assert-BuildRoot/);
  assert.match(buildScript, /recordedMagic -ne 'CQWZIP-PAYLOAD01'/);
});

test("offline build compiles a restricted native approval helper into resources", () => {
  const helper = fs.readFileSync(path.join(projectRoot, "scripts", "ApprovalHelper.cs"), "utf8");
  const buildScript = fs.readFileSync(path.join(projectRoot, "scripts", "build-custom-portable.ps1"), "utf8");
  const bridge = fs.readFileSync(path.join(projectRoot, "src", "main", "windows-approval-input.js"), "utf8");

  assert.match(buildScript, /ApprovalHelper\.cs/);
  assert.match(buildScript, /ChatGPTQuotaApprovalHelper\.exe/);
  assert.match(helper, /action != "insert" && action != "submit"/);
  assert.match(helper, /SendUnicodeText\("批准"\)/);
  assert.match(helper, /WaitForBlockingModifiersToRelease\(750\)/);
  assert.match(helper, /Thread\.Sleep\(10\)/);
  assert.doesNotMatch(helper, /SetForegroundWindow|Clipboard|keybd_event/);
  assert.match(bridge, /runApprovalHelper/);
  assert.match(bridge, /const runner = options\.runner \|\| \(\(request\) => runApprovalHelper/);
});
