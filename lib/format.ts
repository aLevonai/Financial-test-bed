export const SIGNIFICANCE_LABELS: Record<number, string> = {
  5: "Field-level",
  4: "Major",
  3: "Notable",
  2: "Incremental",
  1: "Noise",
};

export function timeAgo(date: Date | null, now = new Date()): string {
  if (!date) return "";
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d ago`;
  return date.toISOString().slice(0, 10);
}
