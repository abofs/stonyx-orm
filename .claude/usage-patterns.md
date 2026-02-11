# Usage Patterns

## 1. Model Definition

Models extend `Model` and use decorators for attributes and relationships:

```javascript
// test/sample/models/animal.js
import { Model, attr, belongsTo, hasMany } from '@stonyx/orm';

export default class AnimalModel extends Model {
  // Attributes with type transforms
  type = attr('animal');      // Custom transform
  age = attr('number');       // Built-in transform
  size = attr('string');

  // Relationships
  owner = belongsTo('owner'); // Many-to-one
  traits = hasMany('trait');  // One-to-many

  // Computed properties
  get tag() {
    return `${this.owner.id}'s ${this.size} animal`;
  }
}
```

**Key Points:**
- Use `attr(type)` for simple attributes
- Use `belongsTo(modelName)` for many-to-one
- Use `hasMany(modelName)` for one-to-many
- Getters work as computed properties
- Relationships auto-establish bidirectionally

## 2. Serializers (Data Transformation)

Serializers map raw data paths to model properties:

```javascript
// test/sample/serializers/animal.js
import { Serializer } from '@stonyx/orm';

export default class AnimalSerializer extends Serializer {
  map = {
    // Nested path mapping
    age: 'details.age',
    size: 'details.c',
    owner: 'details.location.owner',

    // Custom transformation function
    traits: ['details', ({ x:color }) => {
      const traits = [{ id: 1, type: 'habitat', value: 'farm' }];
      if (color) traits.push({ id: 2, type: 'color', value: color });
      return traits;
    }]
  }
}
```

**Key Points:**
- `map` object defines field mappings
- Supports nested paths (`'details.age'`)
- Custom functions for complex transformations
- Handlers receive raw data subset

## 3. Custom Transforms

Transforms convert data types:

```javascript
// test/sample/transforms/animal.js
const codeEnumMap = { 'dog': 1, 'cat': 2, 'bird': 3 };

export default function(value) {
  return codeEnumMap[value] || 0;
}
```

**Built-in Transforms:**
- Type: `boolean`, `number`, `float`, `string`, `date`, `timestamp`
- Math: `round`, `ceil`, `floor`
- String: `trim`, `uppercase`
- Utility: `passthrough`

## 4. CRUD Operations

```javascript
import { createRecord, updateRecord, store } from '@stonyx/orm';

// Create
createRecord('owner', { id: 'bob', age: 30 });

// Read
const owner = store.get('owner', 'bob');
const allOwners = store.get('owner');

// Update
updateRecord(owner, { age: 31 });
// Or direct: owner.age = 31;

// Delete
store.remove('owner', 'bob');
```

## 5. Database Schema

The DB schema is a Model defining top-level collections:

```javascript
// test/sample/db-schema.js
import { Model, hasMany } from '@stonyx/orm';

export default class DBModel extends Model {
  owners = hasMany('owner');
  animals = hasMany('animal');
  traits = hasMany('trait');
}
```

## 6. Persistence

```javascript
import Orm from '@stonyx/orm';

// Save to file
await Orm.db.save();

// Data auto-serializes to JSON file
// Reload using createRecord with serialize:false, transform:false
```

## 7. Access Control

```javascript
// test/sample/access/global-access.js
export default class GlobalAccess {
  models = ['owner', 'animal']; // or '*' for all

  access(request) {
    // Deny specific access
    if (request.url.endsWith('/owner/angela')) return false;

    // Filter collections
    if (request.url.endsWith('/owner')) {
      return record => record.id !== 'angela';
    }

    // Grant CRUD permissions
    return ['read', 'create', 'update', 'delete'];
  }
}
```

## 8. REST API (Auto-generated)

```javascript
// Endpoints auto-generated for models:
// GET    /owners          - List all
// GET    /owners/:id       - Get one
// POST   /animals          - Create
// PATCH  /animals/:id      - Update (attributes and/or relationships)
// DELETE /animals/:id      - Delete
```

**PATCH supports both attributes and relationships:**
```javascript
// Update attributes only
PATCH /animals/1
{ data: { type: 'animal', attributes: { age: 5 } } }

// Update relationship only
PATCH /animals/1
{ data: { type: 'animal', relationships: { owner: { data: { type: 'owner', id: 'gina' } } } } }

// Update both
PATCH /animals/1
{ data: { type: 'animal', attributes: { age: 5 }, relationships: { owner: { data: { type: 'owner', id: 'gina' } } } } }
```

## 9. Include Parameter (Sideloading)

GET endpoints support sideloading related records with **nested relationship traversal**:

```javascript
// Single-level includes
GET /animals/1?include=owner,traits

// Nested includes (NEW!)
GET /animals/1?include=owner.pets,owner.company

// Deep nesting (3+ levels)
GET /scenes/e001-s001?include=slides.dialogue.character

// Response structure (unchanged)
{
  data: { type: 'animal', id: 1, attributes: {...}, relationships: {...} },
  included: [
    { type: 'owner', id: 'angela', ... },
    { type: 'animal', id: 7, ... },    // owner's other pets
    { type: 'animal', id: 11, ... },   // owner's other pets
    { type: 'company', id: 'acme', ... } // owner's company (if requested)
  ]
}
```

**How Nested Includes Work:**
1. Query param parsed into path segments: `owner.pets` -> `[['owner'], ['owner', 'pets'], ['traits']]`
2. `traverseIncludePath()` recursively traverses relationships depth-first
3. Deduplication still by type+id (no duplicates in included array)
4. Gracefully handles null/missing relationships at any depth
5. Each included record gets full `toJSON()` representation

**Key Functions:**
- `parseInclude()` - Splits comma-separated includes and parses nested paths
- `traverseIncludePath()` - Recursively traverses relationship paths
- `collectIncludedRecords()` - Orchestrates traversal and deduplication
- All implemented in [src/orm-request.js](src/orm-request.js)
