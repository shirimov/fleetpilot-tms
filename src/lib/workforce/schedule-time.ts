export function shiftDurationMinutes(startMinute: number, endMinute: number) {
  return ((endMinute - startMinute + 1440) % 1440) || 1440;
}

export function safeScheduledWorkingMinutes(schedule: {
  isWorking: boolean;
  startMinute: number | null;
  endMinute: number | null;
  breakMinutes: number;
}) {
  if (!schedule.isWorking || schedule.startMinute === null || schedule.endMinute === null) return 0;
  return Math.max(0, shiftDurationMinutes(schedule.startMinute, schedule.endMinute) - schedule.breakMinutes);
}

export function safeExpectedTaskCapacityMinutes(schedule: {
  isWorking: boolean;
  capacityMinutes: number;
} | null) {
  return Math.max(0, schedule?.isWorking ? schedule.capacityMinutes : 0);
}
