import { convert } from 'html-to-text';
import "mle-js-fetch";

const logger = plsffi.resolvePackage('LOGGER.LOGGER');
const LOG_SCOPE_PREFIX = 'semantic_search.fetch_posts';

/**
 * Logs a message through the Logger framework.
 *
 * @param {string} code_unit - The name of the code unit or function generating the log.
 * @param {string} log_level - The severity level of the log (e.g., 'INFO', 'ERROR').
 * @param {number|string|null} post_id - The ID of the related post, or null if not applicable.
 * @param {string} log_message - The log message to record.
 * @param {any} [debug_info=null] - Optional debug information to include in the log.
 */
function logMessage( code_unit, log_level, post_id, log_message, debug_info = null) {
  const details = [];
  if (post_id != null) details.push(`post_id: ${post_id}`);
  if (debug_info != null) {
    details.push(typeof debug_info === 'string' ? debug_info : JSON.stringify(debug_info));
  }

  const args = {
    p_text: log_message || '',
    p_scope: `${LOG_SCOPE_PREFIX}.${code_unit}`,
    p_extra: details.length ? details.join('\n') : null,
  };

  switch ((log_level || 'INFO').toUpperCase()) {
    case 'DEBUG': return logger.log(args);
    case 'INFO': return logger.log_info(args);
    case 'WARN':
    case 'WARNING': return logger.log_warn(args);
    case 'ERROR': return logger.log_error(args);
    default: throw new Error(`Unsupported log level: ${log_level}`);
  }
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
 * - Logs progress and results through Logger.
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

  // cleanup
  session.execute('truncate table blogpost_chunks');
  session.execute('truncate table blogposts');

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

  const generatedChunks = session.execute(
    `
      insert /*+ parallel */ into blogpost_chunks (
        post_id,
        chunk_id,
        chunk_data,
        chunk_embedding
      )
      with posts_to_process as (
        select
          posts.id,
          posts.content
        from blogposts posts
        where posts.content is not null
          and not exists (
            select 1
            from blogpost_chunks chunks
            where chunks.post_id = posts.id
          )
      )
      select /*+ parallel */
        posts.id,
        embeddings.embed_id,
        embeddings.embed_data,
        to_vector(embeddings.embed_vector)
      from posts_to_process posts,
        dbms_vector_chain.utl_to_embeddings(
          dbms_vector_chain.utl_to_chunks(
            dbms_vector_chain.utl_to_text(posts.content),
            json(
              '{
                "limit": 4000,
                "by": "words",
                "max": "200",
                "overlap": "20",
                "split": "recursively",
                "language": "american",
                "normalize": "all"
              }'
            )
          ),
          json(
            '{
              "provider": "database",
              "model": "doc_model"
            }'
          )
        ) embedding_result,
        json_table(
          embedding_result.column_value,
          '$[*]'
          columns (
            embed_id     number         path '$.embed_id',
            embed_data   varchar2(4000) path '$.embed_data',
            embed_vector clob           path '$.embed_vector'
          )
        ) embeddings
    `,
  );

  logMessage(
    'refreshBlogposts',
    'INFO',
    null,
    `Inserted or updated ${generatedChunks.rowsAffected} chunks for ${result.rowsAffected} posts in the database`
  );
}
