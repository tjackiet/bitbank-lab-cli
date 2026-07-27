// CSV パーサと年間取引報告書の読み取り。**列名で引く**ことが本体の性質なので、
// 列の挿入・並べ替えで壊れないことと、欠けたら黙って進まないことを固定する。
import { describe, expect, it } from "vitest";
import { parseAnnualReport } from "../../../tax/import-csv/annual-report.js";
import { parseMarginReport } from "../../../tax/import-csv/margin-report.js";
import { parseCsv } from "../../../tax/import-csv/parse-csv.js";
import { buildCsv, buildMarginCsv, HEADER, MARGIN_HEADER } from "./synthetic-report.js";

const table = (csv: string) => parseCsv(csv);

describe("parseCsv", () => {
  it("BOM を落とす（先頭セルが列名と一致しなくなるのを防ぐ）", () => {
    expect(parseCsv("﻿通貨名,年始数量\nbtc,1")[0][0]).toBe("通貨名");
  });

  it("CRLF と LF のどちらでも行を切る", () => {
    expect(parseCsv("a,b\r\nc,d\ne,f")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
  });

  it("引用符内のカンマ・改行・二重引用符を保持する", () => {
    expect(parseCsv('"a,1","b\nc","d""e"')).toEqual([["a,1", "b\nc", 'd"e']]);
  });

  it("末尾の改行で空行を作らない", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
  });
});

describe("parseAnnualReport", () => {
  const ok = (csv: string) => {
    const r = parseAnnualReport(table(csv));
    if (!r.success) throw new Error(r.error);
    return r.data;
  };

  it("1 行目のメタ行を飛ばしてヘッダ行を見つける", () => {
    const d = ok(buildCsv([{ 通貨名: "btc", 年始数量: "1.5" }]));
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ currency: "btc", opening_qty: "1.5" });
  });

  it("列が挿入されても位置ずれしない（列名で引く）", () => {
    // 位置で引く実装なら「メモ」以降が 1 列ずつずれ、数字は読めてしまうので気づけない
    const header = [...HEADER.slice(0, 2), "メモ", ...HEADER.slice(2)];
    const d = ok(buildCsv([{ 通貨名: "btc", 年末数量: "2" }], header));
    expect(d.rows[0].closing_qty).toBe("2");
    expect(d.unknownColumns).toEqual(["メモ"]);
  });

  it("必須列が欠けたら明示エラー（欠測をゼロとして進めない）", () => {
    const header = HEADER.filter((h) => h !== "支払手数料");
    const r = parseAnnualReport(table(buildCsv([{ 通貨名: "btc" }], header)));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("fee");
  });

  it("十進文字列として読めない値は行番号付きで落とす", () => {
    // 桁区切り付き（引用符でくくられた `1,000`）。number 化する実装なら通ってしまう
    const r = parseAnnualReport(table(buildCsv([{ 通貨名: "btc", 年始数量: '"1,000"' }])));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("line 3");
  });

  it("同じ既知列が 2 本あればエラー（後勝ちで誤った値を採用しない）", () => {
    const header = [...HEADER, "支払手数料"];
    const r = parseAnnualReport(table(buildCsv([{ 通貨名: "btc" }], header)));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("duplicate columns: 支払手数料");
  });

  it("ヘッダが無ければエラー（別の CSV を渡された場合）", () => {
    expect(parseAnnualReport(table("date,amount\n2026-01-01,1")).success).toBe(false);
  });

  it("末尾の空行は行にしない", () => {
    expect(ok(`${buildCsv([{ 通貨名: "btc" }])}\r\n,,,,,,,,,,,,,,,,`).rows).toHaveLength(1);
  });
});

// 信用の社内資料は「出力項目」リストが注記なし・「CSVラベル名」表が `（円）` 付きで
// **食い違っていた**。注記付きを弾くと、正しいファイルに「様式が違う」と出る
// （しかも目印の列なのでファイル全体が読めない）。
describe("見出しの単位注記", () => {
  const withYen = MARGIN_HEADER.map((h) =>
    h === "年中信用取引損益" || h === "支払手数料" ? `${h}（円）` : h,
  );

  it("「（円）」付きの見出しでも読める", () => {
    const r = parseMarginReport(table(buildMarginCsv([{ 通貨名: "btc" }], withYen)));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.unknownColumns).toEqual([]);
  });

  it("目印の列も注記付きで見つかる（見つからないとファイル全体が読めない）", () => {
    const onlyMarker = withYen.map((h) => (h === "通貨名" ? "通貨名" : h));
    expect(parseMarginReport(table(buildMarginCsv([{ 通貨名: "btc" }], onlyMarker))).success).toBe(
      true,
    );
  });

  it("注記なしの見出しも従来どおり読める", () => {
    expect(parseMarginReport(table(buildMarginCsv([{ 通貨名: "btc" }]))).success).toBe(true);
  });

  it("注記の有無で同じ列が 2 本あればエラー（どちらが正かは人が決める）", () => {
    const dup = [...MARGIN_HEADER, "支払手数料（円）"];
    const r = parseMarginReport(table(buildMarginCsv([{ 通貨名: "btc" }], dup)));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("duplicate columns");
  });

  it("注記を落としても未知の列は未知のまま（部分一致で別の列に化けない）", () => {
    const extra = [...MARGIN_HEADER, "翌年繰越（円）"];
    const r = parseMarginReport(table(buildMarginCsv([{ 通貨名: "btc" }], extra)));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.unknownColumns).toEqual(["翌年繰越（円）"]);
  });
});
