// 前端設定。Google Maps 的「瀏覽器金鑰」本來就會出現在網頁裡，
// 必須在 Google Cloud Console 限制只能從自己的 GitHub Pages 網址使用（HTTP referrer 限制，規格第 7 節）。
// 留空時，地圖分頁會改成顯示景點卡片清單。
window.APP_CONFIG = {
  MAPS_API_KEY: "",
  NEARBY_RADIUS_M: 200,
  EXPANDED_RADIUS_M: 500
};
