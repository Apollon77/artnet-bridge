#!/usr/bin/env node

// TODO: Remove once node-dtls-client >2.0.0 ships with the fix
// https://github.com/AlCalzone/node-dtls-client/pull/467
//
// node-dtls-client 2.0.0 uses crypto.pseudoRandomBytes (removed in Node.js 23).
// The ESM namespace object for "crypto" is sealed, so a runtime polyfill cannot
// add the missing property. This script patches the built files directly.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "node_modules/node-dtls-client/build/TLS/AEADCipher.js",
  "node_modules/node-dtls-client/build/TLS/BlockCipher.js",
];

let patched = 0;
for (const rel of files) {
  const file = resolve(root, rel);
  if (!existsSync(file)) continue;

  const src = readFileSync(file, "utf8");
  if (!src.includes("pseudoRandomBytes")) continue;

  writeFileSync(file, src.replaceAll("pseudoRandomBytes", "randomBytes"));
  patched++;
}

if (patched > 0) {
  console.log(`[patch-dtls-client] Patched ${patched} file(s): crypto.pseudoRandomBytes → crypto.randomBytes`);
}
