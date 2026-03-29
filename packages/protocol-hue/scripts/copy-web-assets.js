#!/usr/bin/env node
import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, "../src/web/hue-config.html");
const dest = join(__dirname, "../dist/esm/web/hue-config.html");

cpSync(src, dest, { recursive: true });
console.log("Copied Hue web assets to dist/esm/web/");
