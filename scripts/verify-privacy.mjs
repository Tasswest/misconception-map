import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files"], {
  encoding: "utf8",
}).trim().split("\n").filter(Boolean);

// sample-exams/ is the one allowed PDF location: past public brevet subjects
// plus student booklets the author wrote by hand under invented names
// (Cecilia, Julia, Thomas). No real student produced any of it. Everything
// else that looks like student data stays forbidden.
const AUTHOR_EXAM_FIXTURES = /^sample-exams\//u;

const forbidden = tracked.filter((file) =>
  !AUTHOR_EXAM_FIXTURES.test(file) &&
  ((/(^|\/)(uploads|data)\//u.test(file) && file !== "data/.gitkeep") ||
    /\.(db|db-wal|db-shm|sqlite|pdf)$/iu.test(file) ||
    /(cecilia|julia|student[-_ ]?booklet)/iu.test(file)),
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

const examFixtureCount = tracked.filter((file) =>
  AUTHOR_EXAM_FIXTURES.test(file),
).length;
console.log(
  `Privacy verification passed: ${trackedImages.length} allowlisted synthetic/product images and ${examFixtureCount} author-written exam PDFs under sample-exams/; no tracked databases, uploads, or other PDFs.`,
);
