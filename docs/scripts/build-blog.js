const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

// Create DOMPurify instance for server-side sanitization
const window = new JSDOM('').window;
const purify = createDOMPurify(window);

// Configuration
const POSTS_DIR = path.join(__dirname, '../blog/posts');
const BLOG_DIR = path.join(__dirname, '../blog');
const WORDS_PER_MINUTE = 200;

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} unsafe - Unsafe string
 * @returns {string} - Escaped string
 */
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Sanitize HTML to prevent XSS using DOMPurify
 * @param {string} dirty - Dirty HTML
 * @returns {string} - Clean, safe HTML
 */
function sanitizeHtml(dirty) {
  return purify.sanitize(dirty);
}

// Configure marked for GFM and code blocks
marked.setOptions({
  gfm: true,
  breaks: true
});

/**
 * Calculate reading time from content
 * @param {string} content - Markdown content
 * @returns {string} - Reading time as "X min read"
 */
function calculateReadingTime(content) {
  const words = content.split(/\s+/).length;
  const minutes = Math.ceil(words / WORDS_PER_MINUTE);
  return `${minutes} min read`;
}

/**
 * Read all markdown files from posts directory
 * @returns {Array} - Array of post objects
 */
function readPosts() {
  // Check if posts directory exists
  if (!fs.existsSync(POSTS_DIR)) {
    throw new Error(`Posts directory does not exist: ${POSTS_DIR}`);
  }

  const files = fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.md') && !f.startsWith('_'));

  const posts = files
    .map(file => {
      const filePath = path.join(POSTS_DIR, file);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const { data, content } = matter(fileContent);

      // Validate required fields
      if (!data.title) {
        throw new Error(`${file}: Missing required field 'title'`);
      }
      if (!data.date) {
        throw new Error(`${file}: Missing required field 'date'`);
      }
      if (!data.excerpt) {
        throw new Error(`${file}: Missing required field 'excerpt'`);
      }

      // Skip posts with empty content
      if (!content || content.trim().length === 0) {
        return null;
      }

      // Parse and validate date format (store to avoid re-parsing)
      const postDate = new Date(data.date);
      if (isNaN(postDate.getTime())) {
        throw new Error(`${file}: Invalid date format '${data.date}'`);
      }

      const slug = file.replace('.md', '');

      // Ensure tags is an array
      let tags = [];
      if (Array.isArray(data.tags)) {
        tags = data.tags;
      } else if (typeof data.tags === 'string' && data.tags.trim()) {
        tags = [data.tags];
      }

      return {
        slug,
        title: data.title,
        date: data.date,
        postDate,
        tags,
        excerpt: data.excerpt,
        content,
        html: sanitizeHtml(marked.parse(content)),
        readingTime: calculateReadingTime(content)
      };
    })
    .filter(post => post !== null);

  // Sort by date (newest first) using cached date objects
  return posts.sort((a, b) => b.postDate - a.postDate);
}

/**
 * Get all unique tags from posts
 * @param {Array} posts - Array of post objects
 * @returns {Array} - Sorted array of unique tags
 */
function getAllTags(posts) {
  const tags = new Set();
  posts.forEach(post => {
    post.tags.forEach(tag => tags.add(tag));
  });
  return Array.from(tags).sort();
}

/**
 * Format date for display
 * @param {string} dateString - ISO date string
 * @returns {string} - Formatted date
 */
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Format date for RSS
 * @param {string} dateString - ISO date string
 * @returns {string} - RFC 822 date format
 */
function formatRSSDate(dateString) {
  const date = new Date(dateString);
  return date.toUTCString();
}

/**
 * Generate the common header HTML
 * @param {string} title - Page title
 * @param {string} currentPath - Current path for nav highlighting
 * @returns {string} - Header HTML
 */
