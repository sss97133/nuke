// Barrett-Jackson pages serve each photo through Cloudflare's resizer at several widths
// ("https://www.barrett-jackson.com/cdn-cgi/image/width=640,quality=75,format=webp/https://BarrettJacksonCDN.azureedge.net/..."),
// so one photo read as up to six URLs: the 2026 Palm Beach Camaro RS went from 15 photos to 80 rows on one re-read
// (2026-10-18). A photo is its origin URL. Pure; tested in imageUrl.test.ts.

/** The origin URL of a resized photo URL, or the URL as it is. */
export function originImageUrl(url: string): string {
  const m = url.match(/\/cdn-cgi\/image\/[^/]+\/(https?:\/\/.+)$/i);
  return m ? m[1] : url;
}
