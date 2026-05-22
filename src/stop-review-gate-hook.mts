#!/usr/bin/env node
import process from "node:process";

process.stdin.resume();
process.stdin.on("data", () => undefined);
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ decision: "allow" }));
});

