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

// tasty-coupon 只提供代碼，折扣明細（滿額／折扣率／上限）要從 kb56.tw 頁面表格補。
// 兩邊是同一批優惠：代碼可 100% 對應；免輸碼列用（使用期限｜適用對象）對應。
const kb56Pages = {
  ubereats: "https://kb56.tw/uber-eats-coupon/",
  foodpanda: "https://kb56.tw/foodpanda-coupon/",
};

const requestText = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
};

const cleanCell = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const parseKb56Discounts = (html) => {
  const byCode = new Map();
  const byPeriodScope = new Map();
  for (const match of html.matchAll(/data-code="([^"]+)"/g)) {
    const code = match[1];
    const rowStart = html.lastIndexOf("<tr", match.index);
    const rowEnd = html.indexOf("</tr>", match.index);
    if (rowStart < 0 || rowEnd < 0) continue;
    const cells = [...html.slice(rowStart, rowEnd).matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)]
      .map(m => cleanCell(m[1])).filter(Boolean);
    // 表格欄位順序：優惠碼／使用連結｜優惠內容｜使用期限｜適用對象
    if (cells.length < 4 || !cells[1]) continue;
    // data-code 可能是「前往下單」這類動作文字而非真正的代碼，視為免輸碼列
    if (code && code !== "無" && !linkMarker.test(code)) byCode.set(code, cells[1]);
    else byPeriodScope.set(cells[2] + "|" + cells[3], cells[1]);
  }
  return { byCode, byPeriodScope };
};

const loadKb56Discounts = async () => {
  const lookups = {};
  for (const [platform, url] of Object.entries(kb56Pages)) {
    try {
      lookups[platform] = parseKb56Discounts(await requestText(url));
    } catch (error) {
      // kb56 失敗不影響主流程：沒有折扣就維持原本顯示。
      lookups[platform] = { byCode: new Map(), byPeriodScope: new Map() };
      result.errors.push("kb56 " + platform + ": " + (error instanceof Error ? error.message : String(error)));
    }
  }
  return lookups;
};

const applyDiscount = (coupon, lookup) => {
  if (!lookup) return coupon;
  let hit = (coupon.code && lookup.byCode.get(coupon.code))
    || (coupon.link && lookup.byPeriodScope.get(coupon.period + "|" + coupon.scope));
  if (!hit && !coupon.code && !coupon.link && coupon.content) {
    // 容錯：來源偶爾在「複製優惠碼」中夾帶空白，導致代碼沒被解析出來
    const guess = coupon.content.replace(/\s+/g, "").split(copyMarker)[0].trim();
    if (guess) hit = lookup.byCode.get(guess);
  }
  return hit ? { ...coupon, discount: hit } : coupon;
};

const value = (row, keys) => {
  for (const key of keys) {
    if (row?.[key] != null && String(row[key]).trim()) return String(row[key]).trim();
  }
  return "";
};

const foreignMarket = (text) => /香港|澳門|澳门|HK\$|HKD|MOP\$|港幣|港币/i.test(text);
const copyMarker = /\s*[（(]?\s*(?:複製優惠碼並前往使用|複製並前往使用|點擊複製並前往|點擊複製|複製並前往|複製優惠碼|复制优惠码)[）)]?\s*/;
const linkMarker = /點擊前往|免輸碼直達|點擊領取|前往合作頁面|前往查看優惠|查看優惠|前往下單/;
const parseCode = (text) => {
  if (!text) return { code: null, link: false };
  if (linkMarker.test(text)) return { code: null, link: true };
  return {
    code: text.split(copyMarker)[0].trim() || null,
    link: false,
  };
};

const normalize = (raw, platform) => {
  const month = Object.keys(raw || {})[0] || "";
  const coupons = [];
  for (const [section, rows] of Object.entries(raw?.[month] || {})) {
    if (foreignMarket(section)) continue;
    for (const row of Array.isArray(rows) ? rows : []) {
      if (foreignMarket(JSON.stringify(row))) continue;
      const scope = value(row, ["適用對象", "適用範圍", "使用條件", "col_2"]);
      const content = value(row, ["優惠內容", "優惠說明", "內容", "col_0"])
        || [value(row, ["銀行／支付工具"]), value(row, ["最高回饋"])].filter(Boolean).join("｜");
      const explicitOffer = value(row, ["優惠碼", "優惠代碼", "優惠碼／使用方式", "優惠碼／使用連結"]);
      const embeddedOffer = copyMarker.test(content) || linkMarker.test(content)
        ? content
        : "";
      const offer = explicitOffer || embeddedOffer;
      const offers = copyMarker.test(offer) && !linkMarker.test(offer)
        ? offer.split(copyMarker).map(x => x.trim()).filter(Boolean)
        : [offer];
      for (const singleOffer of offers) coupons.push({
        section,
        scope,
        period: value(row, ["使用期限", "優惠期間", "活動期間", "期限", "col_1"]),
        content,
        platform,
        ...parseCode(singleOffer),
      });
    }
  }
  if (!coupons.length || !coupons.some(c => c.code || c.link)) {
    throw new Error(platform + " 正規化後沒有可用代碼或領取入口，拒絕發布異常資料");
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

// 先抓 kb56 折扣對照表；失敗時回空表，不影響主流程。
const kb56 = await loadKb56Discounts();

for (const [platform, url] of Object.entries(sources)) {
  try {
    const normalized = normalize(await requestJson(url), platform);
    normalized.coupons = normalized.coupons.map(c => applyDiscount(c, kb56[platform]));
    result[platform] = normalized;
    successful += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(platform + ": " + message);
    if (previous?.[platform]?.coupons) result[platform] = {
      ...previous[platform],
      coupons: previous[platform].coupons.filter(c => !foreignMarket(JSON.stringify(c))),
    };
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
