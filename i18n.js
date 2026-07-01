// Language translations for AIMAN Checker
const i18n = {
  id: {
    'nav-tools': 'Alat',
    'nav-faq': 'FAQ',
    'nav-blog': 'Blog',
    'nav-analyzer': 'Analyzer',
    'hero-pill': 'Data live Moz & Ahrefs — bukan estimasi',
    'hero-title': 'Cek <span class="g">DA, PA, DR</span> domain gratis',
    'hero-lead': 'Bulk check 100 domain sekaligus. Data real dari Moz dan Ahrefs, auto-retry kalau ada yang gagal. Cocok buat audit backlink, cari guest post, atau riset kompetitor.',
    'hero-btn1': 'Mulai Cek Domain',
    'hero-btn2': 'Analyze Domain',
    'tool1-title': 'Domain Checker',
    'tool1-desc': 'Cek DA, PA, DR, Spam Score untuk 100 domain sekaligus. Data fresh dari Moz & Ahrefs, export CSV.',
    'tool2-title': 'DR Booster',
    'tool2-desc': 'Cari situs guest post di niche lo + query jurnalis live dari HARO/Featured. Dapet backlink DR tinggi.',
    'tool3-title': 'Domain Analyzer',
    'tool3-desc': 'Masukkan 1 domain, dapet action plan konkret buat naikin DA/PA/DR. Lengkap dengan backlink analysis.',
    'stat1': 'domain per run',
    'stat2': 'rata-rata waktu check',
    'stat3': 'auto-retry domain gagal',
    'stat4': 'data disimpan',
    'faq-title': 'Pertanyaan <span class="g">sering ditanya</span>',
    'faq1-q': 'Datanya real atau estimasi?',
    'faq1-a': '100% real. Kita scrape Moz dan Ahrefs langsung — bukan formula, bukan cache. Kalau Moz bilang DA 62, lo liat DA 62.',
    'faq2-q': 'Berapa domain bisa dicek sekaligus?',
    'faq2-a': 'Public: 10 domain per run, 3x per hari. Login: 100 domain per run, unlimited. Domain yang gagal auto-retry sampai resolve.',
    'faq3-q': 'Domain yang gue cek disimpan ga?',
    'faq3-a': 'Nggak. Semua check bersifat private, nggak ada log, nggak ada database. Request datang, jawaban keluar, selesai.',
    'faq4-q': 'Guest post beneran bisa naikin DR?',
    'faq4-a': 'Bisa, kalau situsnya beneran authority (DR 30+). 1 guest post dari situs DR 60 setara 5-10 link dari situs DR 20. Kualitas > kuantitas.',
    'faq5-q': 'Berapa lama DR naik setelah dapat backlink?',
    'faq5-a': 'Ahrefs crawl web sekitar 2-4 minggu sekali. Lo baru liat pergerakan DR 4-8 minggu setelah backlink live. Sabar, keep building.'
  },
  en: {
    'nav-tools': 'Tools',
    'nav-faq': 'FAQ',
    'nav-blog': 'Blog',
    'nav-analyzer': 'Analyzer',
    'hero-pill': 'Live Moz & Ahrefs data — not estimates',
    'hero-title': 'Check <span class="g">DA, PA, DR</span> for free',
    'hero-lead': 'Bulk check 100 domains at once. Real data from Moz and Ahrefs, auto-retry on failures. Perfect for backlink audits, guest post research, or competitor analysis.',
    'hero-btn1': 'Check Domains',
    'hero-btn2': 'Analyze Domain',
    'tool1-title': 'Domain Checker',
    'tool1-desc': 'Check DA, PA, DR, Spam Score for 100 domains at once. Fresh data from Moz & Ahrefs, CSV export.',
    'tool2-title': 'DR Booster',
    'tool2-desc': 'Find guest post sites in your niche + live journalist queries from HARO/Featured. Get high-DR backlinks.',
    'tool3-title': 'Domain Analyzer',
    'tool3-desc': 'Enter 1 domain, get a concrete action plan to boost DA/PA/DR. Includes backlink analysis.',
    'stat1': 'domains per run',
    'stat2': 'avg check time',
    'stat3': 'auto-retry failures',
    'stat4': 'data stored',
    'faq-title': 'Frequently <span class="g">asked</span>',
    'faq1-q': 'Is the data real or estimated?',
    'faq1-a': '100% real. We scrape Moz and Ahrefs directly — no formulas, no cache. If Moz says DA 62, you see DA 62.',
    'faq2-q': 'How many domains can I check at once?',
    'faq2-a': 'Public: 10 domains per run, 3x per day. Login: 100 domains per run, unlimited. Failed domains auto-retry until resolved.',
    'faq3-q': 'Is my checked data stored?',
    'faq3-a': 'No. All checks are private, no logs, no database. Request comes in, answer goes out, done.',
    'faq4-q': 'Can guest posts actually move DR?',
    'faq4-a': 'Yes, if the site has real authority (DR 30+). One DR 60 guest post = 5-10 DR 20 links. Quality > quantity.',
    'faq5-q': 'How long until DR moves after getting a backlink?',
    'faq5-a': 'Ahrefs crawls the web every 2-4 weeks. You\'ll see DR movement 4-8 weeks after your backlink goes live. Be patient, keep building.'
  }
};

let currentLang = localStorage.getItem('aiman_lang') || 'id';

function applyTranslations() {
  const t = i18n[currentLang];
  if (!t) return;
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
  document.getElementById('langId')?.classList.toggle('active', currentLang === 'id');
  document.getElementById('langEn')?.classList.toggle('active', currentLang === 'en');
  document.documentElement.lang = currentLang;
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('aiman_lang', lang);
  applyTranslations();
  if (typeof renderPosts === 'function') renderPosts();
}

document.addEventListener('DOMContentLoaded', applyTranslations);