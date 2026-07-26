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

function line(row: Row, header: readonly string[] = HEADER): string {
  return header.map((h) => row[h] ?? "0").join(",");
}

/** ヘッダ行の前にメタ行を置いた CSV を組み立てる。 */
export function buildCsv(rows: readonly Row[], header: readonly string[] = HEADER): string {
  return [META, header.join(","), ...rows.map((r) => line(r, header))].join("\r\n");
}
