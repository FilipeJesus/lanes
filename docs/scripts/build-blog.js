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

/**
 * Generate blog index HTML page
 * @param {Array} posts - Array of post objects
 * @returns {string} - Complete HTML for blog index
 */
function generateBlogIndex(posts) {
  const tags = getAllTags(posts);

  const tagButtons = tags.map(tag =>
    `        <button class="tag-btn px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
      tag === 'all' ? 'bg-vscode-accent text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700'
    }" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
  ).join('\n');

  const postCards = posts.map(post => `
        <article class="bg-white dark:bg-[#1e1e1e] rounded-xl border border-gray-200 dark:border-white/10 p-6 hover:border-vscode-accent/50 transition-colors">
          <div class="flex flex-wrap gap-2 mb-3">
            ${post.tags.map(tag => `<span class="text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-full">${escapeHtml(tag)}</span>`).join('')}
          </div>
          <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-3">
            <a href="${escapeHtml(post.slug)}.html" class="hover:text-vscode-accent transition-colors">${escapeHtml(post.title)}</a>
          </h2>
          <p class="text-gray-600 dark:text-gray-400 mb-4 line-clamp-2">${escapeHtml(post.excerpt)}</p>
          <div class="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-500">
            <span>${formatDate(post.date)}</span>
            <span>&middot;</span>
            <span>${escapeHtml(post.readingTime)}</span>
          </div>
          <a href="${escapeHtml(post.slug)}.html" class="inline-flex items-center gap-2 text-vscode-accent hover:underline font-medium mt-4">
            Read more
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
          </a>
        </article>`
  ).join('\n');

  return `${generateHeader('Blog', 'blog')}
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="text-center mb-12">
        <h1 class="text-4xl sm:text-5xl font-extrabold text-gray-900 dark:text-white tracking-tight mb-4">
          Lanes Blog
        </h1>
        <p class="text-lg text-gray-600 dark:text-gray-400">
          Projects, tutorials, and updates from the Lanes community
        </p>
      </div>

      <div class="flex gap-2 mb-8 flex-wrap justify-center">
        <button class="tag-btn active px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-vscode-accent text-white" data-tag="all">All Posts</button>
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
          tags: Array.from(article.querySelectorAll('.text-blue-600')).map(el => el.textContent.toLowerCase())
        }));

        tagBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            const selectedTag = btn.dataset.tag;

            // Update active button
            tagBtns.forEach(b => {
              b.classList.remove('bg-vscode-accent', 'text-white');
              b.classList.add('bg-gray-200', 'dark:bg-gray-800', 'text-gray-700', 'dark:text-gray-300');
            });
            btn.classList.remove('bg-gray-200', 'dark:bg-gray-800', 'text-gray-700', 'dark:text-gray-300');
            btn.classList.add('bg-vscode-accent', 'text-white');

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
      <div class="border-t border-gray-200 dark:border-white/10 pt-8 mt-8">
        <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-4">Related Posts</h3>
        <div class="grid gap-4">
          ${relatedPosts.map(p => `
            <a href="${escapeHtml(p.slug)}.html" class="block p-4 rounded-lg bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
              <h4 class="font-medium text-gray-900 dark:text-white">${escapeHtml(p.title)}</h4>
              <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">${escapeHtml(p.excerpt)}</p>
            </a>
          `).join('')}
        </div>
      </div>` : '';

  return `${generateHeader(post.title, 'blog')}
    <article class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
      <nav class="mb-8 text-sm">
        <a href="index.html" class="text-vscode-accent hover:underline">&larr; Back to Blog</a>
      </nav>

      <header class="mb-8">
        <div class="flex flex-wrap gap-2 mb-4">
          ${post.tags.map(tag => `<span class="text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-full">${escapeHtml(tag)}</span>`).join('')}
        </div>
        <h1 class="text-4xl sm:text-5xl font-extrabold text-gray-900 dark:text-white tracking-tight mb-4">
          ${escapeHtml(post.title)}
        </h1>
        <div class="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-500">
          <span>${formatDate(post.date)}</span>
          <span>&middot;</span>
          <span>${escapeHtml(post.readingTime)}</span>
        </div>
      </header>

      <div class="prose dark:prose-invert max-w-none">
        ${post.html}
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
