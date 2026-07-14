import sharp from "sharp";

export const MATH_IMAGE_PREPROCESSING_VERSION = "2.0.1";
export const WORKSHEET_IMAGE_PREPROCESSING_VERSION = "1.0.0";

const MAX_INPUT_PIXELS = 40_000_000;
const ANALYSIS_LONG_EDGE = 1_800;
const OUTPUT_MIN_LONG_EDGE = 1_800;
const OUTPUT_MAX_LONG_EDGE = 3_200;

/**
 * @param {number} value
 * @param {number} minimum
 * @param {number} maximum
 */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * @param {Buffer | Uint8Array} orientedBytes
 * @param {number} width
 * @param {number} height
 */
async function locateInk(orientedBytes, width, height) {
  const analysisScale = Math.min(1, ANALYSIS_LONG_EDGE / Math.max(width, height));
  const analysisWidth = Math.max(1, Math.round(width * analysisScale));
  const analysisHeight = Math.max(1, Math.round(height * analysisScale));
  const analysis = await sharp(orientedBytes)
    .resize(analysisWidth, analysisHeight, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = await sharp(analysis.data, {
    raw: {
      width: analysis.info.width,
      height: analysis.info.height,
      channels: 1,
    },
  })
    .blur(Math.max(8, Math.min(24, analysis.info.width / 80)))
    .raw()
    .toBuffer();

  const candidates = new Uint8Array(analysis.info.width * analysis.info.height);
  let candidateCount = 0;

  for (let index = 0; index < analysis.data.length; index += 1) {
    const localContrast = background[index] - analysis.data[index];
    const isInk = localContrast >= 116 && analysis.data[index] <= 90;
    if (!isInk) continue;

    candidates[index] = 1;
    candidateCount += 1;
  }

  if (candidateCount < 24) {
    return {
      left: 0,
      top: 0,
      width,
      height,
      cropApplied: false,
      candidateCount,
    };
  }

  /** @type {Array<{left: number; right: number; top: number; bottom: number; size: number}>} */
  const inkComponents = [];
  /** @type {number[]} */
  const stack = [];
  const analysisArea = analysis.info.width * analysis.info.height;
  const minimumComponentSize = Math.max(10, Math.floor(analysisArea / 160_000));
  for (let seed = 0; seed < candidates.length; seed += 1) {
    if (candidates[seed] === 0) continue;
    candidates[seed] = 0;
    stack.push(seed);
    let size = 0;
    let componentLeft = analysis.info.width;
    let componentRight = -1;
    let componentTop = analysis.info.height;
    let componentBottom = -1;

    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) break;
      const y = Math.floor(index / analysis.info.width);
      const x = index - y * analysis.info.width;
      size += 1;
      componentLeft = Math.min(componentLeft, x);
      componentRight = Math.max(componentRight, x);
      componentTop = Math.min(componentTop, y);
      componentBottom = Math.max(componentBottom, y);

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const neighborY = y + offsetY;
        if (neighborY < 0 || neighborY >= analysis.info.height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const neighborX = x + offsetX;
          if (neighborX < 0 || neighborX >= analysis.info.width) continue;
          const neighbor = neighborY * analysis.info.width + neighborX;
          if (candidates[neighbor] === 0) continue;
          candidates[neighbor] = 0;
          stack.push(neighbor);
        }
      }
    }

    const componentWidth = componentRight - componentLeft + 1;
    const componentHeight = componentBottom - componentTop + 1;
    const componentDensity = size / (componentWidth * componentHeight);
    const touchesEdge =
      componentLeft === 0 ||
      componentTop === 0 ||
      componentRight === analysis.info.width - 1 ||
      componentBottom === analysis.info.height - 1;
    const looksLikeInk =
      size >= minimumComponentSize &&
      componentDensity >= 0.035 &&
      componentWidth <= analysis.info.width * 0.45 &&
      componentHeight <= analysis.info.height * 0.45 &&
      !touchesEdge;
    if (looksLikeInk) {
      inkComponents.push({
        left: componentLeft,
        right: componentRight,
        top: componentTop,
        bottom: componentBottom,
        size,
      });
    }
  }

  // A handwritten operator or final term can be detached from the preceding
  // glyphs by a surprisingly wide space. Keep components on the same solving
  // line connected so an expression like "-x + 4" is not cropped after x.
  const horizontalGap = Math.max(72, Math.round(analysis.info.width * 0.12));
  const verticalGap = Math.max(64, Math.round(analysis.info.height * 0.16));
  /** @type {Array<{left: number; right: number; top: number; bottom: number; size: number; componentCount: number}>} */
  const clusters = [];
  for (const component of inkComponents.sort((a, b) => b.size - a.size)) {
    let cluster = clusters.find(
      (candidate) =>
        component.left <= candidate.right + horizontalGap &&
        component.right >= candidate.left - horizontalGap &&
        component.top <= candidate.bottom + verticalGap &&
        component.bottom >= candidate.top - verticalGap,
    );
    if (!cluster) {
      cluster = { ...component, size: 0, componentCount: 0 };
      clusters.push(cluster);
    }
    cluster.left = Math.min(cluster.left, component.left);
    cluster.right = Math.max(cluster.right, component.right);
    cluster.top = Math.min(cluster.top, component.top);
    cluster.bottom = Math.max(cluster.bottom, component.bottom);
    cluster.size += component.size;
    cluster.componentCount += 1;
  }

  // The size-ordered pass above can create two partial clusters before a small
  // bridge glyph (often an equals stroke or plus sign) is considered. Merge
  // adjacent clusters to their transitive closure before choosing the winner.
  let mergedClusters = true;
  while (mergedClusters) {
    mergedClusters = false;
    outer: for (let leftIndex = 0; leftIndex < clusters.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < clusters.length;
        rightIndex += 1
      ) {
        const leftCluster = clusters[leftIndex];
        const rightCluster = clusters[rightIndex];
        const adjacent =
          rightCluster.left <= leftCluster.right + horizontalGap &&
          rightCluster.right >= leftCluster.left - horizontalGap &&
          rightCluster.top <= leftCluster.bottom + verticalGap &&
          rightCluster.bottom >= leftCluster.top - verticalGap;
        if (!adjacent) continue;

        leftCluster.left = Math.min(leftCluster.left, rightCluster.left);
        leftCluster.right = Math.max(leftCluster.right, rightCluster.right);
        leftCluster.top = Math.min(leftCluster.top, rightCluster.top);
        leftCluster.bottom = Math.max(leftCluster.bottom, rightCluster.bottom);
        leftCluster.size += rightCluster.size;
        leftCluster.componentCount += rightCluster.componentCount;
        clusters.splice(rightIndex, 1);
        mergedClusters = true;
        break outer;
      }
    }
  }

  const bestCluster = clusters.sort(
    (a, b) =>
      b.size * Math.log2(b.componentCount + 1) -
      a.size * Math.log2(a.componentCount + 1),
  )[0];
  const left = bestCluster?.left ?? analysis.info.width;
  const right = bestCluster?.right ?? -1;
  const top = bestCluster?.top ?? analysis.info.height;
  const bottom = bestCluster?.bottom ?? -1;

  if (right < left || bottom < top) {
    return {
      left: 0,
      top: 0,
      width,
      height,
      cropApplied: false,
      candidateCount,
    };
  }

  const inkWidth = right - left + 1;
  const inkHeight = bottom - top + 1;
  const horizontalPadding = Math.max(32, Math.round(inkWidth * 0.13));
  const verticalPadding = Math.max(32, Math.round(inkHeight * 0.13));
  const analysisLeft = clamp(left - horizontalPadding, 0, analysis.info.width - 1);
  const analysisTop = clamp(top - verticalPadding, 0, analysis.info.height - 1);
  const analysisRight = clamp(
    right + horizontalPadding,
    analysisLeft,
    analysis.info.width - 1,
  );
  const analysisBottom = clamp(
    bottom + verticalPadding,
    analysisTop,
    analysis.info.height - 1,
  );
  const inverseScale = 1 / analysisScale;
  const cropLeft = clamp(Math.floor(analysisLeft * inverseScale), 0, width - 1);
  const cropTop = clamp(Math.floor(analysisTop * inverseScale), 0, height - 1);
  const cropRight = clamp(
    Math.ceil((analysisRight + 1) * inverseScale),
    cropLeft + 1,
    width,
  );
  const cropBottom = clamp(
    Math.ceil((analysisBottom + 1) * inverseScale),
    cropTop + 1,
    height,
  );

  return {
    left: cropLeft,
    top: cropTop,
    width: cropRight - cropLeft,
    height: cropBottom - cropTop,
    cropApplied:
      cropLeft > 0 || cropTop > 0 || cropRight < width || cropBottom < height,
    candidateCount,
  };
}

