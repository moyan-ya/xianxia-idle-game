/**
 * 时间工具：MySQL DATETIME 以字符串返回（dateStrings），统一手工解析，
 * 避免 new Date('YYYY-MM-DD HH:mm:ss') 在不同运行时的歧义。
 */
function parseDateTime(value) {
  if (!value) return Date.now();
  if (value instanceof Date) return value.getTime();
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return new Date(value).getTime();
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

function formatDateTime(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 秒 → 「1天2小时」这种中文时长 */
function humanDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}天`);
  if (h) parts.push(`${h}小时`);
  if (!d && !h) {
    // 不足一小时时把秒也带上，否则 61 秒和 119 秒会显示成同一个"1分"
    if (m) parts.push(`${m}分`);
    if (sec || !m) parts.push(`${sec}秒`);
  } else if (m) {
    parts.push(`${m}分`);
  }
  return parts.slice(0, 2).join('');
}

module.exports = { parseDateTime, formatDateTime, humanDuration };
