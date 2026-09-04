/**
 * Sample access control that grants access to all models except for owner Angela
 */
export default class GlobalAccess {
  models = ['owner', 'animal', 'trait', 'category', 'phone-number']; // * instead of an array will allow access to all models

  // Custom logic here
  access(request) {
    // `access` runs after route matching, so `params` is populated and `id` has
    // already been URL-decoded. Never match on request.url (mount-relative) or
    // request.originalUrl (raw client text: query strings, trailing slashes,
    // casing and percent-encoding all move it) — see abofs/stonyx-orm#265.
    const { id } = request.params;

    // The matched route pattern, not the URL the client typed
    const route = request.route?.path;
    const isCollection = route === '/';
    const isRecord = route === '/:id';

    // The plural model name comes from the mount, which is matched
    // case-insensitively, so normalise it before comparing
    const model = request.baseUrl.split('/').pop().toLowerCase();

    if (model === 'owners') {
      // Returning false explicitly denies access
      if (isRecord && id === 'angela') return false;

      // Intentional Gap: This logic does not block access to angela's animals if called individually by id

      // Returning a function will will plug it in to response object as a filter
      if (isCollection) return record => record.id !== 'angela';
    }

    if (model === 'animals' && isCollection) return record => record.owner !== 'angela';

    // Allows full access to all calls that don't match any of the above conditions
    return ['read', 'create', 'update', 'delete'];
  }
}
