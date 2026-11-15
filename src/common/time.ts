/**
 * Múi giờ nghiệp vụ dùng để chia số liệu theo ngày. Một yêu cầu gửi lúc 23:30
 * giờ Việt Nam phải được tính vào đúng ngày đó, không phải ngày UTC.
 */
export const businessTimeZone = 'Asia/Ho_Chi_Minh';

const dayMs = 24 * 60 * 60 * 1000;

/** Ngày hiện tại (YYYY-MM-DD) theo múi giờ nghiệp vụ. */
export function todayInBusinessZone(now = new Date()) {
  // en-CA định dạng ngày theo ISO: YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: businessTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Cộng/trừ số ngày cho chuỗi YYYY-MM-DD (lịch thuần, không phụ thuộc giờ). */
export function addDays(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00Z`);
  return new Date(date.getTime() + amount * dayMs).toISOString().slice(0, 10);
}

/** Danh sách ngày liên tiếp từ `from` tới `to` (bao gồm hai đầu). */
export function dayRange(from: string, to: string) {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}
