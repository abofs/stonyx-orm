import { getTimestamp } from "@stonyx/utils/date";

const transforms = {
  boolean: value => typeof value === 'string' ? value.trim().toLowerCase() === 'true' : !!value,
  date: value => value ? new Date(value) : null,
  float: value => parseFloat(value),
  number: value => parseInt(value),
  passthrough: value => value,
  string: value => String(value),
  timestamp: value => getTimestamp(value),
  trim: value => value?.trim(),
  uppercase: value => value?.toUpperCase(),
};

// Math Proxies
['ceil', 'floor', 'round'].forEach(method => {
  transforms[method] = value => Math[method](value);
});

export default transforms;
