// @ts-nocheck
/**
 * A raw-socket HTTP/1.1 client — abofs/stonyx-orm#266.
 *
 * #266 records that this repo has no way to put an arbitrary request target on
 * the wire, so any finding about the target itself could only be argued, not
 * measured. `fetch` (and `http.request`, and curl) all normalise the very
 * property under test: a literal space, a bare `?`, an absolute-form target or
 * a `..` segment is rewritten or rejected before it reaches the socket, so a
 * green test proves the client's behaviour rather than the server's.
 *
 * This writes the request line byte-for-byte with node:net. Nothing between the
 * string in the test and the bytes the server parses gets to edit it.
 *
 * Deliberately minimal: no keep-alive, no redirects, no TLS. Every request
 * sends `Connection: close`, so the response ends at FIN and the body needs no
 * framing heuristics beyond de-chunking.
 */
import { connect } from 'node:net';

const CRLF = '\r\n';

/** Splits a raw response into its status line, headers and body. */
function parseResponse(buffer) {
  const text = buffer.toString('latin1');
  const separator = text.indexOf(`${CRLF}${CRLF}`);

  if (separator === -1) throw new Error(`Malformed HTTP response (no header terminator): ${JSON.stringify(text.slice(0, 200))}`);

  const head = text.slice(0, separator);
  let body = text.slice(separator + 4);

  const [statusLine, ...headerLines] = head.split(CRLF);
  const match = /^HTTP\/1\.[01] (\d{3})/.exec(statusLine);

  if (!match) throw new Error(`Malformed HTTP status line: ${JSON.stringify(statusLine)}`);

  const headers = {};

  for (const line of headerLines) {
    const index = line.indexOf(':');
    if (index === -1) continue;

    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }

  if ((headers['transfer-encoding'] ?? '').toLowerCase().includes('chunked')) body = dechunk(body);

  return { status: Number(match[1]), statusLine, headers, body: Buffer.from(body, 'latin1').toString('utf8') };
}

function dechunk(raw) {
  let rest = raw;
  let out = '';

  while (rest.length) {
    const end = rest.indexOf(CRLF);
    if (end === -1) break;

    const size = parseInt(rest.slice(0, end).split(';')[0], 16);
    if (!Number.isFinite(size) || size === 0) break;

    out += rest.slice(end + 2, end + 2 + size);
    rest = rest.slice(end + 2 + size + 2);
  }

  return out;
}

/**
 * Send one request with the target written verbatim.
 *
 * @param {object} options
 * @param {number} options.port
 * @param {string} options.method
 * @param {string} options.target  the request target, byte-for-byte. Origin-form
 *   (`/owners/angela`), absolute-form (`http://evil.example/owners/angela`) and
 *   anything else the test wants on the wire are all passed through untouched.
 * @param {string} [options.host]      Host header value. Defaults to `localhost:<port>`.
 * @param {object} [options.headers]
 * @param {string} [options.body]
 * @returns {Promise<{ status: number, statusLine: string, headers: object, body: string }>}
 */
export function rawRequest({ port, method = 'GET', target, host, headers = {}, body = '', timeout = 10000 }) {
  if (typeof target !== 'string' || target === '') throw new Error('rawRequest requires a target string');

  return new Promise((resolve, reject) => {
    const socket = connect({ port, host: '127.0.0.1' });
    const chunks = [];

    socket.setTimeout(timeout, () => {
      socket.destroy();
      reject(new Error(`rawRequest timed out after ${timeout}ms: ${method} ${target}`));
    });

    socket.on('error', reject);
    socket.on('data', chunk => chunks.push(chunk));

    socket.on('close', () => {
      const buffer = Buffer.concat(chunks);

      if (!buffer.length) return reject(new Error(`rawRequest got an empty response: ${method} ${target}`));

      try {
        resolve(parseResponse(buffer));
      } catch (error) {
        reject(error);
      }
    });

    socket.on('connect', () => {
      const allHeaders = {
        Host: host ?? `localhost:${port}`,
        Accept: 'application/vnd.api+json',
        Connection: 'close',
        ...headers,
      };

      if (body) allHeaders['Content-Length'] = String(Buffer.byteLength(body));

      const lines = [
        `${method} ${target} HTTP/1.1`,
        ...Object.entries(allHeaders).map(([name, value]) => `${name}: ${value}`),
        '',
        body,
      ];

      // latin1 so a byte written into `target` reaches the wire as that byte.
      socket.end(Buffer.from(lines.join(CRLF), 'latin1'));
    });
  });
}

/** Convenience for the common case: parse a JSON:API body, or return undefined. */
export function jsonBody(response) {
  try {
    return JSON.parse(response.body);
  } catch {
    return undefined;
  }
}
