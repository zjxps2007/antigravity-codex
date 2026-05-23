import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const files = [
  ["dist/agy-codex.mjs", "hooks/bin/agy-codex.mjs"],
  ["dist/stop-review-gate-hook.mjs", "hooks/bin/stop-review-gate-hook.mjs"],
  ["dist/lib/args.mjs", "hooks/bin/lib/args.mjs"],
  ["dist/lib/review-gate-events.mjs", "hooks/bin/lib/review-gate-events.mjs"],
  ["dist/lib/state.mjs", "hooks/bin/lib/state.mjs"],
  ["schemas/review-output.schema.json", "hooks/schemas/review-output.schema.json"]
];

for (const [source, target] of files) {
  const sourcePath = path.join(root, source);
  const targetPath = path.join(root, target);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}
