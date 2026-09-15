import json
import re
import time
from datetime import datetime

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

UBEREATS_JSON_URL = "https://raw.githubusercontent.com/ridemountainpig/tasty-coupon/main/coupon-json/ubereats-coupon.json"
FOODPANDA_JSON_URL = "https://raw.githubusercontent.com/ridemountainpig/tasty-coupon/main/coupon-json/foodpanda-coupon.json"
UBEREATS_PAGE_URL = "https://kb56.tw/uber-eats-coupon/"
FOODPANDA_PAGE_URL = "https://kb56.tw/foodpanda-coupon/"

_cache = {}
CACHE_TTL = 1800


def fetch_json(url):
    now = time.time()
    if url in _cache and now - _cache[url]["ts"] < CACHE_TTL:
        return _cache[url]["data"]
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        _cache[url] = {"data": data, "ts": now}
        return data
    except Exception as e:
        if url in _cache:
            return _cache[url]["data"]
        raise e


def fetch_text(url):
    now = time.time()
    cache_key = f"text:{url}"
    if cache_key in _cache and now - _cache[cache_key]["ts"] < CACHE_TTL:
        return _cache[cache_key]["data"]
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; CouponFinder/1.0)"},
            timeout=15,
        )
        resp.raise_for_status()
        text = resp.text
        _cache[cache_key] = {"data": text, "ts": now}
        return text
    except Exception as e:
        if cache_key in _cache:
            return _cache[cache_key]["data"]
        raise e


def clean_html_text(fragment):
    fragment = re.sub(r"<script\b[^>]*>.*?</script>", "", fragment, flags=re.I | re.S)
    fragment = re.sub(r"<style\b[^>]*>.*?</style>", "", fragment, flags=re.I | re.S)
    fragment = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    fragment = re.sub(r"<[^>]+>", " ", fragment)
    fragment = re.sub(r"\s+", " ", fragment)
    return re.sub(r"\s+([，。！？：；）】])", r"\1", fragment).strip()


def html_cell(row_html, class_name):
    match = re.search(
        rf"<(?:td|th)\b[^>]*class=[\"'][^\"']*{re.escape(class_name)}[^\"']*[\"'][^>]*>"
        rf"(.*?)</(?:td|th)>",
        row_html,
        flags=re.I | re.S,
    )
    return match.group(1) if match else ""


def parse_source_page(html):
    """Read the complete offer rows from the source page.

    The repository JSON currently loses the first table column when a row has
    fewer cells than its header. The source page still contains that column,
    so use it to recover the actual offer description and coupon code.
    """
    result = []
    table_pattern = re.compile(r"<table\b[^>]*>(.*?)</table>", re.I | re.S)
    row_pattern = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.I | re.S)

    for table_match in table_pattern.finditer(html):
        table_html = table_match.group(1)
        before_table = html[:table_match.start()]
        headings = re.findall(
            r"<h[234]\b[^>]*>(.*?)</h[234]>",
            before_table,
            flags=re.I | re.S,
        )
        section_name = clean_html_text(headings[-1]) if headings else "其他優惠"

        for row_match in row_pattern.finditer(table_html):
            row_html = row_match.group(1)
            content_cell = html_cell(row_html, "kb56-content-cell")
            code_cell = html_cell(row_html, "kb56-code-cell")
            if not content_cell or not code_cell:
                continue

            title_match = re.search(
                r"class=[\"'][^\"']*kb56-offer-title[^\"']*[\"'][^>]*>(.*?)</",
                content_cell,
                flags=re.I | re.S,
            )
            title = clean_html_text(
                title_match.group(1) if title_match else content_cell
            )
            subtitle_match = re.search(
                r"class=[\"'][^\"']*kb56-offer-subtitle[^\"']*[\"'][^>]*>(.*?)</",
                content_cell,
                flags=re.I | re.S,
            )
            subtitle = clean_html_text(subtitle_match.group(1)) if subtitle_match else ""
            content = "｜".join(value for value in (title, subtitle) if value)

            raw_code = clean_html_text(code_cell)
            period = clean_html_text(html_cell(row_html, "kb56-date-cell"))
            scope = clean_html_text(html_cell(row_html, "kb56-target-cell"))
            result.append({
                "section": section_name,
                "raw_code": raw_code,
                "content": content,
                "period": period,
                "scope": scope,
            })

        # Older and richer tables do not use the kb56 cell classes. Their
        # headers are still reliable, so map them by header name instead of
        # relying on column position.
        if "kb56-content-cell" in table_html:
            continue
        thead_match = re.search(r"<thead\b[^>]*>(.*?)</thead>", table_html, re.I | re.S)
        header_html = thead_match.group(1) if thead_match else ""
        headers = [
            clean_html_text(cell)
            for cell in re.findall(r"<(?:th|td)\b[^>]*>(.*?)</(?:th|td)>", header_html, re.I | re.S)
        ]
        if not headers:
            continue

        for row_match in row_pattern.finditer(table_html):
            row_html = row_match.group(1)
            if "<th" in row_html.lower():
                continue
            cells = [
                clean_html_text(cell)
                for cell in re.findall(
                    r"<(?:td|th)\b[^>]*>(.*?)</(?:td|th)>",
                    row_html,
                    re.I | re.S,
                )
            ]
            if len(cells) != len(headers):
                continue
            row = dict(zip(headers, cells))
            raw_code = first_value(row, [
                "優惠碼", "優惠代碼", "優惠碼／使用方式", "優惠碼／使用連結",
            ])
            content = first_value(row, ["優惠內容", "優惠說明", "內容"])
            details = []
            if not content:
                details = rich_offer_details(row)
                primary = [
                    first_value(row, ["銀行／支付工具"]),
                    first_value(row, ["最高回饋"]),
                ]
                content = "｜".join(value for value in primary if value)
            period = first_value(row, [
                "使用期限", "優惠期間", "活動期間", "期限", "活動期限",
            ])
            scope = first_value(row, [
                "適用對象", "適用範圍", "使用條件", "適用條件",
            ])
            if not any((raw_code, content, period, scope)):
                continue
            result.append({
                "section": section_name,
                "raw_code": raw_code,
                "content": content,
                "details": details,
                "period": period,
                "scope": scope,
            })
    return result


