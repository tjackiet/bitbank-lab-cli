// 年間取引報告書テストの合成データ。**実口座の CSV はリポジトリに置かない**
// （公開フォーク。scripts/check-no-real-account-data.sh が pre-commit と CI で走る）。
// 列名・列順は実物に合わせるが、値はすべて作り物。

export const HEADER = [
  "通貨名",
  "年始数量",
  "JPY建て年中購入数量",
  "JPY建て年中購入金額",
  "BTC建て年中購入数量",
  "BTC建て年中購入金額",
  "JPY建て年中売却数量",
  "JPY建て年中売却金額",
  "BTC建て年中売却数量",
  "BTC建て年中売却金額",
  "移入数量",
  "移出数量",
  "支払手数料",
  "貸出数量",
  "返却数量",
  "貸出損益",
  "年末数量",
];

/** 1 行目は氏名・発行者のメタ行（実物と同じ形。氏名はダミー）。 */
export const META = "氏名:,テスト 太郎,,年間取引報告書,,発行者:,ビットバンク株式会社";

export type Row = Partial<Record<(typeof HEADER)[number], string>> & { 通貨名: string };

/**
 * 行リテラルのキーは**単位注記を外した論理名**にする。見出しに `（円）` が付く様式
 * （信用・実機確認 #10）でも `{ 年中信用取引損益: "100" }` と書けるようにするため。
 * 見出し文字列を直接キーにすると、様式を実物へ寄せた瞬間に全テストの行リテラルが
 * 巻き添えになる。
 */
function line(row: Record<string, string | undefined>, header: readonly string[]): string {
  return header.map((h) => row[h.replace(/[（(][^（）()]*[）)]$/, "")] ?? "0").join(",");
}

/** ヘッダ行の前にメタ行を置いた CSV を組み立てる。現物は CRLF。 */
export function buildCsv(rows: readonly Row[], header: readonly string[] = HEADER): string {
  return [META, header.join(","), ...rows.map((r) => line(r, header))].join("\r\n");
}

/**
 * 信用の年間取引報告書（別様式・別ファイル。4 項目 + 通貨名）。
 * **実物の見出しをそのまま写す**（実機確認 #10）。現物と揃っていない点が 2 つある:
 * - **買建玉が先**（現物の並びから類推すると逆になる）
 * - **損益と手数料に `（円）` が付く**
 * 列名で引いているのでどちらも実害は出ないが、フィクスチャは実物に合わせておく。
 */
export const MARGIN_HEADER = [
  "通貨名",
  "年末保有中買建玉",
  "年末保有中売建玉",
  "年中信用取引損益（円）",
  "支払手数料（円）",
];

/** 行リテラルのキー（見出しから単位注記を外したもの）。 */
const MARGIN_FIELDS = [
  "通貨名",
  "年末保有中買建玉",
  "年末保有中売建玉",
  "年中信用取引損益",
  "支払手数料",
] as const;

export type MarginRow = Partial<Record<(typeof MARGIN_FIELDS)[number], string>> & {
  通貨名: string;
};

/** 信用のメタ行はタイトルが現物と違う（「（信用取引）」が付く）。 */
export const MARGIN_META =
  "氏名:,テスト 太郎,,年間取引報告書（信用取引）,,発行者:,ビットバンク株式会社";

/**
 * 信用は現物と**改行コードも違う**（実機確認 #10: BOM なし・LF・末尾改行なし）。
 * 同じ発行元でも揃っていないので、フィクスチャ側でその差を再現しておく。
 */
export function buildMarginCsv(
  rows: readonly MarginRow[],
  header: readonly string[] = MARGIN_HEADER,
): string {
  return [MARGIN_META, header.join(","), ...rows.map((r) => line(r, header))].join("\n");
}
