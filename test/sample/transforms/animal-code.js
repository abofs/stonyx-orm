/**
 * Sample custom transform
 */
const codeEnumMap = {
  unknown: 0,
  dog: 1,
  cat: 2,
  goat: 3,
  horse: 4
};

export default function(value) {
  return codeEnumMap[value] || 0;
}
