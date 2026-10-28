export function beijing(value: string, date = false): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(date ? { year: 'numeric', month: '2-digit', day: '2-digit' } : {}),
  }).format(new Date(value));
}
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
export const awardLabels = {
  pending: '待现场核验',
  unclaimed: '尚未领取',
  claimed: '已领取',
  waived: '放弃领奖',
  disqualified: '资格已取消',
};
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
