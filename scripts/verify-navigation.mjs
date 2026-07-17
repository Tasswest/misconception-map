import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const shell = read("src/components/app-shell.tsx");
assert.deepEqual(
  [...shell.matchAll(/key: "([^"]+)"/g)].map((match) => match[1]),
  ["Classes", "Assignments", "Analytics", "Prediction Lab"],
  "the primary navigation must expose exactly the four teacher destinations in order",
);
assert.doesNotMatch(shell, /label: "Overview"|label: "Dashboard"/);
assert.match(shell, /href: "\/analytics"/);
assert.match(shell, /activeNav = "Assignments"/);

const rootPage = read("src/app/page.tsx");
assert.match(rootPage, /redirect\("\/assignments"\)/);
assert.match(
  rootPage,
  /1\. Create a class → 2\. Create an assignment → 3\. Upload the exam/,
);
assert.match(rootPage, /npm run seed/);

const assignments = read("src/app/assignments/page.tsx");
assert.match(assignments, /SetupWorkspace/);
assert.match(assignments, /\/assignments\?new=1/);
assert.match(assignments, /query\.assignmentId/);

for (const route of [
  "src/app/analytics/page.tsx",
  "src/app/analytics/[assignmentId]/page.tsx",
  "src/app/analytics/[assignmentId]/corrected-copies/page.tsx",
  "src/app/analytics/[assignmentId]/practice/page.tsx",
  "src/app/analytics/[assignmentId]/corrected-copies/[membershipId]/page.tsx",
  "src/app/analytics/[assignmentId]/practice/[worksheetId]/page.tsx",
]) {
  assert.ok(fs.existsSync(path.join(root, route)), `${route} must exist`);
}

const tabs = read("src/components/analytics/analytics-navigation.tsx");
assert.match(tabs, /Class by exercise/);
assert.match(tabs, /Corrected copies/);
assert.match(tabs, /Practice & brief/);
assert.match(tabs, /aria-current=\{active \? "page"/);

const nextConfig = read("next.config.ts");
for (const [source, destination] of [
  ["/diagnose", "/assignments"],
  ["/dashboard", "/analytics"],
  ["/assignments/:assignmentId/dashboard", "/analytics/:assignmentId"],
  [
    "/assignments/:assignmentId/students/:membershipId/corrected",
    "/analytics/:assignmentId/corrected-copies/:membershipId",
  ],
  [
    "/assignments/:assignmentId/practice/:worksheetId",
    "/analytics/:assignmentId/practice/:worksheetId",
  ],
]) {
  const sourceIndex = nextConfig.indexOf(`source: "${source}"`);
  assert.ok(sourceIndex >= 0, `missing legacy redirect for ${source}`);
  const redirectBlock = nextConfig.slice(sourceIndex, sourceIndex + 360);
  assert.match(
    redirectBlock.replaceAll(/\s+/g, " "),
    new RegExp(
      `destination: "${destination.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
    ),
    `${source} must redirect to ${destination}`,
  );
  assert.match(redirectBlock, /statusCode: 301/, `${source} must use HTTP 301`);
}

const sourceFiles = walk(path.join(root, "src"))
  .filter(
    (filePath) => filePath.endsWith(".tsx") || filePath.endsWith(".ts"),
  )
  .map((filePath) => fs.readFileSync(filePath, "utf8"))
  .join("\n");
assert.doesNotMatch(sourceFiles, /href="\/diagnose"/);
assert.doesNotMatch(sourceFiles, /href=\{`\/assignments\/\$\{[^}]+\}\/dashboard`\}/);
assert.doesNotMatch(
  sourceFiles,
  /href=\{`\/assignments\/\$\{[^}]+\}\/students\/\$\{[^}]+\}\/corrected`\}/,
);
assert.doesNotMatch(
  sourceFiles,
  /href=\{`\/assignments\/\$\{[^}]+\}\/practice\/\$\{[^}]+\}`\}/,
);

console.log(
  "Navigation verification passed: four tabs, assignment-first root, analytics sub-tabs, canonical cross-links, and five HTTP 301 legacy redirects.",
);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}