function generateHeader(title, currentPath = '') {
  return `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} - Lanes</title>
    <meta name="description" content="Manage multiple, isolated Claude Code sessions directly inside VS Code.">
    <link rel="icon" type="image/png" href="https://github.com/FilipeJesus/lanes/raw/main/media/lanes-default-64px.png">

    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">

    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        surface: {
                            0: 'var(--surface-0)',
                            1: 'var(--surface-1)',
                            2: 'var(--surface-2)',
                            3: 'var(--surface-3)',
                        },
                        accent: 'var(--accent)',
                        'accent-dim': 'var(--accent-dim)',
                        ink: {
                            DEFAULT: 'var(--ink)',
                            muted: 'var(--ink-muted)',
                            faint: 'var(--ink-faint)',
                        },
                        border: 'var(--border)',
                    },
                    fontFamily: {
                        display: ['"DM Sans"', 'system-ui', 'sans-serif'],
                        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
                        mono: ['"JetBrains Mono"', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
                    },
                }
            }
        }
    </script>
    <script>
        if (localStorage.theme === 'light') {
            document.documentElement.classList.remove('dark');
        } else {
            document.documentElement.classList.add('dark');
        }
    </script>
    <style>
        /* --- Theme tokens --- */
        :root {
            --surface-0: #f8f7f5;
            --surface-1: #efeeeb;
            --surface-2: #e6e4e0;
            --surface-3: #dddbd6;
            --accent: #0969da;
            --accent-dim: rgba(9, 105, 218, 0.12);
            --ink: #1c1917;
            --ink-muted: #57534e;
            --ink-faint: #a8a29e;
            --border: rgba(0, 0, 0, 0.08);
        }
        .dark {
            --surface-0: #121110;
            --surface-1: #1a1918;
            --surface-2: #242220;
            --surface-3: #2e2c29;
            --accent: #58a6ff;
            --accent-dim: rgba(88, 166, 255, 0.10);
            --ink: #e7e5e4;
            --ink-muted: #a8a29e;
            --ink-faint: #57534e;
            --border: rgba(255, 255, 255, 0.06);
        }

        /* --- Grain overlay --- */
        body::before {
            content: '';
            position: fixed;
            inset: 0;
            z-index: 9999;
            pointer-events: none;
            opacity: 0.025;
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
            background-repeat: repeat;
            background-size: 256px 256px;
        }

        /* --- Mobile nav --- */
        .mobile-nav {
            transform: translateX(100%);
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .mobile-nav.open {
            transform: translateX(0);
        }
        .mobile-backdrop {
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s ease;
        }
        .mobile-backdrop.open {
            opacity: 1;
            pointer-events: auto;
        }

        /* --- Prose styles --- */
        .prose h1 { font-size: 2em; font-weight: bold; margin: 0.67em 0; color: var(--ink); }
        .prose h2 { font-size: 1.5em; font-weight: bold; margin: 0.83em 0; color: var(--ink); }
        .prose h3 { font-size: 1.17em; font-weight: bold; margin: 1em 0; color: var(--ink); }
        .prose p { margin: 1em 0; line-height: 1.7; color: var(--ink-muted); }
        .prose ul, .prose ol { margin: 1em 0; padding-left: 1.5em; }
        .prose ul { list-style-type: disc; }
        .prose ul ul { list-style-type: circle; }
        .prose ul ul ul { list-style-type: square; }
        .prose ol { list-style-type: decimal; }
        .prose li { margin: 0.5em 0; color: var(--ink-muted); }
        .prose a { color: var(--accent); text-decoration: underline; }
        .prose a:hover { opacity: 0.8; }
        .prose code { background: var(--surface-2); color: var(--ink-muted); padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; font-family: 'JetBrains Mono', Menlo, Monaco, Consolas, monospace; }
        .prose pre { background: var(--surface-2); color: var(--ink-muted); padding: 1em; border-radius: 6px; overflow-x: auto; margin: 1em 0; border: 1px solid var(--border); }
        .prose pre code { background: transparent; padding: 0; color: inherit; }
        .prose img { max-width: 100%; border-radius: 8px; margin: 1em 0; border: 1px solid var(--border); }
        .prose blockquote { border-left: 4px solid var(--accent); padding-left: 1em; margin: 1em 0; color: var(--ink-muted); }
        .prose table { border-collapse: separate; border-spacing: 0; width: 100%; margin: 1em 0; font-size: 0.95em; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
        .prose table thead { background: var(--surface-2); border-bottom: 2px solid var(--border); }
        .prose table th { padding: 0.75em 1em; text-align: left; font-weight: 600; color: var(--ink); border-right: 1px solid var(--border); }
        .prose table th:last-child { border-right: none; }
        .prose table td { padding: 0.75em 1em; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .prose table td:last-child { border-right: none; }
        .prose table tbody tr:last-child td { border-bottom: none; }
        .prose table tbody tr:nth-child(even) { background: var(--surface-1); }
        .prose table tbody tr:hover { background: var(--surface-2); }
    </style>
</head>
<body class="bg-surface-0 text-ink font-body antialiased selection:bg-accent selection:text-white">

    <!-- Mobile nav backdrop -->
    <div id="mobile-backdrop" class="mobile-backdrop fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"></div>

    <!-- Mobile nav drawer -->
    <div id="mobile-nav" class="mobile-nav fixed top-0 right-0 bottom-0 w-72 z-50 bg-surface-1 border-l border-border p-6 flex flex-col md:hidden">
        <div class="flex items-center justify-between mb-8">
            <span class="text-lg font-semibold text-ink">Menu</span>
            <button id="mobile-nav-close" class="p-2 -mr-2 rounded-lg hover:bg-surface-2 transition-colors" aria-label="Close menu">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
        </div>
        <nav class="flex flex-col gap-1">
            <a href="../index.html" class="px-3 py-2.5 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors">Home</a>
            <a href="../index.html#features" class="px-3 py-2.5 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors">Features</a>
            <a href="../index.html#how-it-works" class="px-3 py-2.5 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors">How it Works</a>
            <a href="index.html" class="px-3 py-2.5 rounded-lg text-accent font-medium">Blog</a>
            <a href="../docs.html" class="px-3 py-2.5 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors">Docs</a>
        </nav>
        <div class="mt-auto pt-6 border-t border-border flex flex-col gap-3">
            <a href="https://marketplace.visualstudio.com/items?itemName=FilipeMarquesJesus.lanes" class="flex items-center justify-center gap-2 bg-ink text-surface-0 dark:bg-white dark:text-surface-0 px-4 py-2.5 rounded-lg font-semibold text-sm">
                Install from Marketplace
            </a>
            <a href="https://github.com/FilipeJesus/lanes" class="flex items-center justify-center gap-2 border border-border px-4 py-2.5 rounded-lg font-medium text-sm text-ink-muted hover:text-ink transition-colors">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd"/></svg>
                View on GitHub
            </a>
        </div>
    </div>

    <!-- Navigation -->
    <nav class="fixed w-full z-30 bg-surface-0/80 backdrop-blur-md border-b border-border">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex items-center justify-between h-14">
                <div class="flex items-center gap-2.5">
                    <img src="https://github.com/FilipeJesus/lanes/raw/main/media/lanes-default-64px.png" alt="Lanes Logo" class="w-7 h-7">
                    <span class="text-lg font-bold text-ink tracking-tight font-display">Lanes</span>
                    <span class="hidden sm:inline text-[10px] uppercase tracking-widest font-mono font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Free</span>
                </div>
                <div class="hidden md:flex items-center gap-1">
                    <a href="../index.html" class="px-3 py-1.5 rounded-md text-sm text-ink-muted hover:text-ink transition-colors">Home</a>
                    <a href="../index.html#features" class="px-3 py-1.5 rounded-md text-sm text-ink-muted hover:text-ink transition-colors">Features</a>
                    <a href="../index.html#how-it-works" class="px-3 py-1.5 rounded-md text-sm text-ink-muted hover:text-ink transition-colors">How it Works</a>
                    <a href="index.html" class="px-3 py-1.5 rounded-md text-sm font-medium text-accent">Blog</a>
                    <a href="../docs.html" class="px-3 py-1.5 rounded-md text-sm text-ink-muted hover:text-ink transition-colors">Docs</a>
                    <span class="w-px h-5 bg-border mx-2"></span>
                    <a href="https://github.com/FilipeJesus/lanes" class="px-3 py-1.5 rounded-md text-sm text-ink-muted hover:text-ink transition-colors flex items-center gap-1.5">
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd"/></svg>
                        GitHub
                    </a>
                    <button id="theme-toggle" class="ml-1 p-2 rounded-lg hover:bg-surface-2 transition-colors" aria-label="Toggle theme">
                        <svg id="sun-icon" class="w-4 h-4 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
                        <svg id="moon-icon" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
                    </button>
                </div>
                <!-- Mobile: theme toggle + hamburger -->
                <div class="flex items-center gap-1 md:hidden">
                    <button id="theme-toggle-mobile" class="p-2 rounded-lg hover:bg-surface-2 transition-colors" aria-label="Toggle theme">
                        <svg id="sun-icon-m" class="w-4 h-4 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
                        <svg id="moon-icon-m" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
                    </button>
                    <button id="mobile-nav-open" class="p-2 rounded-lg hover:bg-surface-2 transition-colors" aria-label="Open menu">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
                    </button>
                </div>
            </div>
        </div>
    </nav>
    <main class="pt-24 pb-16">
`;
}

