import { convert } from 'html-to-text';
import "mle-js-fetch";

// Request only the fields used by the refresh, in a stable order across pages.
const POSTS_URL =
  "https://public-api.wordpress.com/wp/v2/sites/martincarstenbach.com/posts" +
  "?per_page=100" +
  "&orderby=id&order=asc" +
  "&_fields=id,slug,link,date_gmt,modified_gmt,content,title";

const dbmsAppInfo = plsffi.resolvePackage('DBMS_APPLICATION_INFO');
const LOG_SCOPE_PREFIX = "semantic_search.fetch_posts";

/**
 * Write a message through Logger's public synonym.
 * @param {'DEBUG'|'INFO'|'WARN'|'ERROR'} level Logger level.
 * @param {unknown} message Message or error to log.
 * @param {string} scope Operation name appended to the prefix.
 * @param {string|null} [extra=null] Optional details; errors supply their stack.
 */
function logMessage(level, message, scope, extra = null) {
  const text = message instanceof Error ? message.message : String(message);
  const details = message instanceof Error ? message.stack ?? null : extra;

  // Calling through PL/SQL avoids the FFI's LOGGER.LOGGER name collision.
  session.execute(
    `begin
       case :level
         when 'DEBUG' then logger.log(p_text => :message, p_scope => :scope, p_extra => :extra);
         when 'INFO' then logger.log_info(p_text => :message, p_scope => :scope, p_extra => :extra);
         when 'WARN' then logger.log_warn(p_text => :message, p_scope => :scope, p_extra => :extra);
         when 'ERROR' then logger.log_error(p_text => :message, p_scope => :scope, p_extra => :extra);
         else raise_application_error(-20001, 'Unsupported Logger level');
       end case;
     end;`,
    {
      level,
      message: text,
      scope: `${LOG_SCOPE_PREFIX}.${scope}`,
      extra: { val: details, type: oracledb.DB_TYPE_CLOB },
    },
  );
}

/**
 * Fetch one WordPress results page and its advertised page count.
 * @param {number} page One-based page number.
 * @returns {Promise<{posts: object[], totalPages: number}>} Page data and total pages.
 * @throws {Error} If WordPress returns an unsuccessful HTTP response.
 */
async function fetchPage(page) {
  const response = await fetch(`${POSTS_URL}&page=${page}`);

  if (!response.ok) {
    throw new Error(
      `WordPress request for page ${page} failed with HTTP ${response.status}`,
    );
  }

  // WordPress supplies the page count in a response header, not the JSON body.
  return {
    posts: await response.json(),
    totalPages: Number(response.headers.get("X-WP-TotalPages")),
  };
}


/**
 * Fetch all WordPress pages sequentially and combine their posts.
 * @returns {Promise<object[]>} Posts in the order returned by the API.
 * @throws {Error} If a page request fails.
 */
export async function fetchAllPosts() {

  logMessage('INFO', 'starting to fetch all blog posts', 'fetchAllPosts');

  // The first response determines how many subsequent pages to request.
  const first = await fetchPage(1);
  const posts = [...first.posts];

  for (let page = 2; page <= first.totalPages; page++) {
    const result = await fetchPage(page);
    posts.push(...result.posts);
  }

  logMessage('INFO', `done fetching all blog posts, ${posts.length} in total`, 'fetchAllPosts');

  return posts;
}

/**
 * Convert WordPress fields into the values consumed by the database refresh.
 * @param {object[]} posts WordPress post objects with rendered title and content.
 * @returns {object[]} Posts with UTC dates and plain-text title and content.
 */
function transformPosts(posts) {

  return posts.map((post) => ({
    id: post.id,
    slug: post.slug,
    link: post.link,
    created: new Date(`${post.date_gmt}Z`),
    modified: new Date(`${post.modified_gmt}Z`),
    content: convert(post.content.rendered),
    title: convert(post.title.rendered),
  }));

}

/**
 * Refreshes WordPress posts and their vectorized chunks.
 *
 * The caller controls the transaction. This function deliberately does not
 * commit or roll back.
 *
 * @returns {Promise<void>}
 * @throws {Error} If the DOC_MODEL ONNX embedding model is not present.
 */
