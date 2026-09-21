(function (global) {
  const STORAGE_PREFIX = 'pageLang:';
  let pageId = '';
  let dict = { en: {}, ar: {} };
  let lang = 'en';
  let onLangChange = null;

  function getLang() {
    return lang;
  }

  function isAr() {
    return lang === 'ar';
  }

  function t(key, fallback) {
    const val = dict[lang]?.[key] ?? dict.en?.[key];
    if (val != null && val !== '') return val;
    return fallback != null ? fallback : key;
  }

  function applyDom() {
    document.documentElement.lang = lang;
    document.documentElement.dir = isAr() ? 'rtl' : 'ltr';
    document.body.classList.toggle('lang-ar', isAr());

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (el.dataset.i18nHtml === 'true') el.innerHTML = val;
      else el.textContent = val;
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });

    document.querySelectorAll('[data-lang-toggle]').forEach((btn) => {
      btn.textContent = isAr() ? t('lang_switch_en', 'English') : t('lang_switch_ar', 'العربية');
      btn.setAttribute('aria-label', isAr() ? 'Switch to English' : 'التبديل إلى العربية');
    });

    const titleKey = document.body.dataset.i18nTitle;
    if (titleKey) document.title = t(titleKey, document.title);
  }

  function toggle() {
    lang = lang === 'en' ? 'ar' : 'en';
    sessionStorage.setItem(STORAGE_PREFIX + pageId, lang);
    applyDom();
    if (typeof onLangChange === 'function') onLangChange(lang);
  }

  function init(id, translations, options = {}) {
    pageId = id;
    dict = translations || { en: {}, ar: {} };
    lang = sessionStorage.getItem(STORAGE_PREFIX + pageId) || 'en';
    onLangChange = options.onLangChange || null;

    document.querySelectorAll('[data-lang-toggle]').forEach((btn) => {
      if (!btn.dataset.langBound) {
        btn.dataset.langBound = '1';
        btn.addEventListener('click', toggle);
      }
    });

    applyDom();
    if (typeof onLangChange === 'function' && lang === 'ar') onLangChange(lang);
  }

  global.PageTranslate = { init, toggle, t, getLang, isAr, apply: applyDom };
  global.__t = t;
})(window);
