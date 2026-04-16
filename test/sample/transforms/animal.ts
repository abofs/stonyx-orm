/**
 * Sample custom transform
 */

import { ANIMALS } from '../constants.js';

const codeEnumMap = {}

for (let i = 0; i < ANIMALS.length; i++) codeEnumMap[ANIMALS[i]] = i;

export default function(value) {
  return codeEnumMap[value] || 0;
}
