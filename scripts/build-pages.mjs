import { mkdir, readFile, writeFile } from "node:fs/promises";

const source = await readFile(new URL("../worker/index.js", import.meta.url), "utf8");
const prefix = "const PAGE=String.raw`";
const start = source.indexOf(prefix);
const endMarker = "`;\nexport default";
const end = source.lastIndexOf(endMarker);

if (start < 0 || end < 0 || end <= start) {
  throw new Error("Unable to extract the current Site page from worker/index.js");
}

let page = source.slice(start + prefix.length, end);
const oldLoadStart = page.indexOf("async function load(){");
const oldLoadEnd = page.indexOf("if(document.modelContext", oldLoadStart);

if (oldLoadStart < 0 || oldLoadEnd < 0) {
  throw new Error("Unable to locate the page data loader");
}

const staticLoader = String.raw`async function load(){q("#content").className="state";q("#content").innerHTML='<div><div class="spin"></div>正在抓取最新優惠券…</div>';try{const region=q("#region").value;const [u,p]=await Promise.all([fetch("https://raw.githubusercontent.com/ridemountainpig/tasty-coupon/main/coupon-json/ubereats-coupon.json"),fetch("https://raw.githubusercontent.com/ridemountainpig/tasty-coupon/main/coupon-json/foodpanda-coupon.json")]);if(!u.ok||!p.ok)throw Error("優惠資料來源暫時無法連線");const parse=async(r,platform)=>{const raw=await r.json(),out=[];for(const[section,rows]of Object.entries(raw?.[Object.keys(raw||{})[0]]||{})){if(!identityMatches(section,isNew))continue;for(const row of Array.isArray(rows)?rows:[]){const scope=val(row,["適用對象","適用範圍","使用條件","col_2"]);if(!inRegion(scope,region))continue;const content=val(row,["優惠內容","優惠說明","內容","col_0"])||[val(row,["銀行／支付工具"]),val(row,["最高回饋"])].filter(Boolean).join("｜");const code=parseCode(val(row,["優惠碼","優惠代碼","優惠碼／使用方式","優惠碼／使用連結"]));out.push({section,scope,period:val(row,["使用期限","優惠期間","活動期間","期限","col_1"]),content,platform,...code})}}return out};data={ubereats:await parse(u,"ubereats"),foodpanda:await parse(p,"foodpanda"),updated:"資料來源即時讀取"};q("#updated").textContent=data.updated;q("#uc").textContent=data.ubereats.length+" 張";q("#pc").textContent=data.foodpanda.length+" 張";shown=new Set(["code","link"]);category="all";filters();render()}catch(x){q("#content").innerHTML='<div><strong>目前無法取得優惠資料</strong><p>'+e(x.message)+'</p><button class="refresh" onclick="load()">再試一次</button></div>'}}`;

page = page.slice(0, oldLoadStart) + staticLoader + page.slice(oldLoadEnd);
await mkdir(new URL("../docs", import.meta.url), { recursive: true });
await writeFile(new URL("../docs/index.html", import.meta.url), page);
