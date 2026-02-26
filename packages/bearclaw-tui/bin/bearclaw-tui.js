#!/usr/bin/env node
import { spawn } from "node:child_process";

const args = ["run", "src/index.tsx", ...process.argv.slice(2)];
const child = spawn("bun", args, { stdio: "inherit" });

child.on("error", (err) => {
  if ((err).code === "ENOENT") {
    console.error("bearclaw-tui requires Bun. Install it from https://bun.sh and try again.");
  } else {
    console.error(`Failed to start bun: ${(err).message}`);
  }
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
