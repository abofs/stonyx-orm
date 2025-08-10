export function get(obj, path) {
  if (arguments.length !== 2) return console.error('Get must be called with two arguments; an object and a property key.');
  if (!obj) return console.error(`Cannot call get with '${path}' on an undefined object.`);
  if (typeof path !== 'string') return console.error('The path provided to get must be a string.');

  for (const key of path.split('.')) {
    if (obj[key] === undefined) return null;

    obj = obj[key];
  }

  return obj;
}

export function getComputedProperties(classInstance) {
  return Object.entries(Object.getOwnPropertyDescriptors(Object.getPrototypeOf(classInstance))).filter(
    ([ key, descriptor ]) => key !== 'constructor' && descriptor.get
  ).map(([ key, descriptor ]) => [ key, descriptor.get ]);
}
