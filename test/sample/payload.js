/**
 * Sample dataset representing a third party source of data with unfavorable data quality
 */
export default {
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