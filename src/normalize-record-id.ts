/*
 * Copyright 2025 Stone Costa
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The ONE place a URL id is turned into the value a record is resolved by —
 * abofs/stonyx-orm#270.
 *
 * Before this existed the same expression was written out seven times: twice in
 * README.md, once in docs/usage-patterns.md, and four times inside the
 * framework. The framework's copy — `getId()`, module-private in
 * orm-request.ts, unreachable through the package `exports` map — was the one
 * that decided which record a request addressed, and a consumer's `access()`
 * predicate had no way to obtain it. So the framework resolved the record by
 * one value and asked the consumer to authorize on a different one.
 *
 * Measured consequence at the time of filing: with the documented predicate
 * applied verbatim to a numeric-id model, `GET /animals/007`, `/7.9`, `/7e0`,
 * `/0x7`, `/%207`, `/%2B7` and `/7%0A` each served the protected record, and
 * `DELETE /animals/007` destroyed it — because `parseInt` folds every one of
 * those onto `7` while `'007' === '7'` is false.
 *
 * Two things follow from this being a single exported function, and both are
 * the point:
 *
 *  1. A permissive change here is HARMLESS, because both sides move together.
 *     Lowercasing string ids used to disclose and destroy `owner:angela` with
 *     the whole suite green; with one implementation the predicate simply sees
 *     the same lowercased value and still refuses.
 *  2. A divergence — a second, private normaliser at the resolution site — is
 *     what is now dangerous, and that is what the tests pin, by observing the
 *     key the resolution path actually used.
 *
 * SEMANTICS ARE UNCHANGED FROM `getId()`, deliberately and byte-for-byte.
 * Whether `7.9` / `0x7` / `%0A` *should* resolve to record 7 at all is a real
 * question, and it is a behaviour change on the record-resolution path for
 * every consumer rather than an authorization fix — it belongs in its own
 * issue with its own compatibility argument (issue body scope item 4). #270
 * preserves today's semantics exactly and makes both sides agree on them.
 *
 * Two details are load-bearing and are pinned by
 * test/unit/normalize-record-id-test.ts:
 *
 *  - `parseInt` is called with NO RADIX. `parseInt('0x7')` is 7;
 *    `parseInt('0x7', 10)` is 0. Adding the radix looks like a cleanup and
 *    silently changes which record every hex-spelled URL addresses.
 *  - The coercion applies only when the id LOOKS numeric, so a model with
 *    string ids is passed through untouched, case included.
 *
 * Must stay synchronous: `auth()` is invoked without `await` by
 * @stonyx/rest-server, so a promise here would be handed to `access()` as the
 * record id.
 *
 * @param id the raw, already-URL-decoded id text from `request.params.id`
 * @returns the value the ORM resolves the record by
 */
export default function normalizeRecordId(id?: string | null): string | number {
  if (!id) return '';
  if (isNaN(id as unknown as number)) return id;

  return parseInt(id);
}