/**
 * Generate the common footer HTML
 * @returns {string} - Footer HTML
 */
function generateFooter() {
  return `    </main>

    <!-- Footer -->
    <footer class="border-t border-border py-10 bg-surface-0">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
                <p class="text-xs text-ink-faint text-center sm:text-left">
                    <span class="text-emerald-600 dark:text-emerald-400">Free &amp; Open Source</span> under MIT License.
                    Built by <a href="https://github.com/FilipeJesus" class="text-accent hover:underline">FilipeJesus</a>.
                </p>
                <div class="flex items-center gap-5 flex-wrap justify-center">
                    <a href="../index.html" class="text-xs text-ink-faint hover:text-ink transition-colors">Home</a>
                    <a href="index.html" class="text-xs text-ink-faint hover:text-ink transition-colors">Blog</a>
                    <a href="../docs.html" class="text-xs text-ink-faint hover:text-ink transition-colors">Docs</a>
                    <a href="https://github.com/FilipeJesus/lanes" class="text-xs text-ink-faint hover:text-ink transition-colors">GitHub</a>
                    <a href="https://github.com/FilipeJesus/lanes/issues" class="text-xs text-ink-faint hover:text-ink transition-colors">Issues</a>
                    <a href="https://marketplace.visualstudio.com/items?itemName=FilipeMarquesJesus.lanes" class="text-xs text-ink-faint hover:text-ink transition-colors">Marketplace</a>
                    <a href="https://open-vsx.org/extension/FilipeMarquesJesus/lanes" class="text-xs text-ink-faint hover:text-ink transition-colors">Open VSX</a>
                    <a href="https://www.paypal.com/donate/?business=JEYBHRR3E4PEU&no_recurring=0&item_name=Loving+Lanes?+I+am+too%21+Thank+you+so+much+for+supporting+it%27s+development.&currency_code=GBP" class="text-xs text-ink-faint hover:text-ink transition-colors">Donate</a>
                </div>
            </div>
        </div>
    </footer>

    <script>
        // --- Theme toggle ---
        function syncThemeIcons() {
            const isDark = document.documentElement.classList.contains('dark');
            ['', '-m'].forEach(suffix => {
                const sun = document.getElementById('sun-icon' + suffix);
                const moon = document.getElementById('moon-icon' + suffix);
                if (!sun || !moon) return;
                sun.classList.toggle('hidden', isDark);
                moon.classList.toggle('hidden', !isDark);
            });
        }
        syncThemeIcons();

        function toggleTheme() {
            const isDark = document.documentElement.classList.contains('dark');
            if (isDark) {
                document.documentElement.classList.remove('dark');
                localStorage.theme = 'light';
            } else {
                document.documentElement.classList.add('dark');
                localStorage.theme = 'dark';
            }
            syncThemeIcons();
        }

        document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
        document.getElementById('theme-toggle-mobile').addEventListener('click', toggleTheme);

        // --- Mobile nav ---
        const mobileNav = document.getElementById('mobile-nav');
        const mobileBackdrop = document.getElementById('mobile-backdrop');

        function openMobileNav() {
            mobileNav.classList.add('open');
            mobileBackdrop.classList.add('open');
            document.body.style.overflow = 'hidden';
        }
        function closeMobileNav() {
            mobileNav.classList.remove('open');
            mobileBackdrop.classList.remove('open');
            document.body.style.overflow = '';
        }

        document.getElementById('mobile-nav-open').addEventListener('click', openMobileNav);
        document.getElementById('mobile-nav-close').addEventListener('click', closeMobileNav);
        mobileBackdrop.addEventListener('click', closeMobileNav);

        mobileNav.querySelectorAll('a').forEach(a => {
            a.addEventListener('click', () => {
                if (a.getAttribute('href').startsWith('#')) {
                    closeMobileNav();
                }
            });
        });
    </script>
</body>
</html>`;
}

