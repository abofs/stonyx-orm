import { getTimestamp } from "@stonyx/utils/date";

const transforms: Record<string, (value: unknown) => unknown> = {
  boolean: (value: unknown) => typeof value === 'string' ? (value as string).trim().toLowerCase() === 'true' : !!value,
  date: (value: unknown) => value ? new Date(value as string | number) : null,
  float: (value: unknown) => parseFloat(value as string),
  number: (value: unknown) => parseInt(value as string),
  passthrough: (value: unknown) => value,
  string: (value: unknown) => String(value),
  timestamp: (value: unknown) => getTimestamp(value as string | number | Date | undefined),
  trim: (value: unknown) => (value as string)?.trim(),
  uppercase: (value: unknown) => (value as string)?.toUpperCase(),
};

// Math Proxies
(['ceil', 'floor', 'round'] as const).forEach(method => {
  transforms[method] = (value: unknown) => Math[method](value as number);
});

export default transforms;
