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

// Export functions for testing
module.exports = {
  calculateReadingTime,
  readPosts,
  getAllTags,
  formatDate,
  formatRSSDate
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