def parse_coupon_code(raw_code):
    if not raw_code:
        return None, False

    raw_code = str(raw_code).strip()
    if any(marker in raw_code for marker in ("點擊前往", "免輸碼直達", "點擊領取", "前往合作頁面")):
        return None, True

    # The source uses several variants such as:
    # "CODE(複製並前往使用)" and "CODE\n點擊複製並前往".
    code = re.split(
        r"\s*[\(（]?\s*(?:複製並前往使用|點擊複製並前往|點擊複製|複製並前往)"
        r"\s*[\)）]?",
        raw_code,
        maxsplit=1,
    )[0].strip()
    return (code or None), False


NEW_USER_KEYWORDS = ["新用戶", "新戶", "首購", "首單"]
REGION_MAP = {
    "台北市": ["台北市", "臺北市", "大台北", "大臺北"],
    "新北市": ["新北市", "大台北", "大臺北"],
    "桃園市": ["桃園市"],
    "基隆市": ["基隆市"],
    "新竹市": ["新竹市"],
    "新竹縣": ["新竹縣"],
    "苗栗縣": ["苗栗縣"],
    "台中市": ["台中市", "臺中市"],
    "彰化縣": ["彰化縣"],
    "南投縣": ["南投縣"],
    "雲林縣": ["雲林縣"],
    "嘉義市": ["嘉義縣", "嘉義市"],
    "嘉義縣": ["嘉義縣", "嘉義市"],
    "台南市": ["台南市", "臺南市"],
    "高雄市": ["高雄市"],
    "屏東縣": ["屏東縣"],
    "宜蘭縣": ["宜蘭縣"],
    "花蓮縣": ["花蓮縣"],
    "台東縣": ["台東縣", "臺東縣"],
    "澎湖縣": ["澎湖縣"],
    "金門縣": ["金門縣"],
}


def region_matches(scope, user_region):
    if not scope or scope.strip() == "" or scope.strip() == "對象":
        return True
    keywords = REGION_MAP.get(user_region, [user_region])
    for kw in keywords:
        if kw in scope:
            return True
    all_city_keywords = [kw for kws in REGION_MAP.values() for kw in kws]
    has_any_city = any(kw in scope for kw in all_city_keywords)
    if not has_any_city:
        return True
    return False


def section_is_new_user(section_name):
    for kw in NEW_USER_KEYWORDS:
        if kw in section_name:
            return True
    return False


