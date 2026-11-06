/**
 * Finds style values written as literals where a shared token exists (DESIGN_REFERENCE.md,
 * "Centralized style tokens"). A deliberate exception carries a `token-exempt: <reason>`
 * comment on the same line or the line above.
 */
export interface StyleViolation {
  line: number;
  rule: string;
  text: string;
}

const SPACE_SCALE = new Set([2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32]);
const ICON_SCALE = new Set([14, 16, 18, 22, 28, 32]);
const LEADING = new Set(['1.4', '1.5', '1.6', '1.7']);
const EXEMPT = /token-exempt:\s*\S/;

function declarationRule(property: string, value: string): string | null {
  if (property.startsWith('--')) return null;
  if (/#[0-9a-f]{3,8}\b/i.test(value) || /\b(?:rgb|hsl)a?\(\s*\d/i.test(value))
    return 'colour literal: use a --workstel-* colour token or rgb(var(--v-theme-*))';
  if (property === 'font-size' && /\d(?:\.\d+)?(?:px|rem|em)\b/.test(value))
    return 'font size: use --workstel-font-*';
  if (property === 'font-weight' && /^\d{3}\b/.test(value))
    return 'font weight: use --workstel-weight-*';
  if (property === 'line-height' && LEADING.has(value.replace('!important', '').trim()))
    return 'line height: use --workstel-leading-*';
  if (property === 'letter-spacing' && /-?\d*\.?\d+(?:px|em)\b/.test(value))
    return 'letter spacing: use --workstel-tracking-*';
  if (property === 'border-radius' && /(?:^|\s)[1-9]\d*px\b/.test(value))
    return 'radius: use --workstel-radius-*';
  if (/^(?:gap|row-gap|column-gap|padding|margin)(?:-[a-z-]+)?$/.test(property)) {
    for (const match of value.matchAll(/(^|[\s(,])(\d+)px\b/g))
      if (SPACE_SCALE.has(Number(match[2]))) return 'spacing: use --workstel-space-*';
  }
  if (/^(?:min-|max-)?(?:height|width)$/.test(property) && /(?:^|\s)44px\b/.test(value))
    return 'touch target: use --workstel-touch-target';
  if (property === 'z-index' && /^\d{2,}\b/.test(value)) return 'stacking: use --workstel-z-*';
  return null;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

function exempt(lines: string[], line: number): boolean {
  return EXEMPT.test(lines[line - 1] ?? '') || EXEMPT.test(lines[line - 2] ?? '');
}

/** Checks CSS text; `offset` is the line number the text starts on in its file. */
export function checkCss(css: string, lines: string[], offset = 1): StyleViolation[] {
  const found: StyleViolation[] = [];
  // Comments may contain ":" and ";", so blank them out but keep line numbers.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  // The :root token block in src/styles.css defines the tokens themselves.
  for (const match of code.matchAll(/(^|[{;\s])([a-z-]+)\s*:\s*([^;{}]+);/g)) {
    const rule = declarationRule(match[2], match[3].trim());
    if (!rule) continue;
    const line = offset - 1 + lineOf(code, (match.index ?? 0) + match[1].length);
    if (!exempt(lines, line)) found.push({ line, rule, text: lines[line - 1].trim() });
  }
  return found;
}

/** Checks a Vue template; `offset` is the line number the template starts on. */
export function checkTemplate(template: string, lines: string[], offset = 1): StyleViolation[] {
  const found: StyleViolation[] = [];
  const add = (index: number, rule: string) => {
    const line = offset - 1 + lineOf(template, index);
    if (!exempt(lines, line)) found.push({ line, rule, text: lines[line - 1].trim() });
  };
  for (const match of template.matchAll(/\s(?:bg-)?color="#[0-9a-f]{3,8}"/gi))
    add(match.index ?? 0, 'colour literal: use color="var(--workstel-*)"');
  for (const tag of template.matchAll(/<v-icon\b[^<>]*?>/gs)) {
    const size = /\ssize="(\d+)"/.exec(tag[0]);
    if (size && ICON_SCALE.has(Number(size[1])))
      add((tag.index ?? 0) + size.index, 'icon size: use size="var(--workstel-icon-*)"');
  }
  for (const match of template.matchAll(/\s:(?:max-)?width="\d+"/g))
    add(match.index ?? 0, 'dialog width: use dialogWidth from shared/dialog-widths');
  return found;
}

/** Checks one stylesheet or single-file component. */
export function checkStyleFile(path: string, text: string): StyleViolation[] {
  const lines = text.split('\n');
  if (path.endsWith('.css')) {
    // src/styles.css opens with the :root block that defines every token.
    const start = path.endsWith('src/styles.css') ? text.indexOf('\n}\n') + 3 : 0;
    return checkCss(text.slice(start), lines, lineOf(text, start));
  }
  const found: StyleViolation[] = [];
  for (const block of text.matchAll(/(<style[^>]*>)([\s\S]*?)<\/style>/g)) {
    const start = (block.index ?? 0) + block[1].length;
    found.push(...checkCss(block[2], lines, lineOf(text, start)));
  }
  const template = /<template>[\s\S]*<\/template>/.exec(text);
  if (template) found.push(...checkTemplate(template[0], lines, lineOf(text, template.index)));
  return found;
}
