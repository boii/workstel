import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const origin = 'https://workstel.pages.dev';
const local = await readFile('dist/index.html', 'utf8');
const assets = [...local.matchAll(/(?:src|href)="(\/assets\/[^"\s]+\.(?:js|css))"/g)].map(
  (match) => match[1],
);
if (assets.length < 2) throw Error('Expected built JavaScript and CSS assets in dist/index.html.');

let failure = '';
for (let attempt = 1; attempt <= 6; attempt++) {
  try {
    const response = await globalThis.fetch(origin + '/', {
      headers: { 'Cache-Control': 'no-cache' },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('Production HTML returned HTTP ' + response.status + '.');
    const html = await response.text();
    if (!assets.every((asset) => html.includes('"' + asset + '"')))
      throw Error('Production HTML does not reference the expected build assets yet.');
    if (!response.headers.get('x-robots-tag')?.includes('noindex'))
      throw Error('Production noindex header is missing.');
    const csp = response.headers.get('content-security-policy') ?? '';
    const connect = csp.split(';').find((directive) => directive.trim().startsWith('connect-src '));
    const prepared = await readFile('dist/_headers', 'utf8');
    const expectedCsp = prepared.match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1]?.trim();
    if (
      !expectedCsp ||
      csp !== expectedCsp ||
      !connect ||
      /(?:https:|wss:)\s*(?:$|;)/.test(connect)
    )
      throw Error('Production Content-Security-Policy differs from the prepared build.');
    for (const asset of assets) {
      const result = await globalThis.fetch(origin + asset, {
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (!result.ok) throw Error('A deployed build asset returned HTTP ' + result.status + '.');
      const type = result.headers.get('content-type') ?? '';
      if (
        asset.endsWith('.js') ? !/(?:javascript|ecmascript)/.test(type) : !type.includes('text/css')
      )
        throw Error('A deployed asset returned an unexpected content type.');
      await result.body?.cancel();
    }
    console.log(
      'Verified production build assets, scoped CSP and noindex headers at ' + origin + '.',
    );
    process.exit(0);
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Production verification failed.';
    if (attempt < 6) {
      console.log('Waiting for the production deployment to propagate (' + attempt + '/6).');
      await setTimeout(5000);
    }
  }
}
throw Error(failure);
