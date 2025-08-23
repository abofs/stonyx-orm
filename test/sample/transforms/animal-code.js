/**
 * Sample custom transform
 */

import { ANIMAL_CODES } from '../constants.js';

const codeEnumMap = {}

for (let i = 0; i < ANIMAL_CODES.length; i++) codeEnumMap[ANIMAL_CODES[i]] = i;

export default function(value) {
  return codeEnumMap[value] || 0;
}
