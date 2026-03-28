#!/usr/bin/env node
import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, "../src/web/public");
const dest = join(__dirname, "../dist/esm/web/public");

cpSync(src, dest, { recursive: true });
console.log("Copied web assets to dist/esm/web/public/");
