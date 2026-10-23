// Injecting a run (and boot settings) into the single-file viewer HTML.
// The viewer's own inlined JavaScript contains strings like "</head>", so we always
// insert before the LAST </head>, and our own tags are built at runtime so their
// exact markup never appears in the bundle (and can't be matched inside code).

const TAG = ['scr', 'ipt'].join('');
const BOOT_ID = ['ir', 'boot'].join('-');
const TRACE_ID = ['intent', 'trace'].join('-');

const esc = (s: string) => s.replace(/</g, '\\u003c');

export function bootTag(boot: object): string {
  return `<${TAG} id="${BOOT_ID}">window.__INTENT_BOOT__=${esc(JSON.stringify(boot))}</${TAG}>`;
}

export function traceTag(traceJson: string): string {
  return `<${TAG} id="${TRACE_ID}" type="application/json">${esc(traceJson)}</${TAG}>`;
}

/** Removes tags a previous injection added (e.g. when exporting from a CLI-served page). */
export function stripInjected(html: string): string {
  const boot = new RegExp(`<${TAG} id="${BOOT_ID}">[^<]*</${TAG}>`, 'g');
  const trace = new RegExp(`<${TAG} id="${TRACE_ID}" type="application/json">[^<]*</${TAG}>`, 'g');
  return html.replace(boot, '').replace(trace, '');
}

export function injectIntoHead(html: string, tags: string): string {
  const i = html.lastIndexOf('</head>');
  return i < 0 ? tags + html : html.slice(0, i) + tags + html.slice(i);
}
