export function formatCents(cents, opts = {}) {
  if (cents == null) return '—';
  const { signed = false, abs = false } = opts;
  const amount = abs ? Math.abs(cents) : cents;
  const formatted = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount / 100);
  if (signed && cents > 0) return `+${formatted}`;
  return formatted;
}

export function formatDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

export function formatMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

export function pct(part, whole) {
  if (!whole) return 0;
  return clamp(Math.round((part / whole) * 100), 0, 100);
}
