import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const outputDirectory = path.join(process.cwd(), "sample-work");
await fs.mkdir(outputDirectory, { recursive: true });

const samples = [
  ["01-negative-distribution.jpeg", ["−3(x + 4) = 0", "x + 4 = 0", "x = 4"]],
  ["02-partial-distribution.jpeg", ["3(2a + 5)", "= 6a + 5"]],
  ["03-equation-balance.jpeg", ["2x + 5 = 17", "2x = 22", "x = 11"]],
  ["04-unlike-terms.jpeg", ["4x + 3 + 2x", "= 9x"]],
  ["05-correct-distribution.jpeg", ["−2(y − 6)", "= −2y + 12"]],
  ["06-fraction-addition.jpeg", ["2/3 + 1/4", "= 3/7"]],
  ["07-fraction-size.jpeg", ["3/8 > 3/5", "because 8 > 5"]],
  ["08-correct-equation.jpeg", ["3x − 7 = 11", "3x = 18", "x = 6"]],
];

for (const [filename, workLines] of samples) {
  const ruledLines = Array.from(
    { length: 17 },
    (_, index) =>
      `<line x1="90" y1="${210 + index * 76}" x2="1110" y2="${210 + index * 76}" stroke="#a8c8db" stroke-width="2" opacity="0.55"/>`,
  ).join("");
  const mathLines = workLines
    .map(
      (line, index) =>
        `<text x="${220 + index * 18}" y="${420 + index * 170}" transform="rotate(${index % 2 ? -1.2 : 0.8} ${220 + index * 18} ${420 + index * 170})" font-family="Bradley Hand, Comic Sans MS, cursive" font-size="72" font-weight="500" fill="#18251f">${escapeXml(line)}</text>`,
    )
    .join("");
  const svg = `
    <svg width="1200" height="1600" viewBox="0 0 1200 1600" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="paper" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="2" seed="7" result="noise"/>
          <feColorMatrix in="noise" type="saturate" values="0" result="gray"/>
          <feComponentTransfer in="gray" result="faint"><feFuncA type="table" tableValues="0 0.035"/></feComponentTransfer>
          <feBlend in="SourceGraphic" in2="faint" mode="multiply"/>
        </filter>
      </defs>
      <rect width="1200" height="1600" fill="#f8f4e8" filter="url(#paper)"/>
      ${ruledLines}
      <line x1="150" y1="80" x2="150" y2="1530" stroke="#dc8a86" stroke-width="3" opacity="0.55"/>
      <g>${mathLines}</g>
    </svg>`;

  await sharp(Buffer.from(svg))
    .jpeg({ quality: 91, chromaSubsampling: "4:4:4" })
    .toFile(path.join(outputDirectory, filename));
}

const fullPageLines = [
  ["1.1", "−3(x + 4) = −3x + 12"],
  ["1.2", "−(2y − 5) = −2y + 5"],
  ["2.1", "−2(a + 7) = −2a + 14"],
  ["2.2", "−4(m − 3) = −4m + 12"],
  ["3.1", "2x + 5 = 17 ; 2x = 12 ; x = 6"],
];
const fullPageRules = Array.from(
  { length: 24 },
  (_, index) =>
    `<line x1="100" y1="${235 + index * 88}" x2="1500" y2="${235 + index * 88}" stroke="#a8c8db" stroke-width="2" opacity="0.55"/>`,
).join("");
const fullPageWork = fullPageLines
  .map(
    ([label, line], index) => `
      <text x="190" y="${410 + index * 360}" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#31453d">${label}</text>
      <text x="300" y="${410 + index * 360}" transform="rotate(${index % 2 ? -0.8 : 0.6} 300 ${410 + index * 360})" font-family="Bradley Hand, Comic Sans MS, cursive" font-size="62" fill="#18251f">${escapeXml(line)}</text>`,
  )
  .join("");
const fullPageSvg = `
  <svg width="1600" height="2300" viewBox="0 0 1600 2300" xmlns="http://www.w3.org/2000/svg">
    <rect width="1600" height="2300" fill="#f8f4e8"/>
    ${fullPageRules}
    <line x1="145" y1="90" x2="145" y2="2220" stroke="#dc8a86" stroke-width="3" opacity="0.55"/>
    <text x="190" y="150" font-family="Arial, sans-serif" font-size="34" fill="#65766f">Copie synthétique · sans nom d’élève</text>
    ${fullPageWork}
  </svg>`;
await sharp(Buffer.from(fullPageSvg))
  .jpeg({ quality: 91, chromaSubsampling: "4:4:4" })
  .toFile(path.join(outputDirectory, "09-full-page-followup.jpeg"));

console.log(`Generated ${samples.length + 1} synthetic handwriting samples in sample-work/.`);

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
