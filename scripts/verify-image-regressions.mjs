import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import sharp from "sharp";

import {
  MATH_IMAGE_PREPROCESSING_VERSION,
  prepareOriginalImageFallback,
  preprocessMathImage,
  preprocessStudentPageImage,
} from "../src/server/storage/image-preprocessing.mjs";

const fixturePath =
  "fixtures/student-work/sign-error-equals-regression.jpeg";
const expectedFixtureHash =
  "3953d0baf5eda0b8913c2e7de5cd38529053779d8f42ea337af4f3ee5da5a6c4";

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function syntheticWork(lines) {
  const escaped = lines.map((line) =>
    line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
  );
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000">
      <rect width="1600" height="1000" fill="#eee9dd"/>
      <g fill="#24211f" font-family="Comic Sans MS, cursive" font-size="62" font-style="italic">
        ${escaped.map((line, index) => `<text x="470" y="${250 + index * 150}">${line}</text>`).join("")}
      </g>
    </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 91 }).toBuffer();
}

async function verifyPreparedImage(label, bytes) {
  const result = await preprocessMathImage(bytes);
  assert.equal(result.preprocessingVersion, MATH_IMAGE_PREPROCESSING_VERSION);
  assert.equal(result.crop.cropApplied, true, `${label} should crop blank paper`);
  assert.equal(result.downscaled, false, `${label} should not downscale small ink`);
  assert.ok(
    Math.max(result.width, result.height) >= 1_800,
    `${label} should preserve a high-detail long edge`,
  );
  assert.ok(result.crop.width < result.sourceWidth, `${label} crop should narrow`);
  assert.ok(result.crop.height < result.sourceHeight, `${label} crop should shorten`);
  return result;
}

const fixture = await readFile(fixturePath);
assert.equal(hash(fixture), expectedFixtureHash, "the live regression fixture changed");
const regression = await verifyPreparedImage("equals-sign regression", fixture);
assert.equal(regression.sourceWidth, 1600);
assert.equal(regression.sourceHeight, 900);
assert.ok(regression.crop.left <= 470, "leftmost negative sign must remain visible");
assert.ok(
  regression.crop.left + regression.crop.width >= 980,
  "right-hand zeros and equals strokes must remain visible",
);
assert.ok(regression.crop.top <= 60, "first equation must remain visible");
assert.ok(
  regression.crop.top + regression.crop.height >= 480,
  "final equation must remain visible",
);
assert.ok(regression.scale >= 3, "small source ink should be enlarged for vision");
const fallback = await prepareOriginalImageFallback(fixture);
assert.equal(fallback.width, 1600, "fallback must preserve full source width");
assert.equal(fallback.height, 900, "fallback must preserve full source height");

const distribution = await verifyPreparedImage(
  "earlier distribution sample",
  await syntheticWork(["−(x + 4) = −x + 4"]),
);
assert.ok(distribution.crop.candidateCount > 100);
assert.ok(
  distribution.crop.left + distribution.crop.width >= 980,
  "the detached final + 4 must remain inside the distribution crop",
);

const fraction = await verifyPreparedImage(
  "earlier fraction sample",
  await syntheticWork(["1/2 + 1/3 = 2/5"]),
);
assert.ok(fraction.crop.candidateCount > 100);
assert.ok(
  fraction.crop.left + fraction.crop.width >= 970,
  "the final fraction must remain inside the fraction crop",
);

const faintSvg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900">
    <rect width="1400" height="900" fill="#e7e4dc"/>
    <g fill="none" stroke="#b9b6af" stroke-width="5" stroke-linecap="round">
      <path d="M420 300h120 M420 315h120"/>
      <path d="M570 307h90"/>
      <path d="M690 300h120 M690 315h120"/>
    </g>
  </svg>`);
const faint = await preprocessMathImage(
  await sharp(faintSvg).jpeg({ quality: 94 }).toBuffer(),
);
const faintPixels = await sharp(faint.bytes).greyscale().raw().toBuffer();
const retainedFaintPixels = faintPixels.reduce(
  (count, value) => count + (value < 245 ? 1 : 0),
  0,
);
assert.ok(
  retainedFaintPixels > 300,
  "adaptive normalization must retain faint strokes below the old fixed -38 floor",
);

const fullPage = await preprocessStudentPageImage(
  await syntheticWork(["1. x + 4 = 0", "2. 1/2 + 1/3 = 2/5"]),
);
assert.equal(fullPage.crop.cropApplied, false, "full student pages must skip ink crop");
assert.equal(fullPage.crop.left, 0);
assert.equal(fullPage.crop.top, 0);
assert.equal(fullPage.crop.width, fullPage.sourceWidth);
assert.equal(fullPage.crop.height, fullPage.sourceHeight);

console.log(
  "Image regression verification passed: live fixture, faint-ink adaptive normalization, full-frame fallback, full-page no-crop, and earlier samples all retain OCR detail.",
);
