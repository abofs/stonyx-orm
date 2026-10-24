/**
 * Sample access control that grants access to all models except for owner Angela
 */
export default class GlobalAccess {
  models = ['owner', 'animal', 'trait', 'category', 'phone-number']; // * instead of an array will allow access to all models

  // Custom logic here
  access(request) {
    // `request.recordId` is the id the ORM resolves the record by. The ORM
    // computes it before access() runs, from the URL-decoded `params.id`, using
    // the same function the lookup uses — so this predicate cannot disagree
    // with the record it is authorizing (abofs/stonyx-orm#270). There is no id
    // arithmetic to hand-copy here, which is the point.
    //
    // Never match on request.url (mount-relative) or request.originalUrl (raw
    // client text: query strings, trailing slashes, casing and percent-encoding
    // all move it) — see abofs/stonyx-orm#265.
    const { recordId } = request;

    // The matched route pattern, not the URL the client typed
    const route = request.route?.path;
    const isCollection = route === '/';
    const isRecord = route === '/:id';

    // The plural model name comes from the mount, which is matched
    // case-insensitively, so normalise it before comparing
    const model = request.baseUrl.split('/').pop().toLowerCase();

    if (model === 'owners') {
      // Returning false explicitly denies access
      if (isRecord && recordId === 'angela') return false;

      // Intentional Gap: this denies only /owners/angela and filters angela out of
      // /owners. Her data is still served on related routes: her animals by id
      // (/animals/1), her full owner record via an animal (/animals/1/owner), its
      // linkage (/animals/1/relationships/owner), and her pets (/owners/angela/pets).
      // A per-route deny is not a record boundary.

      // Returning a function will plug it in to response object as a filter
      if (isCollection) return record => record.id !== 'angela';
    }

    // A belongsTo is the related Record, not its id: compare `.id` (`?.` so an unowned animal cannot 500 the collection)
    if (model === 'animals' && isCollection) return record => record.owner?.id !== 'angela';

    // Allows full access to all calls that don't match any of the above conditions
    return ['read', 'create', 'update', 'delete'];
  }
}