/**
 * Generate blog index HTML page
 * @param {Array} posts - Array of post objects
 * @returns {string} - Complete HTML for blog index
 */
function generateBlogIndex(posts) {
  const tags = getAllTags(posts);

  const tagButtons = tags.map(tag =>
    `        <button class="tag-btn px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-surface-2 text-ink-muted hover:bg-surface-3" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
  ).join('\n');

  const postCards = posts.map(post => `
        <article class="bg-surface-0 rounded-xl border border-border p-6 hover:border-accent/40 transition-colors">
          <div class="flex flex-wrap gap-2 mb-3">
            ${post.tags.map(tag => `<span class="tag-text text-xs bg-accent/15 text-accent px-2 py-1 rounded-full">${escapeHtml(tag)}</span>`).join('')}
          </div>
          <h2 class="text-2xl font-bold text-ink mb-3 font-display">
            <a href="${escapeHtml(post.slug)}.html" class="hover:text-accent transition-colors">${escapeHtml(post.title)}</a>
          </h2>
          <p class="text-ink-muted mb-4 line-clamp-2">${escapeHtml(post.excerpt)}</p>
          <div class="flex items-center gap-4 text-sm text-ink-faint">
            <span>${formatDate(post.date)}</span>
            <span>&middot;</span>
            <span>${escapeHtml(post.readingTime)}</span>
          </div>
          <a href="${escapeHtml(post.slug)}.html" class="inline-flex items-center gap-2 text-accent hover:underline font-medium mt-4">
            Read more
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
          </a>
        </article>`
  ).join('\n');

  return `${generateHeader('Blog', 'blog')}
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="text-center mb-12">
        <h1 class="text-4xl sm:text-5xl font-extrabold text-ink tracking-tight font-display mb-4">
          Lanes Blog
        </h1>
        <p class="text-lg text-ink-muted">
          Projects, tutorials, and updates from the Lanes community
        </p>
      </div>

      <div class="flex gap-2 mb-8 flex-wrap justify-center">
        <button class="tag-btn active px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-accent text-white" data-tag="all">All Posts</button>
${tagButtons}
      </div>

      <div class="grid gap-6" id="posts-container">
${postCards}
      </div>

      <script>
        // Tag filtering
        const tagBtns = document.querySelectorAll('.tag-btn');
        const postsContainer = document.getElementById('posts-container');
        const allPosts = postsContainer.querySelectorAll('article');

        // Store original order
        const postsData = Array.from(allPosts).map(article => ({
          element: article,
          tags: Array.from(article.querySelectorAll('.tag-text')).map(el => el.textContent.toLowerCase())
        }));

        tagBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            const selectedTag = btn.dataset.tag;

            // Update active button
            tagBtns.forEach(b => {
              b.classList.remove('bg-accent', 'text-white');
              b.classList.add('bg-surface-2', 'text-ink-muted');
            });
            btn.classList.remove('bg-surface-2', 'text-ink-muted');
            btn.classList.add('bg-accent', 'text-white');

            // Filter posts
            postsContainer.innerHTML = '';
            const filteredPosts = selectedTag === 'all'
              ? postsData
              : postsData.filter(p => p.tags.includes(selectedTag.toLowerCase()));

            filteredPosts.forEach(p => postsContainer.appendChild(p.element));
          });
        });
      </script>
    </div>
