import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);
const docsRoot = new URL("docs/", projectRoot);
const outputUrl = new URL("coupons.json", docsRoot);
const temporaryUrl = new URL("coupons.json.tmp", docsRoot);

const sources = {
  ubereats: "https://raw.githubusercontent.com/ridemountainpig/tasty-coupon/main/coupon-json/ubereats-coupon.json",
  foodpanda: "https://raw.githubusercontent.com/ridemountainpig/tasty-coupon/main/coupon-json/foodpanda-coupon.json",
};

const requestJson = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "taiwan-couponsniper-actions/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const value = (row, keys) => {
  for (const key of keys) {
    if (row?.[key] != null && String(row[key]).trim()) return String(row[key]).trim();
  }
  return "";
};

const parseCode = (text) => {
  if (!text) return { code: null, link: false };
  if (/點擊前往|免輸碼直達|點擊領取|前往合作頁面/.test(text)) return { code: null, link: true };
  return {
    code: text.split(/\s*[（(]?\s*(?:複製並前往使用|點擊複製並前往|點擊複製|複製並前往)/)[0].trim() || null,
    link: false,
  };
};

const normalize = (raw, platform) => {
  const month = Object.keys(raw || {})[0] || "";
  const coupons = [];
  for (const [section, rows] of Object.entries(raw?.[month] || {})) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const scope = value(row, ["適用對象", "適用範圍", "使用條件", "col_2"]);
      const content = value(row, ["優惠內容", "優惠說明", "內容", "col_0"])
        || [value(row, ["銀行／支付工具"]), value(row, ["最高回饋"])].filter(Boolean).join("｜");
      const explicitOffer = value(row, ["優惠碼", "優惠代碼", "優惠碼／使用方式", "優惠碼／使用連結"]);
      const embeddedOffer = /複製並前往使用|點擊複製並前往|點擊複製|複製並前往|點擊前往|免輸碼直達|點擊領取|前往合作頁面/.test(content)
        ? content
        : "";
      coupons.push({
        section,
        scope,
        period: value(row, ["使用期限", "優惠期間", "活動期間", "期限", "col_1"]),
        content,
        platform,
        ...parseCode(explicitOffer || embeddedOffer),
      });
    }
  }
  return { month, coupons };
};

await mkdir(docsRoot, { recursive: true });
let previous = null;
try {
  previous = JSON.parse(await readFile(outputUrl, "utf8"));
} catch {
  // 第一次執行時尚未有上一份快取。
}

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  updated: new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date()).replaceAll("/", "-"),
  sources,
  errors: [],
};
let successful = 0;

for (const [platform, url] of Object.entries(sources)) {
  try {
    result[platform] = normalize(await requestJson(url), platform);
    successful += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(platform + ": " + message);
    if (previous?.[platform]?.coupons) result[platform] = previous[platform];
  }
}

if (!successful) {
  throw new Error("兩個優惠券來源都無法取得：" + result.errors.join("；"));
}

await writeFile(temporaryUrl, JSON.stringify(result, null, 2) + "\n", "utf8");
await rename(temporaryUrl, outputUrl);
console.log(JSON.stringify({
  updated: result.updated,
  ubereats: result.ubereats?.coupons?.length || 0,
  foodpanda: result.foodpanda?.coupons?.length || 0,
  errors: result.errors,
}));
