export interface CallingWindowCheckResult {
  isAllowed: boolean;
  reason?: string;
  nextAllowedDate?: Date;
  delayMs?: number;
}

const DAY_NAMES = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

/**
 * Parses "HH:mm" time string into minutes from start of day.
 */
function parseTimeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

/**
 * Formats a Date in a specific timezone to retrieve day of week, hours, and minutes.
 */
function getZonedTimeParts(date: Date, timezone: string): { dayName: string; minutes: number } {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    let day = "";
    let hour = 0;
    let minute = 0;

    for (const part of parts) {
      if (part.type === "weekday") {
        day = part.value.toUpperCase();
      } else if (part.type === "hour") {
        hour = parseInt(part.value, 10);
        if (hour === 24) hour = 0;
      } else if (part.type === "minute") {
        minute = parseInt(part.value, 10);
      }
    }

    return {
      dayName: day,
      minutes: hour * 60 + minute,
    };
  } catch (error) {
    // If timezone is invalid, fallback to UTC
    console.warn(`[Scheduler] Fallback to UTC for invalid timezone '${timezone}':`, error);
    const day = DAY_NAMES[date.getUTCDay()];
    return {
      dayName: day,
      minutes: date.getUTCHours() * 60 + date.getUTCMinutes(),
    };
  }
}

/**
 * Checks whether an outbound call is permitted right now according to campaign scheduling rules.
 */
export function isCallingWindowOpen(
  campaign: {
    scheduledStartTime?: Date | null;
    scheduledEndTime?: Date | null;
    dailyStartTime?: string | null;
    dailyEndTime?: string | null;
    timezone?: string;
    allowedDays?: string[];
  },
  now: Date = new Date()
): CallingWindowCheckResult {
  const tz = campaign.timezone || "UTC";

  // Check absolute campaign schedule boundaries
  if (campaign.scheduledStartTime && now < campaign.scheduledStartTime) {
    const delayMs = campaign.scheduledStartTime.getTime() - now.getTime();
    return {
      isAllowed: false,
      reason: "Campaign scheduled start time has not arrived yet",
      nextAllowedDate: campaign.scheduledStartTime,
      delayMs,
    };
  }

  if (campaign.scheduledEndTime && now > campaign.scheduledEndTime) {
    return {
      isAllowed: false,
      reason: "Campaign scheduled end time has already elapsed",
    };
  }

  const { dayName, minutes: currentMinutes } = getZonedTimeParts(now, tz);

  // Check permitted days of the week
  const allowedDays = campaign.allowedDays && campaign.allowedDays.length > 0
    ? campaign.allowedDays
    : ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

  if (!allowedDays.includes(dayName)) {
    return {
      isAllowed: false,
      reason: `Today (${dayName}) is not an allowed calling day for this campaign`,
      delayMs: 3600 * 1000, // Check again in 1 hour
    };
  }

  // Check daily calling window hours (e.g. 09:00 - 18:00)
  const startMinutes = parseTimeToMinutes(campaign.dailyStartTime || "09:00");
  const endMinutes = parseTimeToMinutes(campaign.dailyEndTime || "18:00");

  if (currentMinutes < startMinutes) {
    const diffMinutes = startMinutes - currentMinutes;
    return {
      isAllowed: false,
      reason: `Before daily start time (${campaign.dailyStartTime || "09:00"} ${tz})`,
      delayMs: diffMinutes * 60 * 1000,
    };
  }

  if (currentMinutes >= endMinutes) {
    return {
      isAllowed: false,
      reason: `After daily end time (${campaign.dailyEndTime || "18:00"} ${tz})`,
      delayMs: 3600 * 1000, // Recheck in 1 hour
    };
  }

  return { isAllowed: true };
}

