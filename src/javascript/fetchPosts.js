import { convert } from 'html-to-text';
import "mle-js-fetch";


/**
 * Logs a message to the log_table in the database.
 *
 * @param {string} code_unit - The name of the code unit or function generating the log.
 * @param {string} log_level - The severity level of the log (e.g., 'INFO', 'ERROR').
 * @param {number|string|null} post_id - The ID of the related post, or null if not applicable.
 * @param {string} log_message - The log message to record.
 * @param {any} [debug_info=null] - Optional debug information to include in the log.
 */
function logMessage( code_unit, log_level, post_id, log_message, debug_info = null) {
  
  session.execute(
    `insert into log_table (
      code_unit,
      log_level,
      post_id,
      log_message,
      debug_info
    ) values (
      :code_unit,
      :log_level,
      :post_id,
      :log_message,
      :debug_info
    )`,
    {
      code_unit: code_unit,
      log_level: log_level || 'INFO',
      post_id: post_id || null,
      log_message: log_message || '',
      debug_info: debug_info || null
    }
  );
}

/**
 * Fetches all posts from the WordPress.com API for martincarstenbach.com.
 *
 * @returns {Promise<Array<Object>>} Resolves to an array of WordPress post objects as returned by the API.
 */
export async function fetchAllPosts() {

  const WORDPRESS_API_URL = "https://public-api.wordpress.com/wp/v2/sites/martincarstenbach.com/posts?per_page=10";

  let posts = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {

    logMessage('fetchAllPosts', 'INFO', null, `Fetching all posts, currently working on page ${page}`);

    const response = await fetch(`${WORDPRESS_API_URL}&page=${page}`);
    if (!response.ok) {

      logMessage('fetchAllPosts', 'ERROR', null, `Failed to fetch next batch of posts from page ${page}: ${response.status}`);
      break;
    }
  
    // fetch an array containing details of 10 posts. Don't discard any details here, this will
    // later be done in transformPosts()
    const data = await response.json();
    
    if (data.length === 0) {

      logMessage('fetchAllPosts', 'INFO', null, `No more posts found on page ${page}`);
      hasMore = false;
    } else {

      posts = posts.concat(data);
      page++;
    }
  }

  logMessage('fetchAllPosts', 'INFO', null, `Fetched ${posts.length} posts in total`);

  return posts;
}


/**
 * Fetches a single post by ID from the WordPress.com API for martincarstenbach.com.
 *
 * @param {number|string} id - The ID of the WordPress post to fetch.
 * @returns {Promise<Array<Object>>} Resolves to an array containing a single WordPress post object.
 */
export async function fetchSinglePost(id) {

  const WORDPRESS_API_URL = `https://public-api.wordpress.com/wp/v2/sites/martincarstenbach.com/posts/${id}`;

  logMessage('fetchPost', 'INFO', id, `trying to fetch post ${id}`);

  const response = await fetch(`${WORDPRESS_API_URL}`);
  if (!response.ok) {

    logMessage('fetchPost', 'ERROR', id, `Error fetching post ${id}, status code is: ${response.status}`);
    return;
  }
  
  // fetch an object containing details of a single post. Don't discard any details here, this will
  // later be done in transformPosts()
  const data = await response.json();

  // return an array with a single post so we can use the same transformation function
  // based on array.map() as in the other fetch function
  return [ data ]
}

/**
 * Transforms an array of WordPress post objects to a simplified format with plain text content and title.
 *
 * @param {Array<Object>} posts - Array of WordPress post objects as returned by the API.
 * @returns {Array<Object>} Array of transformed post objects with id, slug, link, created, content, and title fields.
 */
export function transformPosts(posts) {
    return posts.map(post => ({
        id: post.id,
        slug: post.slug,
        link: post.link,
        created: new Date(post.date),
        content: convert(post.content.rendered),
        title: convert(post.title.rendered)
    }));
}

/**
 * Fetches all WordPress posts, transforms them to plain text, and merges them into the Oracle blogposts table.
 *
 * - Fetches all posts from the WordPress.com API.
 * - Transforms each post to a simplified format with plain text fields.
 * - Merges the posts into the main blogposts table using a JSON-based inline view.
 * - Logs progress and results to the log_table.
 *
 * @returns {Promise<void>} Resolves when the refresh and merge are complete.
 */
export async function refreshBlogposts() {

  logMessage('refreshBlogposts', 'INFO', null, 'Starting to refresh blog posts');

  // this should perhaps be improved so that only those posts that aren't yet
  // stored in the table are fetched from wordpress
  const allPosts = await fetchAllPosts();
  const transformedPosts = transformPosts(allPosts);

  logMessage('refreshBlogposts', 'INFO', null, `Transformed ${transformedPosts.length} posts for database insertion`);

  // merge the posts into the main table
  const result = session.execute(
    `merge into blogposts target
      using (
          select
              jt.*
          from
              json_table(
                  :posts,
                  '$[*]'
                  columns
                      id,
                      slug,
                      link,
                      created date,
                      content clob,
                      title
              ) jt
      ) source
      on (target.id = source.id)
      when not matched then
          insert (
              id,
              slug,
              link,
              created,
              content,
              title
          ) values (
              source.id,
              source.slug,
              source.link,
              source.created,
              source.content,
              source.title
          )`,
    {
      posts: {
        val: transformedPosts,
        type: oracledb.DB_TYPE_JSON
      }
    }
  );

  logMessage('refreshBlogposts', 'INFO', null, `Inserted or updated ${result.rowsAffected} posts in the database`);
}