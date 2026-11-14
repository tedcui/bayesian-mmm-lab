export const units = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
export const dollars = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
}).format(value)
export const percent = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'percent', maximumFractionDigits: 1,
}).format(value)
export const decimal = (value: number, digits = 1) => new Intl.NumberFormat('en-US', {
  maximumFractionDigits: digits, minimumFractionDigits: digits,
}).format(value)
export const dateLabel = (iso: string) => new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${iso}T00:00:00Z`))
