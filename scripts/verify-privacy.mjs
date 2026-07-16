import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files"], {
  encoding: "utf8",
}).trim().split("\n").filter(Boolean);

const forbidden = tracked.filter((file) =>
  (/(^|\/)(uploads|data)\//u.test(file) && file !== "data/.gitkeep") ||
  /\.(db|db-wal|db-shm|sqlite|pdf)$/iu.test(file) ||
  /(cecilia|julia|student[-_ ]?booklet)/iu.test(file),
);
if (forbidden.length > 0) {
  throw new Error(
    `Potential real student data is tracked:\n${forbidden.join("\n")}`,
  );
}

const trackedImages = tracked.filter((file) => /\.(jpe?g|png|webp)$/iu.test(file));
const unexpectedImages = trackedImages.filter(
  (file) =>
    !file.startsWith("sample-work/") &&
    !file.startsWith("fixtures/student-work/") &&
    !file.startsWith("docs/screenshots/"),
);
if (unexpectedImages.length > 0) {
  throw new Error(
    `Review and explicitly allow these tracked images before publishing:\n${unexpectedImages.join("\n")}`,
  );
}

console.log(
  `Privacy verification passed: ${trackedImages.length} allowlisted synthetic/product images; no tracked databases, uploads, PDFs, or named booklet fixtures.`,
);