def first_value(coupon, keys):
    """Return the first non-empty value from a source row."""
    for key in keys:
        value = coupon.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def rich_offer_details(coupon):
    details = []
    for label, key in (
        ("優惠類型", "優惠類型"),
        ("銀行／支付工具", "銀行／支付工具"),
        ("最高回饋", "最高回饋"),
        ("推薦", "推薦標籤"),
        ("備註", "KB56 備註"),
        ("推薦", "KB56 推薦"),
    ):
        value = first_value(coupon, [key])
        if value:
            details.append(f"{label}：{value}")
    return details


def normalize_coupon_fields(coupon, section_name):
    """Normalize the source repo's old, table, and rich-info row formats."""
    raw_code = first_value(coupon, [
        "優惠碼", "優惠代碼", "優惠碼／使用方式",
    ])
    scope = first_value(coupon, [
        "適用對象", "適用範圍", "使用條件", "col_2",
    ])
    period = first_value(coupon, [
        "使用期限", "優惠期間", "活動期間", "期限", "活動期限", "col_1",
    ])
    content = first_value(coupon, [
        "優惠內容", "優惠說明", "內容", "col_0",
    ])
    details = []

    # Rich payment/credit-card rows do not have a single "優惠內容" field.
    if not content:
        details = rich_offer_details(coupon)
        primary = [
            first_value(coupon, ["銀行／支付工具"]),
            first_value(coupon, ["最高回饋"]),
        ]
        content = "｜".join(value for value in primary if value)

    return raw_code, content, period, scope, details


def parse_coupons(raw_data, platform, is_new_user, user_region, source_rows=None):
    result = []
    month_key = list(raw_data.keys())[0] if raw_data else None
    if not month_key:
        return result, ""

    month_label = month_key.strip()
    sections = raw_data[month_key]

    if source_rows:
        section_items = {}
        for row in source_rows:
            section_items.setdefault(row["section"], []).append(row)
    else:
        section_items = sections

    for section_name, coupons in section_items.items():
        is_new_section = section_is_new_user(section_name)
        if not is_new_user and is_new_section:
            continue

        for coupon in coupons:
            if not isinstance(coupon, dict):
                continue

            if source_rows:
                raw_code = coupon["raw_code"]
                content = coupon["content"]
                period = coupon["period"]
                scope = coupon["scope"]
                details = coupon.get("details", [])
            else:
                raw_code, content, period, scope, details = normalize_coupon_fields(
                    coupon, section_name
                )

            if not region_matches(scope, user_region):
                continue

            code, is_link_only = parse_coupon_code(raw_code)

            result.append({
                "section": section_name,
                "content": content,
                "has_description": bool(content),
                "details": details,
                "code": code,
                "is_link_only": is_link_only,
                "period": period,
                "scope": scope,
                "platform": platform,
            })

    return result, month_label


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/coupons")
def get_coupons():
    platform = request.args.get("platform", "both")
    is_new_user = request.args.get("is_new_user", "false").lower() == "true"
    user_region = request.args.get("region", "台南市")

    result = {"ubereats": [], "foodpanda": [], "month": "", "error": None}

    source_errors = []

    if platform in ("ubereats", "both"):
        try:
            ue_data = fetch_json(UBEREATS_JSON_URL)
            ue_rows = parse_source_page(fetch_text(UBEREATS_PAGE_URL))
            ue_coupons, month = parse_coupons(
                ue_data, "ubereats", is_new_user, user_region, ue_rows
            )
            result["ubereats"] = ue_coupons
            if month:
                result["month"] = month
        except Exception as e:
            source_errors.append(f"Uber Eats：{e}")

    if platform in ("foodpanda", "both"):
        try:
            fp_data = fetch_json(FOODPANDA_JSON_URL)
            fp_rows = parse_source_page(fetch_text(FOODPANDA_PAGE_URL))
            fp_coupons, month = parse_coupons(
                fp_data, "foodpanda", is_new_user, user_region, fp_rows
            )
            result["foodpanda"] = fp_coupons
            if month:
                result["month"] = month
        except Exception as e:
            source_errors.append(f"foodpanda：{e}")

    # Keep a working platform visible if only the other source is unavailable.
    if source_errors and not result["ubereats"] and not result["foodpanda"]:
        result["error"] = "；".join(source_errors)
    elif source_errors:
        result["warning"] = "；".join(source_errors)

    return jsonify(result)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