export async function refreshBlogposts() {

  const scope = "refresh_blogposts";
  
  dbmsAppInfo.set_module('semantic-search', 'refreshBlogposts');
  logMessage('INFO', "Starting blog-post refresh", scope);

  try {
    // Check before fetching or modifying posts so a missing model fails early.
    const model = session.execute(`
      select model_name
      from user_mining_models
      where model_name = 'DOC_MODEL'
        and algorithm = 'ONNX'
        and mining_function = 'EMBEDDING'
    `);
    if (model.rows.length === 0) {
      throw new Error('DOC_MODEL ONNX embedding model is not present in the current schema');
    }

    /*
    * Fetch everything before performing DML. A fetch failure should throw from
    * fetchAllPosts(), preventing a partial refresh.
    */
    const transformedPosts = transformPosts(await fetchAllPosts());
    logMessage('DEBUG',
        `Fetched and transformed ${transformedPosts.length} posts`,
        scope,
    );

    if (transformedPosts.length === 0) {
      logMessage('DEBUG',
          `no more posts returned for processing`,
          scope,
      );

      return;
    }

    // Bind the entire batch as JSON for both set-based SQL statements.
    const postsBind = {
      posts: {
        val: transformedPosts,
        type: oracledb.DB_TYPE_JSON,
      },
    };

    /*
    * Remove chunks belonging to posts whose searchable source data has changed.
    *
    * This must happen before the MERGE because afterwards the old and new
    * blogpost values would be identical.
    */

    logMessage('DEBUG',
        `about to invalidate chunks`,
        scope,
    );

    const invalidatedChunks = session.execute(
      `
        delete from blogpost_chunks chunks
        where exists (
          select 1
          from blogposts target
          join json_table(
            :posts,
            '$[*]'
            columns (
              id      number        path '$.id',
              slug    varchar2(255) path '$.slug',
              link    varchar2(255) path '$.link',
              created date          path '$.created',
              modified date         path '$.modified',
              content clob          path '$.content',
              title   varchar2(255) path '$.title'
            )
          ) source
            on source.id = target.id
          where chunks.post_id = target.id
            and (
              decode(target.slug, source.slug, 0, 1) = 1
              or decode(target.link, source.link, 0, 1) = 1
              or decode(target.created, source.created, 0, 1) = 1
              or decode(target.modified, source.modified, 0, 1) = 1
              or decode(target.title, source.title, 0, 1) = 1
              or (
                target.content is null
                and source.content is not null
              )
              or (
                target.content is not null
                and source.content is null
              )
              or (
                target.content is not null
                and source.content is not null
                and dbms_lob.compare(target.content, source.content) != 0
              )
            )
        )
      `,
      postsBind,
    );

    logMessage('DEBUG',
        `about to merge posts`,
        scope,
    );

    /*
    * Insert new posts and update existing posts only when their values differ.
    */
    const mergedPosts = session.execute(
      `
        merge into blogposts target
        using (
          select
            source.id,
            source.slug,
            source.link,
            source.created,
            source.modified,
            source.content,
            source.title
          from json_table(
            :posts,
            '$[*]'
            columns (
              id      number        path '$.id',
              slug    varchar2(255) path '$.slug',
              link    varchar2(255) path '$.link',
              created date          path '$.created',
              modified date         path '$.modified',
              content clob          path '$.content',
              title   varchar2(255) path '$.title'
            )
          ) source
        ) source
        on (target.id = source.id)

        when matched then
          update set
            target.slug = source.slug,
            target.link = source.link,
            target.created = source.created,
            target.modified = source.modified,
            target.content = source.content,
            target.title = source.title
          where
            decode(target.slug, source.slug, 0, 1) = 1
            or decode(target.link, source.link, 0, 1) = 1
            or decode(target.created, source.created, 0, 1) = 1
            or decode(target.modified, source.modified, 0, 1) = 1
            or decode(target.title, source.title, 0, 1) = 1
            or (
              target.content is null
              and source.content is not null
            )
            or (
              target.content is not null
              and source.content is null
            )
            or (
              target.content is not null
              and source.content is not null
              and dbms_lob.compare(target.content, source.content) != 0
            )

        when not matched then
          insert (
            id,
            slug,
            link,
            created,
            modified,
            content,
            title
          )
          values (
            source.id,
            source.slug,
            source.link,
            source.created,
            source.modified,
            source.content,
            source.title
          )
      `,
      postsBind,
    );

    logMessage('DEBUG',
        `about to start chunking data for new and updated posts`,
        scope,
    );

    /*
    * New posts have no chunks. Changed posts also have no chunks because their
    * old chunks were deleted above.
    *
    * UTL_TO_CHUNKS:
    *   - produces chunks containing at most 200 words
    *   - includes a 20-word overlap
    *   - prefers natural recursive split points
    *
    * UTL_TO_EMBEDDINGS vectorizes the complete array of chunks in one operation
    * using the ONNX model already loaded into the database.
    */
    const generatedChunks = session.execute(
      `
        insert into blogpost_chunks (
          post_id,
          chunk_id,
          chunk_data,
          chunk_embedding
        )
        with posts_to_process as (
          select /*+ materialize */
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
        select
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

    logMessage('INFO',
      `Refresh completed: ${mergedPosts.rowsAffected ?? 0} posts changed, ` +
        `${invalidatedChunks.rowsAffected ?? 0} chunks invalidated, ` +
        `${generatedChunks.rowsAffected ?? 0} chunks generated`,
      scope,
    );

    dbmsAppInfo.set_module(null, null);
  } catch (error) {
    logMessage('ERROR', error, scope);
    throw error; // Never mask the original failure.
  } finally {
    // Clear the session module on both success and errors inside the try block.
    dbmsAppInfo.set_module(null, null);
  }
}
