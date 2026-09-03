import { convert } from 'html-to-text';
import "mle-js-fetch";

const POSTS_URL =
  "https://public-api.wordpress.com/wp/v2/sites/martincarstenbach.com/posts" +
  "?per_page=100" +
  "&orderby=id&order=asc" +
  "&_fields=id,slug,link,date_gmt,modified_gmt,content,title";

const dbmsAppInfo = plsffi.resolvePackage('DBMS_APPLICATION_INFO');
const logger = plsffi.resolvePackage('LOGGER.LOGGER');
const LOG_SCOPE_PREFIX = "semantic_search.fetch_posts";

function logDebug(message, scope, extra = null) {
  logger.log({
    p_text: message,
    p_scope: `${LOG_SCOPE_PREFIX}.${scope}`,
    p_extra: extra,
  });
}

function logInfo(message, scope, extra = null) {
  logger.log_info({
    p_text: message,
    p_scope: `${LOG_SCOPE_PREFIX}.${scope}`,
    p_extra: extra,
  });
}

function logWarning(message, scope, extra = null) {
  logger.log_warn({
    p_text: message,
    p_scope: `${LOG_SCOPE_PREFIX}.${scope}`,
    p_extra: extra,
  });
}

function logError(error, scope) {
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof Error ? error.stack : null;

  logger.log_error({
    p_text: message,
    p_scope: `${LOG_SCOPE_PREFIX}.${scope}`,
    p_extra: details,
  });
}

async function fetchPage(page) {
  const response = await fetch(`${POSTS_URL}&page=${page}`);

  if (!response.ok) {
    throw new Error(
      `WordPress request for page ${page} failed with HTTP ${response.status}`,
    );
  }

  return {
    posts: await response.json(),
    totalPages: Number(response.headers.get("X-WP-TotalPages")),
  };
}


export async function fetchAllPosts() {

  logInfo('starting to fetch all blog posts', 'fetchAllPosts', );

  const first = await fetchPage(1);
  const posts = [...first.posts];

  for (let page = 2; page <= first.totalPages; page++) {
    const result = await fetchPage(page);
    posts.push(...result.posts);
  }

  logInfo(`done fetching all blog posts, ${posts.length} in total`, 'fetchAllPosts', );

  return posts;
}

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
 */
export async function refreshBlogposts() {

  const scope = "refresh_blogposts";
  
  dbmsAppInfo.set_module('semantic-search', 'refreshBlogposts');
  logInfo("Starting blog-post refresh", scope);

  try {
    /*
    * Fetch everything before performing DML. A fetch failure should throw from
    * fetchAllPosts(), preventing a partial refresh.
    */
    const transformedPosts = transformPosts(await fetchAllPosts());
    logDebug(
        `Fetched and transformed ${transformedPosts.length} posts`,
        scope,
    );

    if (transformedPosts.length === 0) {
      logDebug(
          `no more posts returned for processing`,
          scope,
      );

      return;
    }

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

    logDebug(
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

    logDebug(
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

    logDebug(
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

    logInfo(
      `Refresh completed: ${mergedPosts.rowsAffected ?? 0} posts changed, ` +
        `${invalidatedChunks.rowsAffected ?? 0} chunks invalidated, ` +
        `${generatedChunks.rowsAffected ?? 0} chunks generated`,
      scope,
    );

    dbmsAppInfo.set_module(null, null);
  } catch (error) {
    logError(error, scope);
    throw error; // Never mask the original failure.
  } finally {
    dbmsAppInfo.set_module(null, null);
  }
}
