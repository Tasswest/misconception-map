const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatUtcTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const hour = parsed.getUTCHours();
  const displayHour = hour % 12 || 12;
  const minute = String(parsed.getUTCMinutes()).padStart(2, "0");
  const period = hour < 12 ? "AM" : "PM";
  return `${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${displayHour}:${minute} ${period} UTC`;
}
