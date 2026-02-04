/**
 * Sample access control that grants access to all models except for owner Angela
 */
export default class GlobalAccess {
  models = ['owner', 'animal', 'trait', 'category']; // * instead of an array will allow access to all models
  
  // Custom logic here
  access(request) {
    const { url } = request; // destructure url from express request object

    // Returning false explicitly denies access
    if (url.endsWith('/owners/angela')) return false;

    // Intentional Gap: This logic does not block access to angela's animals if called individually by id

    // Returning a function will will plug it in to response object as a filter
    if (url.endsWith('/owners')) return record => record.id !== 'angela';
    if (url.endsWith('/animals')) return record => record.owner !== 'angela';

    // Allows full access to all calls that don't match any of the above conditions
    return ['read', 'create', 'update', 'delete'];
  }
}
