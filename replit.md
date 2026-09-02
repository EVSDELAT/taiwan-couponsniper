# 外送優惠券查詢 (Food Delivery Coupon Finder)

## Overview
A Flask web app that fetches and displays current month Uber Eats and foodpanda coupons available in Taiwan. Supports region filtering (default: 台南市/Yongkang), user type (new/existing), and platform selection. Features one-click copy and platform open buttons.

## Architecture
- **Backend**: Python Flask (`app.py`) on port 5000
- **Frontend**: Single HTML template (`templates/index.html`) with Tailwind CSS CDN
- **Data Source**: GitHub repo `ridemountainpig/tasty-coupon` (auto-updated daily JSON files)

## Key Files
- `app.py` - Flask server with `/api/coupons` endpoint and coupon parsing logic
- `templates/index.html` - Full frontend with filtering UI and coupon cards

## API Endpoint
`GET /api/coupons`
- `region` - Taiwan city name (e.g., 台南市), default: 台南市
- `is_new_user` - true/false, default: false
- `platform` - ubereats, foodpanda, or both

## Features
- Fetches live JSON from GitHub (cached for 30 min)
- Region-based coupon filtering (maps area names to coupon scope)
- Coupon code parsing from raw strings (e.g., "code(點擊複製)" → "code")
- One-click copy coupon code to clipboard + open platform
- Platform tabs (All / Uber Eats / foodpanda)
- Section grouping by coupon category

## Data Source URLs
- Uber Eats: `https://raw.githubusercontent.com/ridemountainpig/tasty-coupon/main/coupon-json/ubereats-coupon.json`
- FoodPanda: `https://raw.githubusercontent.com/ridemountainpig/tasty-coupon/main/coupon-json/foodpanda-coupon.json`
