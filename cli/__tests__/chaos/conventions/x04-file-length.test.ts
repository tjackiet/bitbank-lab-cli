import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 数えるのは**コード行**（空行と、行全体がコメントの行を除く）。生の行数ではない。
// この規約が検出したいのは責務の肥大（リトライ・パース・整形の混入）であって、
// 説明コメントの厚さではない。生行数で測ると「よく説明された短いファイル」が
// 構造の警告に引っかかり、説明を削る動機が生まれる（CLAUDE.md が禁じている行為）。
const MAX_LINES = 100;
const HEADER_SCAN = 5;
const REASON_COMMENT_RE = /^\s*\/\/\s*(?:100行超|>100 lines)\s*:/;

// 行頭から始まるブロックコメントだけを追う。行の途中で始まるもの（`foo(); /* …`）は
// 開始と見なさないので、閉じるまでの継続行をコードとして数え**過大**になる。
// 過小に出て上限をすり抜けるより安全な側に倒している。
function countCodeLines(file: string): number {
  let inBlock = false;
  let count = 0;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    let rest = line.trim();
    if (inBlock) {
      const end = rest.indexOf("*/");
      if (end === -1) continue;
      inBlock = false;
      rest = rest.slice(end + 2).trim();
    }
    while (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      if (end === -1) {
        inBlock = true;
        rest = "";
        break;
      }
      rest = rest.slice(end + 2).trim();
    }
    if (rest === "" || rest.startsWith("//")) continue;
    count++;
  }
  return count;
}

function hasReasonComment(file: string): boolean {
  const lines = readFileSync(file, "utf-8").split("\n");
  let scanned = 0;
  for (const line of lines) {
    if (scanned >= HEADER_SCAN) break;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#!")) continue;
    if (REASON_COMMENT_RE.test(line)) return true;
    scanned++;
  }
  return false;
}

function findOverLimit(files: readonly string[]): { file: string; lines: number }[] {
  return files
    .map((file) => ({ file, lines: countCodeLines(file) }))
    .filter((e) => e.lines > MAX_LINES)
    .filter((e) => !hasReasonComment(e.file));
}

function failIfOver(files: readonly string[]): void {
  const overLimit = findOverLimit(files);
  if (overLimit.length > 0) {
    const msg = overLimit.map((e) => `${e.file}: ${e.lines} code lines`).join("\n");
    expect.fail(
      `Files exceeding ${MAX_LINES} code lines without reason comment:\n${msg}\n` +
        `Blank lines and whole-line comments are NOT counted, so trimming comments will ` +
        `not fix this — split the file, or add a header comment like ` +
        `"// 100行超: <理由>" within the first ${HEADER_SCAN} non-blank lines.`,
    );
  }
}

describe("Chaos X-04: files ≤ 100 code lines (or carry a reason comment)", () => {
  // cli/ 全体（__tests__ を除く）を一括走査する。commands/・コア・index を包含し、
  // 将来追加されるディレクトリ（completion/ 等）も自動でカバーする。
  const files = execSync("find cli -name '*.ts' -not -path '*/__tests__/*'", { encoding: "utf-8" })
    .trim()
    .split("\n")
    .filter((f) => f !== "");

  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("all cli/ source files are within limit", () => {
    failIfOver(files);
  });

  // 数え方そのものの回帰テスト。ここが壊れると上限検査が黙って無効化される
  it("excludes blank lines and whole-line comments", () => {
    const self = "cli/__tests__/chaos/conventions/x04-file-length.test.ts";
    expect(countCodeLines(self)).toBeLessThan(readFileSync(self, "utf-8").split("\n").length);
  });
});
