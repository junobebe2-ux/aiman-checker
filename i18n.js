// Language translations for AIMAN Checker
// Include this script in all pages: <script src="/i18n.js"></script>

const i18n = {
  id: {
    // Nav
    'nav-tools': 'Alat',
    'nav-tutorial': 'Tutorial',
    'nav-faq': 'FAQ',
    'nav-analyzer': 'Analyzer',
    'nav-checker': 'Domain Checker',
    'nav-dr-booster': 'DR Booster',
    'nav-blog': 'Blog',
    'nav-login': 'Login',
    
    // Hero
    'hero-pill': 'Data live Moz & Ahrefs · bukan estimasi',
    'hero-title': 'Metrik SEO yang <span class="g">bisa dipercaya.</span>',
    'hero-lead': 'Cek DA, PA, DR, dan Spam Score untuk 100 domain sekaligus. Temukan situs guest post DR tinggi dan query jurnalis live. Data asli, diretry sampai semua domain resolve.',
    'hero-btn-primary': 'Mulai Cek',
    'hero-btn-secondary': 'Cari Backlink',
    
    // Common
    'lang-id': 'ID',
    'lang-en': 'EN',
    'loading': 'Loading...',
    'error': 'Error',
    'success': 'Success'
  },
  
  en: {
    // Nav
    'nav-tools': 'Tools',
    'nav-tutorial': 'Tutorial',
    'nav-faq': 'FAQ',
    'nav-analyzer': 'Analyzer',
    'nav-checker': 'Domain Checker',
    'nav-dr-booster': 'DR Booster',
    'nav-blog': 'Blog',
    'nav-login': 'Login',
    
    // Hero
    'hero-pill': 'Live Moz & Ahrefs data · not estimates',
    'hero-title': 'SEO metrics you <span class="g">can trust.</span>',
    'hero-lead': 'Check DA, PA, DR, and Spam Score for 100 domains at once. Find high-DR guest post sites and live journalist queries. Real data, retried until all domains resolve.',
    'hero-btn-primary': 'Start Checking',
    'hero-btn-secondary': 'Find Backlinks',
    
    // Common
    'lang-id': 'ID',
    'lang-en': 'EN',
    'loading': 'Loading...',
    'error': 'Error',
    'success': 'Success'
  }
};

// Language state
let currentLang = localStorage.getItem('aiman_lang') || 'id';

// Apply translations to page
function applyTranslations() {
  const t = i18n[currentLang];
  if (!t) return;
  
  // Update all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const value = t[key];
    if (value) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = value;
      } else {
        el.innerHTML = value;
      }
    }
  });
  
  // Update lang buttons
  document.getElementById('langId')?.classList.toggle('active', currentLang === 'id');
  document.getElementById('langEn')?.classList.toggle('active', currentLang === 'en');
  
  // Update html lang attribute
  document.documentElement.lang = currentLang;
}

// Set language
function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('aiman_lang', lang);
  applyTranslations();
  
  // Re-render dynamic content if exists
  if (typeof renderPosts === 'function') renderPosts();
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', applyTranslations);