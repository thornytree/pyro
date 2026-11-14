/** Hours between an ISO timestamp and `now`, never negative. */
export function ageHours(iso: string, now: Date): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - then) / 3_600_000);
}

export function formatAge(hours: number): string {
  if (!Number.isFinite(hours)) return "unknown";
  if (hours < 1) return `${Math.round(hours * 60)} min ago`;
  if (hours < 48) return `${Math.round(hours)} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