${generateFooter()}`;
}

/**
 * Wrap code blocks with terminal-style header
 * @param {string} html - HTML content
 * @returns {string} - HTML with code blocks wrapped
 */
function wrapCodeBlocks(html) {
  // Find all <pre><code class="language-xxx"> patterns and wrap them
  return html.replace(
    /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g,
    (match, lang, code) => {
      // Strip curly braces from language name if present (e.g., {bash} -> bash)
      const cleanLang = lang.replace(/[{}]/g, '');
      return `<div class="relative my-4 rounded-xl border border-border bg-surface-1 overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface-2">
          <div class="flex gap-2">
            <div class="w-3 h-3 rounded-full bg-red-500"></div>
            <div class="w-3 h-3 rounded-full bg-yellow-500"></div>
            <div class="w-3 h-3 rounded-full bg-green-500"></div>
          </div>
          <div class="ml-4 text-xs text-ink-faint font-mono">${escapeHtml(cleanLang)}</div>
        </div>
        <pre style="margin: 0; border-top-left-radius: 0; border-top-right-radius: 0;"><code class="language-${escapeHtml(lang)}">${code}</code></pre>
      </div>`;
    }
  );
}

/**
 * Generate individual blog post HTML page
 * @param {Object} post - Post object
 * @param {Array} allPosts - All posts for related posts section
 * @returns {string} - Complete HTML for post page
 */
function generatePostPage(post, allPosts) {
  // Find related posts (posts with at least one matching tag, excluding current)
  const relatedPosts = allPosts
    .filter(p => p.slug !== post.slug && p.tags.some(t => post.tags.includes(t)))
    .slice(0, 3);

  const relatedPostsHtml = relatedPosts.length > 0 ? `
      <div class="border-t border-border pt-8 mt-8">
        <h3 class="text-lg font-bold text-ink mb-4 font-display">Related Posts</h3>
        <div class="grid gap-4">
          ${relatedPosts.map(p => `
            <a href="${escapeHtml(p.slug)}.html" class="block p-4 rounded-lg bg-surface-1 hover:bg-surface-2 transition-colors border border-border">
              <h4 class="font-medium text-ink">${escapeHtml(p.title)}</h4>
              <p class="text-sm text-ink-muted mt-1">${escapeHtml(p.excerpt)}</p>
            </a>
          `).join('')}
        </div>
      </div>` : '';

  return `${generateHeader(post.title, 'blog')}
    <article class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
      <nav class="mb-8 text-sm">
        <a href="index.html" class="text-accent hover:underline">&larr; Back to Blog</a>
      </nav>

      <header class="mb-8">
        <div class="flex flex-wrap gap-2 mb-4">
          ${post.tags.map(tag => `<span class="text-xs bg-accent/15 text-accent px-2 py-1 rounded-full">${escapeHtml(tag)}</span>`).join('')}
        </div>
        <h1 class="text-4xl sm:text-5xl font-extrabold text-ink tracking-tight font-display mb-4">
          ${escapeHtml(post.title)}
        </h1>
        <div class="flex items-center gap-4 text-sm text-ink-faint">
          <span>${formatDate(post.date)}</span>
          <span>&middot;</span>
          <span>${escapeHtml(post.readingTime)}</span>
        </div>
      </header>

      <div class="prose max-w-none">
        ${wrapCodeBlocks(post.html)}
      </div>

