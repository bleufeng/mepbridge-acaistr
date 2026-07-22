const SUPPORTED_UI_LOCALES = new Set(['zh-CN', 'en-US']);

function normalizeUiLocale(locale, fallback = 'zh-CN') {
  if (SUPPORTED_UI_LOCALES.has(locale)) {
    return locale;
  }
  return SUPPORTED_UI_LOCALES.has(fallback) ? fallback : 'zh-CN';
}

function isEnglishUiLocale(locale) {
  return normalizeUiLocale(locale) === 'en-US';
}

module.exports = {
  SUPPORTED_UI_LOCALES,
  normalizeUiLocale,
  isEnglishUiLocale,
};
