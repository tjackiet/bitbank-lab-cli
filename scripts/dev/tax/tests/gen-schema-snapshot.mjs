// SCHEMA_SNAPSHOT.json を再生成する。実行: node tests/gen-schema-snapshot.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "./lib.mjs";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "SCHEMA_SNAPSHOT.json");
writeFileSync(out, `${JSON.stringify(buildSnapshot(), null, 2)}\n`);
console.log(`written: ${out}`);
