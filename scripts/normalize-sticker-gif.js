#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SIPS_PATH = "/usr/bin/sips";
const POWERSHELL_PATH = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  : "powershell.exe";
const DEFAULT_SIZE = 240;

function main() {
  const args = process.argv.slice(2);
  const inputPath = readFlag(args, "--input");
  const outputPath = readFlag(args, "--output");
  const size = Number.parseInt(readFlag(args, "--size") || String(DEFAULT_SIZE), 10);

  if (!inputPath || !outputPath) {
    throw new Error("Usage: normalize-sticker-gif.js --input <path> --output <path> [--size 240]");
  }
  const resolvedInputPath = path.resolve(inputPath);
  const resolvedOutputPath = path.resolve(outputPath);
  if (!fs.existsSync(resolvedInputPath)) {
    throw new Error(`Input file does not exist: ${resolvedInputPath}`);
  }
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });

  const inputExt = path.extname(resolvedInputPath).toLowerCase();
  if (inputExt === ".gif") {
    fs.copyFileSync(resolvedInputPath, resolvedOutputPath);
    return;
  }

  const normalizedSize = Number.isInteger(size) && size > 0 ? size : DEFAULT_SIZE;

  if (process.platform === "win32") {
    normalizeWithWindowsPowershell({
      inputPath: resolvedInputPath,
      outputPath: resolvedOutputPath,
      size: normalizedSize,
    });
    return;
  }

  if (process.platform !== "darwin") {
    throw new Error("Sticker GIF normalization for non-GIF inputs currently requires macOS `sips` or Windows PowerShell.");
  }
  if (!fs.existsSync(SIPS_PATH)) {
    throw new Error(`Required tool missing: ${SIPS_PATH}`);
  }

  const result = spawnSync(SIPS_PATH, [
    "-s", "format", "gif",
    "-z", String(normalizedSize), String(normalizedSize),
    resolvedInputPath,
    "--out", resolvedOutputPath,
  ], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    throw new Error(`sips gif normalization failed: ${stderr || stdout || `exit ${result.status}`}`);
  }
  if (!fs.existsSync(resolvedOutputPath)) {
    throw new Error(`GIF normalization produced no output: ${resolvedOutputPath}`);
  }
}

function normalizeWithWindowsPowershell({ inputPath, outputPath, size }) {
  if (!fs.existsSync(POWERSHELL_PATH)) {
    throw new Error(`Required tool missing: ${POWERSHELL_PATH}`);
  }
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    `$inputPath = ${toPowershellString(inputPath)}`,
    `$outputPath = ${toPowershellString(outputPath)}`,
    `$size = ${Number(size)}`,
    "$image = [System.Drawing.Image]::FromFile($inputPath)",
    "$bitmap = New-Object System.Drawing.Bitmap $size, $size",
    "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
    "$graphics.Clear([System.Drawing.Color]::Transparent)",
    "$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
    "$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality",
    "$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality",
    "$scale = [Math]::Min($size / $image.Width, $size / $image.Height)",
    "$drawWidth = [int][Math]::Round($image.Width * $scale)",
    "$drawHeight = [int][Math]::Round($image.Height * $scale)",
    "$offsetX = [int][Math]::Floor(($size - $drawWidth) / 2)",
    "$offsetY = [int][Math]::Floor(($size - $drawHeight) / 2)",
    "$destRect = New-Object System.Drawing.Rectangle $offsetX, $offsetY, $drawWidth, $drawHeight",
    "$graphics.DrawImage($image, $destRect)",
    "$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Gif)",
    "$graphics.Dispose()",
    "$bitmap.Dispose()",
    "$image.Dispose()",
  ].join("; ");
  const result = spawnSync(POWERSHELL_PATH, [
    "-NoProfile",
    "-Command",
    script,
  ], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    throw new Error(`powershell gif normalization failed: ${stderr || stdout || `exit ${result.status}`}`);
  }
  if (!fs.existsSync(outputPath)) {
    throw new Error(`GIF normalization produced no output: ${outputPath}`);
  }
}

function readFlag(args, flag) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      return String(args[index + 1] || "").trim();
    }
  }
  return "";
}

function toPowershellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || "unknown error");
  console.error(message);
  process.exit(1);
}
