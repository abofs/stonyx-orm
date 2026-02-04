/**
 * Sample dataset representing a third party source of data with unfavorable data quality
 */
export const raw = {
  animals: [
    { id: 1, type: 'dog', details: { age: 2, c: 'small', x: 'black', location: { type: 'farm', owner: 'angela' }}},
    { id: 2, type: 'dog', details: { age: 7, c: 'medium', x: 'white', location: { type: 'farm', owner: 'michael' }}},
    { id: 3, type: 'dog', details: { age: 5, c: 'medium', x: 'tan', location: { type: 'farm', owner: 'angela' }}},
    { id: 4, type: 'dog', details: { age: 3, c: 'small', x: 'golden', location: { type: 'farm', owner: 'gina' }}},
    { id: 5, type: 'dog', details: { age: 4, c: 'medium', x: 'brown', location: { type: 'farm', owner: 'bob' }}},
    { id: 6, type: 'goat', details: { age: 1, c: 'small', x: 'black', location: { type: 'farm', owner: 'michael' }}},
    { id: 7, type: 'goat', details: { age: 6, c: 'medium', x: 'white', location: { type: 'farm', owner: 'angela' }}},
    { id: 8, type: 'goat', details: { age: 8, c: 'large', x: 'tan', location: { type: 'farm', owner: 'gina' }}},
    { id: 9, type: 'goat', details: { age: 8, c: 'medium', x: 'golden', location: { type: 'farm', owner: 'michael' }}},
    { id: 10, type: 'goat', details: { age: 5, c: 'small', x: 'brown', location: { type: 'farm', owner: 'angela' }}},
    { id: 11, type: 'cat', details: { age: 2, c: 'small', x: 'black', location: { type: 'farm', owner: 'angela' }}},
    { id: 12, type: 'cat', details: { age: 8, c: 'large', x: 'white', location: { type: 'farm', owner: 'michael' }}},
    { id: 13, type: 'cat', details: { age: 6, c: 'medium', x: 'tan', location: { type: 'farm', owner: 'gina' }}},
    { id: 14, type: 'cat', details: { age: 3, c: 'small', x: 'golden', location: { type: 'farm', owner: 'bob' }}},
    { id: 15, type: 'cat', details: { age: 7, c: 'medium', x: 'brown', location: { type: 'farm', owner: 'angela' }}},
    { id: 16, type: 'horse', details: { age: 5, c: 'medium', x: 'black', location: { type: 'farm', owner: 'michael' }}},
    { id: 17, type: 'horse', details: { age: 3, c: 'small', x: 'white', location: { type: 'farm', owner: 'angela' }}},
    { id: 18, type: 'horse', details: { age: 7, c: 'large', x: 'tan', location: { type: 'farm', owner: 'gina' }}},
    { id: 19, type: 'horse', details: { age: 1, c: 'small', x: 'golden', location: { type: 'farm', owner: 'bob' }}},
    { id: 20, type: 'horse', details: { age: 4, c: 'medium', x: 'brown', location: { type: 'farm', owner: 'angela' }}}
  ],
  owners: [
    { name: 'gina', sex: 'female', age: 34, children: 0, favoriteFruit: 'apple' },
    { name: 'michael', sex: 'male', age: 38, children: 3, favoriteColor: 'blue' },
    { name: 'angela', sex: 'female', age: 36, children: 3, favoriteDeveloper: 'Stone' },
    { name: 'bob', sex: 'male', age: 44, children: 1, favoriteMovie: 'Inception' }
  ]
}

export const serialized = {
  owners: [
    { id: 'gina', gender: 'female', age: 34, pets: [ 4, 8, 13, 18 ], testModels: [] },
    { id: 'michael', gender: 'male', age: 38, pets: [ 2, 6, 9, 12, 16 ], testModels: [] },
    { id: 'angela', gender: 'female', age: 36, pets: [ 1, 3, 7, 10, 11, 15, 17, 20 ], testModels: [] },
    { id: 'bob', gender: 'male', age: 44, pets: [ 5, 14, 19 ], testModels: [] }
  ],
  animals: [
    { id: 1, type: 1, age: 2, size: 'small', owner: 'angela', traits: [ 1, 2 ] },
    { id: 2, type: 1, age: 7, size: 'medium', owner: 'michael', traits: [ 1, 3 ] },
    { id: 3, type: 1, age: 5, size: 'medium', owner: 'angela', traits: [ 1 ] },
    { id: 4, type: 1, age: 3, size: 'small', owner: 'gina', traits: [ 1 ] },
    { id: 5, type: 1, age: 4, size: 'medium', owner: 'bob', traits: [ 1 ] },
    { id: 6, type: 3, age: 1, size: 'small', owner: 'michael', traits: [ 1, 2 ] },
    { id: 7, type: 3, age: 6, size: 'medium', owner: 'angela', traits: [ 1, 3 ] },
    { id: 8, type: 3, age: 8, size: 'large', owner: 'gina', traits: [ 1 ] },
    { id: 9, type: 3, age: 8, size: 'medium', owner: 'michael', traits: [ 1 ] },
    { id: 10, type: 3, age: 5, size: 'small', owner: 'angela', traits: [ 1 ] },
    { id: 11, type: 2, age: 2, size: 'small', owner: 'angela', traits: [ 1, 2 ] },
    { id: 12, type: 2, age: 8, size: 'large', owner: 'michael', traits: [ 1, 3 ] },
    { id: 13, type: 2, age: 6, size: 'medium', owner: 'gina', traits: [ 1 ] },
    { id: 14, type: 2, age: 3, size: 'small', owner: 'bob', traits: [ 1 ] },
    { id: 15, type: 2, age: 7, size: 'medium', owner: 'angela', traits: [ 1 ] },
    { id: 16, type: 4, age: 5, size: 'medium', owner: 'michael', traits: [ 1, 2 ] },
    { id: 17, type: 4, age: 3, size: 'small', owner: 'angela', traits: [ 1, 3 ] },
    { id: 18, type: 4, age: 7, size: 'large', owner: 'gina', traits: [ 1 ] },
    { id: 19, type: 4, age: 1, size: 'small', owner: 'bob', traits: [ 1 ] },
    { id: 20, type: 4, age: 4, size: 'medium', owner: 'angela', traits: [ 1 ] }
  ],
  traits: [
    { id: 1, type: 'habitat', value: 'farm', category: 'physical' },
    { id: 2, type: 'color', value: 'black', category: 'appearance' },
    { id: 3, type: 'color', value: 'white', category: 'appearance' },
  ],
  categories: [
    { id: 'physical', name: 'Physical Attributes' },
    { id: 'appearance', name: 'Appearance Attributes' }
  ]
};
