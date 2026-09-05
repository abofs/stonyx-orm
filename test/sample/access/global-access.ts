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

      // Intentional Gap: This logic does not block access to angela's animals if called individually by id

      // Returning a function will plug it in to response object as a filter
      if (isCollection) return record => record.id !== 'angela';
    }

    // KNOWN DEFECT — abofs/stonyx-orm#256. `record.owner` is the related Record
    // instance, not the id string, so `!== 'angela'` is ALWAYS true: this filter
    // removes nothing and GET /animals serves all of angela's animals. Measured,
    // and pinned by reference-sample.ts so it stays a tracked decision rather
    // than an unnoticed leak. Not fixed here — #256 owns it, and #265 is scoped
    // to the URL-vs-params axis.
    //
    // Note this line also WIDENS #256's surface relative to the pre-#265 code:
    // `url.endsWith('/animals')` was false for /animals/, /ANIMALS and
    // /animals?x=1, whereas `model === 'animals' && isCollection` is true for
    // all of them. That is inert only because the predicate never fires, and it
    // is the correct direction — once #256 lands, the filter applies to every
    // spelling instead of one.
    if (model === 'animals' && isCollection) return record => record.owner !== 'angela';

    // Allows full access to all calls that don't match any of the above conditions
    return ['read', 'create', 'update', 'delete'];
  }
}
