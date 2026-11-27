// UI text in the reader's language. The English text is the key; locales/<code>.js maps it to a translation,
// and anything a locale leaves out shows in English.

/** Each language by its own name, so people can find theirs whatever the page is in. */
export const LANGS = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  ja: '日本語',
  ko: '한국어',
  'pt-BR': 'Português (Brasil)',
  ru: 'Русский',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
};

/** Minecraft's locale codes, for shader packs' lang files. */
export const MC_LOCALE = {
  en: 'en_us',
  de: 'de_de',
  es: 'es_es',
  fr: 'fr_fr',
  ja: 'ja_jp',
  ko: 'ko_kr',
  'pt-BR': 'pt_br',
  ru: 'ru_ru',
  'zh-CN': 'zh_cn',
  'zh-TW': 'zh_tw',
};

/** A browser language tag ("fr-CA", "zh-Hant-HK") to the closest language we have, or null. */
export function match(tag) {
  if (tag in LANGS) return tag;
  const [base] = tag.split('-');
  if (base === 'zh') return /-(TW|HK|MO|Hant)\b/i.test(tag) ? 'zh-TW' : 'zh-CN';
  if (base === 'pt') return 'pt-BR';
  return base in LANGS ? base : null;
}

function pick() {
  try {
    const saved = localStorage.getItem('litweb.lang');
    if (saved in LANGS) return saved;
  } catch {}
  for (const tag of navigator.languages || [navigator.language]) {
    const l = tag && match(tag);
    if (l) return l;
  }
  return 'en';
}

export const lang = pick();

let dict = {};
if (lang !== 'en')
  try {
    dict = (await import(`./locales/${lang}.js`)).default;
  } catch (e) {
    console.warn(`No ${lang} translation, using English`, e);
  }

/** English text that changes with a count. Locales give the forms their language needs (one, few, many, other). */
const EN = {
  'You and {n} players': { one: 'You and {n} player', other: 'You and {n} players' },
  '{owner} and {n} others': { one: '{owner} and {n} other', other: '{owner} and {n} others' },
  '{owner}, you and {n} others': { one: '{owner}, you and {n} other', other: '{owner}, you and {n} others' },
  '{n} blocks': { one: '{n} block', other: '{n} blocks' },
  '{n} shulkers': { one: '{n} shulker', other: '{n} shulkers' },
  '{n} stacks': { one: '{n} stack', other: '{n} stacks' },
  '{n} materials': { one: '{n} material', other: '{n} materials' },
  'Filter {n} materials': { one: 'Filter {n} material', other: 'Filter {n} materials' },
  'Search {n} settings': { one: 'Search {n} setting', other: 'Search {n} settings' },
  '{n} views are hidden from the sidebar, across your servers.': {
    one: '{n} view is hidden from the sidebar, across your servers.',
    other: '{n} views are hidden from the sidebar, across your servers.',
  },
  '{n} effects unavailable': { one: '{n} effect unavailable', other: '{n} effects unavailable' },
  '{n} mobs around the farm': { one: '{n} mob around the farm', other: '{n} mobs around the farm' },
  '{n} furnaces, {pct}% of their top speed of {top} an hour.': {
    one: '{n} furnace, {pct}% of its top speed of {top} an hour.',
    other: '{n} furnaces, {pct}% of their top speed of {top} an hour.',
  },
  "{n} chunks weren't loaded on the server, so they show empty. Go near them in game and recapture.": {
    one: "{n} chunk wasn't loaded on the server, so it shows empty. Go near it in game and recapture.",
    other: "{n} chunks weren't loaded on the server, so they show empty. Go near them in game and recapture.",
  },
};

export const fmt = new Intl.NumberFormat(lang);
const rules = { [lang]: new Intl.PluralRules(lang), en: new Intl.PluralRules('en') };

/**
 * The translation of `key`, with {name} placeholders filled from `vars`. Numbers are formatted for the language,
 * and `vars.n` picks the plural form. Values go in as given, so escape anything that ends up in HTML.
 */
export function t(key, vars = {}) {
  let s = dict[key];
  let rule = rules[lang];
  if (s == null || s === '') {
    s = EN[key] ?? key;
    rule = rules.en;
  }
  if (typeof s === 'object') s = s[rule.select(vars.n)] ?? s.other;
  return s.replace(/\{(\w+)\}/g, (m, k) =>
    k in vars ? (typeof vars[k] === 'number' ? fmt.format(vars[k]) : vars[k]) : m,
  );
}

/** Translates the page's static text and labels, which index.html has in English. */
export function translateDom(root = document.body) {
  document.documentElement.lang = lang;
  if (lang === 'en') return;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const s = n.nodeValue.trim();
    if (s && dict[s]) n.nodeValue = n.nodeValue.replace(s, t(s));
  }
  for (const el of root.querySelectorAll('[placeholder], [aria-label], [data-tip], [title]'))
    for (const a of ['placeholder', 'aria-label', 'data-tip', 'title']) {
      const v = el.getAttribute(a);
      if (v && dict[v]) el.setAttribute(a, t(v));
    }
}