/**
 * Crops gradual paper shadows away from locally dark ink, then raises local
 * contrast. Small ink regions are enlarged; images are only reduced above a
 * 3200px long edge after cropping, keeping short equals-sign strokes distinct.
 *
 * @param {Buffer | Uint8Array} inputBytes
 */
export async function preprocessMathImage(inputBytes) {
  const orientedBytes = await sharp(inputBytes, {
    failOn: "warning",
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    .rotate()
    .toBuffer();
  const metadata = await sharp(orientedBytes).metadata();
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new TypeError("Image dimensions could not be read.");
  }

  const crop = await locateInk(orientedBytes, metadata.width, metadata.height);
  const cropLongEdge = Math.max(crop.width, crop.height);
  const targetLongEdge = clamp(
    cropLongEdge,
    OUTPUT_MIN_LONG_EDGE,
    OUTPUT_MAX_LONG_EDGE,
  );
  const scale = targetLongEdge / cropLongEdge;
  const outputWidth = Math.max(1, Math.round(crop.width * scale));
  const outputHeight = Math.max(1, Math.round(crop.height * scale));
  const cropped = await sharp(orientedBytes)
    .extract({
      left: crop.left,
      top: crop.top,
      width: crop.width,
      height: crop.height,
    })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const localBackground = await sharp(cropped.data, {
    raw: {
      width: cropped.info.width,
      height: cropped.info.height,
      channels: 1,
    },
  })
    .blur(Math.max(10, Math.min(26, cropped.info.width / 45)))
    .raw()
    .toBuffer();
  const normalizedPixels = Buffer.allocUnsafe(cropped.data.length);
  for (let index = 0; index < cropped.data.length; index += 1) {
    // Ignore shallow paper texture/shadows before amplifying locally dark ink.
    // The source fixture has horizontal fibres whose local contrast sits below
    // this floor, while even a short handwritten equals stroke remains far
    // above it.
    const inkContrast = Math.max(
      0,
      localBackground[index] - cropped.data[index] - 38,
    );
    normalizedPixels[index] = Math.round(
      255 - Math.min(255, inkContrast * 4),
    );
  }
  const output = await sharp(normalizedPixels, {
    raw: {
      width: cropped.info.width,
      height: cropped.info.height,
      channels: 1,
    },
  })
    .resize(outputWidth, outputHeight, { fit: "fill" })
    .sharpen({ sigma: 0.7 })
    .webp({ quality: 94, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  return {
    bytes: output.data,
    mediaType: "image/webp",
    width: output.info.width,
    height: output.info.height,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    crop,
    scale,
    downscaled: scale < 0.999,
    preprocessingVersion: MATH_IMAGE_PREPROCESSING_VERSION,
  };
}

/**
 * Normalizes a full worksheet page without using the single-answer ink-cluster
 * crop, which could otherwise discard a distant problem on the same page.
 *
 * @param {Buffer | Uint8Array} inputBytes
 */
export async function preprocessWorksheetImage(inputBytes) {
  const orientedBytes = await sharp(inputBytes, {
    failOn: "warning",
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    .rotate()
    .toBuffer();
  const metadata = await sharp(orientedBytes).metadata();
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new TypeError("Worksheet image dimensions could not be read.");
  }

  const longEdge = Math.max(metadata.width, metadata.height);
  const targetLongEdge = clamp(longEdge, 1_800, OUTPUT_MAX_LONG_EDGE);
  const scale = targetLongEdge / longEdge;
  const output = await sharp(orientedBytes)
    .resize({
      width: Math.max(1, Math.round(metadata.width * scale)),
      height: Math.max(1, Math.round(metadata.height * scale)),
      fit: "fill",
    })
    .greyscale()
    .normalize({ lower: 1, upper: 99 })
    .sharpen({ sigma: 0.65 })
    .webp({ quality: 94, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  return {
    bytes: output.data,
    mediaType: "image/webp",
    width: output.info.width,
    height: output.info.height,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    scale,
    downscaled: scale < 0.999,
    preprocessingVersion: WORKSHEET_IMAGE_PREPROCESSING_VERSION,
  };
}
