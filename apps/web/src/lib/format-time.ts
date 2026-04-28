/** Format an ISO timestamp as MM/DD HH:MM */
export function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hr = String(d.getHours()).padStart(2, "0");
    const mn = String(d.getMinutes()).padStart(2, "0");
    return `${mo}/${day} ${hr}:${mn}`;
  } catch {
    return ts;
  }
}
