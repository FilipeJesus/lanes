const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

// Configuration
const POSTS_DIR = path.join(__dirname, '../blog/posts');
const BLOG_DIR = path.join(__dirname, '../blog');
const WORDS_PER_MINUTE = 200;

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
        html: marked.parse(content),
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
    <title>${title} - Lanes</title>
    <meta name="description" content="Manage multiple, isolated Claude Code sessions directly inside VS Code.">
    <link rel="icon" type="image/png" href="https://github.com/FilipeJesus/lanes/raw/main/media/lanes-default-64px.png">
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        vscode: {
                            bg: '#1e1e1e',
                            sidebar: '#252526',
                            accent: '#007acc',
                            text: '#cccccc'
                        }
                    }
                }
            }
        }
    </script>
    <script>
        // Theme toggle - check localStorage, default to dark mode
        if (localStorage.theme === 'light') {
            document.documentElement.classList.remove('dark');
        } else {
            document.documentElement.classList.add('dark');
        }
    </script>
    <style>
        .prose h1 { font-size: 2em; font-weight: bold; margin: 0.67em 0; }
        .prose h2 { font-size: 1.5em; font-weight: bold; margin: 0.83em 0; }
        .prose h3 { font-size: 1.17em; font-weight: bold; margin: 1em 0; }
        .prose p { margin: 1em 0; line-height: 1.7; }
        .prose ul, .prose ol { margin: 1em 0; padding-left: 2em; }
        .prose li { margin: 0.5em 0; }
        .prose a { color: #007acc; text-decoration: underline; }
        .prose a:hover { color: #005a9e; }
        .prose code { background: rgba(0,0,0,0.1); padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
        .prose pre { background: #1e1e1e; color: #d4d4d4; padding: 1em; border-radius: 6px; overflow-x: auto; margin: 1em 0; }
        .prose pre code { background: transparent; padding: 0; }
        .prose img { max-width: 100%; border-radius: 8px; margin: 1em 0; }
        .prose blockquote { border-left: 4px solid #007acc; padding-left: 1em; margin: 1em 0; color: #666; }
    </style>
</head>
<body class="bg-gray-50 dark:bg-vscode-bg text-gray-700 dark:text-gray-300 font-sans antialiased">
    <!-- Navigation -->
    <nav class="fixed w-full z-50 bg-white/90 dark:bg-vscode-bg/90 backdrop-blur-sm border-b border-gray-200 dark:border-white/10">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex items-center justify-between h-16">
                <div class="flex items-center gap-2">
                    <img src="https://github.com/FilipeJesus/lanes/raw/main/media/lanes-default-64px.png" alt="Lanes Logo" class="w-8 h-8">
                    <span class="text-xl font-bold text-gray-900 dark:text-white tracking-tight">Lanes</span>
                </div>
                <div class="hidden md:flex items-center">
                    <div class="ml-10 flex items-baseline space-x-8">
                        <a href="../index.html" class="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">Home</a>
                        <a href="index.html" class="${currentPath === 'blog' ? 'text-vscode-accent font-medium' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'} transition-colors">Blog</a>
                        <a href="../docs.html" class="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">Docs</a>
                    </div>
                    <button id="theme-toggle" class="ml-6 p-2 rounded-lg bg-gray-200 dark:bg-white/10 hover:bg-gray-300 dark:hover:bg-white/20 transition-colors" aria-label="Toggle theme">
                        <svg id="sun-icon" class="w-5 h-5 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                        <svg id="moon-icon" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
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
    <footer class="border-t border-gray-200 dark:border-white/10 py-12 bg-gray-100 dark:bg-vscode-sidebar">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p class="text-gray-500 mb-4">
                <span class="text-green-600 dark:text-green-400">Free &amp; Open Source</span> under MIT License. Built by <a href="https://github.com/FilipeJesus" class="text-blue-600 dark:text-blue-400 hover:underline">FilipeJesus</a>.
            </p>
            <div class="flex justify-center gap-6 flex-wrap">
                <a href="../index.html" class="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">Home</a>
                <a href="index.html" class="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">Blog</a>
                <a href="../docs.html" class="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">Docs</a>
                <a href="https://github.com/FilipeJesus/lanes" class="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">GitHub</a>
            </div>
        </div>
    </footer>

    <script>
        // Theme toggle functionality
        const themeToggle = document.getElementById('theme-toggle');
        const sunIcon = document.getElementById('sun-icon');
        const moonIcon = document.getElementById('moon-icon');

        function updateIcons() {
            if (document.documentElement.classList.contains('dark')) {
                sunIcon.classList.add('hidden');
                moonIcon.classList.remove('hidden');
            } else {
                sunIcon.classList.remove('hidden');
                moonIcon.classList.add('hidden');
            }
        }

        updateIcons();

        themeToggle.addEventListener('click', () => {
            if (document.documentElement.classList.contains('dark')) {
                document.documentElement.classList.remove('dark');
                localStorage.theme = 'light';
            } else {
                document.documentElement.classList.add('dark');
                localStorage.theme = 'dark';
            }
            updateIcons();
        });
    </script>
</body>
</html>`;
}

// Export functions for testing
module.exports = {
  calculateReadingTime,
  readPosts,
  getAllTags,
  formatDate,
  formatRSSDate,
  generateHeader,
  generateFooter
};

// Run build if called directly
if (require.main === module) {
  try {
    const posts = readPosts();
    console.log(`Found ${posts.length} posts`);
    posts.forEach(post => {
      console.log(`  - ${post.title} (${post.date})`);
    });
    const tags = getAllTags(posts);
    console.log(`Tags: ${tags.join(', ')}`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}
