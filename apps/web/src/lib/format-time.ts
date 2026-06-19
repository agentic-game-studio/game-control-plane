/** Format an ISO timestamp as MM/DD HH:MM */
export function formatTime(ts: string): string {
  // 10-L4: `new Date("garbage")` does NOT throw — it returns Invalid
  // Date, on which getMonth() returns NaN. The previous try/catch
  // never fired on bad input, so the UI rendered "NaN/NaN NaN:NaN".
  // Bail early when the timestamp doesn't parse.
  if (!ts || typeof ts !== "string") return ts ?? "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hr = String(d.getHours()).padStart(2, "0");
  const mn = String(d.getMinutes()).padStart(2, "0");
  return `${mo}/${day} ${hr}:${mn}`;
}
