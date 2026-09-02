export function normalizeTruckUnitNumber(value: string) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}
