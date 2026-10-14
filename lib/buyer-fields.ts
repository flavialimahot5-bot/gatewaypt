export function formatCpf(value: string) {
  return value.replace(/\D/g, "").slice(0, 11)
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3}\.\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3}\.\d{3}\.\d{3})(\d)/, "$1-$2");
}

export function normalizeBrazilPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  // DDD 55 is also Brazilian: remove the country code only when explicit
  // or when the complete number has 12/13 digits. Never truncate input.
  return digits.startsWith("55") && (/^\s*\+55/.test(value) || digits.length === 12 || digits.length === 13)
    ? digits.slice(2) : digits;
}

export function formatPhone(value: string) {
  const digits = normalizeBrazilPhone(value);
  if (digits.length > 11) return value;
  if (digits.length <= 2) return digits;
  const local = digits.slice(2);
  const split = local.length > 8 ? 5 : 4;
  return `(${digits.slice(0, 2)}) ${local.slice(0, split)}${local.length > split ? "-" + local.slice(split) : ""}`;
}

// Check digits validate the number's structure, not registration or ownership.
export function validCpf(value: string) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  for (const length of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(value[i]) * (length + 1 - i);
    const digit = (sum * 10) % 11 % 10;
    if (digit !== Number(value[length])) return false;
  }
  return true;
}