${relatedPostsHtml}
    </article>
${generateFooter()}`;
}

/**
 * Generate RSS feed XML
 * @param {Array} posts - Array of post objects
 * @returns {string} - RSS feed XML
 */
function generateRSSFeed(posts) {
  const postItems = posts.map(post => {
    // Escape special XML characters
    const escapeXml = (str) => {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>https://filipejesus.github.io/lanes/blog/${escapeXml(post.slug)}.html</link>
      <description>${escapeXml(post.excerpt)}</description>
      <pubDate>${formatRSSDate(post.date)}</pubDate>
      ${post.tags.map(tag => `      <category>${escapeXml(tag)}</category>`).join('\n')}
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Lanes Blog</title>
    <link>https://filipejesus.github.io/lanes/blog/</link>
    <description>Blog posts about Lanes - Parallel AI Coding in VS Code</description>
    <language>en-us</language>
${postItems}
  </channel>
</rss>
`;
}

// Export functions for testing
module.exports = {
  calculateReadingTime,
  readPosts,
  getAllTags,
  formatDate,
  formatRSSDate,
  escapeHtml,
  sanitizeHtml,
  generateHeader,
  generateFooter,
  generateBlogIndex,
  generatePostPage,
  generateRSSFeed
};

// Run build if called directly
if (require.main === module) {
  try {
    console.log('Building blog...');

    // Ensure blog directory exists
    if (!fs.existsSync(BLOG_DIR)) {
      fs.mkdirSync(BLOG_DIR, { recursive: true });
      console.log('✓ Created blog directory');
    }

    // Read all posts
    const posts = readPosts();
    console.log(`✓ Found ${posts.length} posts`);

    if (posts.length === 0) {
      console.warn('⚠ Warning: No posts found. Blog will be empty.');
    }

    // Generate blog index
    const indexHtml = generateBlogIndex(posts);
    fs.writeFileSync(path.join(BLOG_DIR, 'index.html'), indexHtml);
    console.log('✓ Generated blog/index.html');

    // Generate individual post pages
    posts.forEach(post => {
      const postHtml = generatePostPage(post, posts);
      fs.writeFileSync(path.join(BLOG_DIR, `${post.slug}.html`), postHtml);
      console.log(`✓ Generated blog/${post.slug}.html`);
    });

    // Generate RSS feed
    const rssXml = generateRSSFeed(posts);
    fs.writeFileSync(path.join(BLOG_DIR, 'feed.xml'), rssXml);
    console.log('✓ Generated blog/feed.xml');

    console.log('\nBlog build complete!');
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}
