import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, splitRawArgumentString } from "../dist/lib/args.mjs";

test("splitRawArgumentString handles quotes and escapes", () => {
  assert.deepEqual(splitRawArgumentString('--base main "focus on auth" one\\ two'), [
    "--base",
    "main",
    "focus on auth",
    "one two"
  ]);
});

test("splitRawArgumentString handles empty quotes", () => {
  assert.deepEqual(splitRawArgumentString('--base main "" "focus on auth"'), [
    "--base",
    "main",
    "",
    "focus on auth"
  ]);
});

test("parseArgs handles booleans, values, aliases, and positionals", () => {
  const parsed = parseArgs(["--background", "--base=main", "-m", "spark", "focus"], {
    booleanOptions: ["background"],
    valueOptions: ["base", "model"],
    aliasMap: { m: "model" }
  });
  assert.deepEqual(parsed.options, {
    background: true,
    base: "main",
    model: "spark"
  });
  assert.deepEqual(parsed.positionals, ["focus"]);
});

