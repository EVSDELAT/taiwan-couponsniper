# 台灣外送優惠券查詢

這是一個提供台灣使用者查詢外送優惠券的網站，目前整合 **Uber Eats** 與 **foodpanda**，可依縣市、使用者身分及優惠類型快速篩選，並支援一鍵複製優惠碼與開啟外送平台。

網站由 **EVS-ZHAO TECH©** 製作並免費提供使用。

## 主要功能

- 每三小時由 GitHub Actions 更新優惠資料快取
- 支援 Uber Eats 與 foodpanda
- 可依台灣縣市篩選優惠
- 支援全部用戶、新用戶及舊用戶
- 台灣行政區域地圖選擇與自動定位
- 依優惠代碼、免輸碼優惠及分類篩選
- 一鍵複製優惠碼並開啟對應平台
- 顯示資料更新日期
- LINE 聯絡與問題回報入口
- 響應式設計，支援電腦與手機瀏覽

## 線上網站

- GitHub Pages：<https://evsdelat.github.io/taiwan-couponsniper/>
- ChatGPT Site：<https://taiwan-coupon-sniper.twgemini03.chatgpt.site/>

## 資料來源

優惠資料來源為：

- <https://github.com/ridemountainpig/tasty-coupon>
- <https://kb56.tw/uber-eats-coupon/>
- <https://kb56.tw/foodpanda-coupon/>

優惠內容、適用資格及期限可能隨時調整，實際資訊請以外送平台結帳頁面為準。

GitHub Pages 讀取專案內的 docs/coupons.json，不會讓每位訪客直接呼叫第三方來源。排程抓取、錯誤備援與資料流請見 docs/05_系統架構說明.md。

## 專案結構

```text
worker/index.js              ChatGPT Site／Cloudflare Worker 版本
docs/index.html              GitHub Pages 靜態版本
scripts/build-pages.mjs      產生 GitHub Pages 頁面的工具
scripts/build.sh             ChatGPT Site 建置工具
.github/workflows/pages.yml  GitHub Pages 自動部署流程
```

## 部署方式

### GitHub Pages

在儲存庫的 **Settings → Pages** 將來源設定為 **GitHub Actions**。完成後，每次更新 `main` 分支都會自動重新發布。

### ChatGPT Site

ChatGPT Site 版本使用 Worker 執行環境，包含伺服器端優惠資料整理與定位反查功能。

### GitHub Actions 排程

.github/workflows/pages.yml 每三小時執行一次 scripts/fetch-coupons.mjs，成功後更新 docs/coupons.json，並在同一次工作流程發布 Pages。若來源暫時失敗，會保留上一份成功快取。

## 授權與聲明

網站程式與介面由 EVS-ZHAO TECH© 維護。優惠資料及平台商標分別屬於其原始提供者與權利人所有。
