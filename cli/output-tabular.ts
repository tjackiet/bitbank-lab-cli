// 人間向けの table / csv 整形。Result envelope の serialization（output.ts）とは
// 責務が異なるため分離。どちらも data 本体だけを受け取り、meta には触れない。

function toRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === "object" && data !== null) return [data as Record<string, unknown>];
  return [{ value: data }];
}

export function printTable(data: unknown): void {
  const rows = toRows(data);
  if (rows.length === 0) return;
  const keys = Object.keys(rows[0]);

  // 列幅を1パスで計算
  const widths = keys.map((k) => k.length);
  const cells: string[][] = [];
  for (const row of rows) {
    const rowCells: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      const s = String(row[keys[i]] ?? "");
      if (s.length > widths[i]) widths[i] = s.length;
      rowCells.push(s);
    }
    cells.push(rowCells);
  }

  const parts: string[] = [];
  parts.push(keys.map((k, i) => k.padEnd(widths[i])).join("  "));
  parts.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const rowCells of cells) {
    parts.push(rowCells.map((s, i) => s.padEnd(widths[i])).join("  "));
  }
  process.stdout.write(`${parts.join("\n")}\n`);
}

// OWASP CSV Injection: 先頭が = + - @ \t \r なら式評価される恐れがあるため強制クォート
const NEEDS_QUOTE_RE = /^[=+\-@\t\r]|[,"\n]/;

function escapeCsvField(value: string): string {
  if (NEEDS_QUOTE_RE.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function printCsv(data: unknown): void {
  const rows = toRows(data);
  if (rows.length === 0) return;
  const keys = Object.keys(rows[0]);
  const parts: string[] = [keys.map(escapeCsvField).join(",")];
  for (const row of rows) {
    parts.push(keys.map((k) => escapeCsvField(String(row[k] ?? ""))).join(","));
  }
  process.stdout.write(`${parts.join("\n")}\n`);
}
