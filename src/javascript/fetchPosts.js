/**
 * WordPress ingestion and incremental search-index maintenance for the blog search app.
 *
 * This source is bundled into the database's BUNDLE_MODULE MLE JavaScript module.
 * Oracle supplies `session`, `oracledb`, and `plsffi` at runtime; the side-effect
 * import below supplies the fetch implementation. This file is not browser code.
 * 
 * Use the following to load the code into the database:
 * - npx esbuild src/javascript/fetchPosts.js --bundle --outfile=build/bundle.js --format=esm --external:"mle-js-fetch"
 * - echo "mle create-module -filename build/bundle.js -module-name bundle_module -replace" | sqlcl -name <connection name>
 *
 * Data ownership:
 * - BLOGPOST_SOURCE stores the most recently checked WordPress metadata and errors.
 * - BLOGPOSTS stores the version of each post that was successfully indexed.
 * - BLOGPOST_CHUNKS stores that version's text chunks and vector embeddings.
 * - BLOG_REFRESH_STATE holds check/refresh summaries and the singleton lock row.
 * - BLOGPOST_REFRESH_STATUS derives candidates from the source/index differences.
 *
 * Flow through the APEX Blog Refresh page (Page 3):
 * - The page imports this MLE module as `blog_posts` and runs the selected operation
 *   as a serialized background process. Its progress callback updates the APEX job.
 * - `Check for updates` fetches and validates the complete published-post metadata
 *   snapshot before marking source rows present or absent and merging current metadata
 *   into BLOGPOST_SOURCE. It does not change BLOGPOSTS or BLOGPOST_CHUNKS.
 * - `Refresh suggested posts` reads source-present candidates from
 *   BLOGPOST_REFRESH_STATUS, refetches each post, and replaces its BLOGPOSTS row and
 *   BLOGPOST_CHUNKS text/vector set using DOC_MODEL. A failed post is rolled back to
 *   its savepoint, its error is recorded, and the batch continues with other posts.
 * - The APEX actions are separate: refresh uses the last checked source snapshot.
 *   The page commits after a successful operation and rolls back a thrown failure;
 *   its reports show job progress and the current source/index status. The combined
 *   `refreshBlogposts` export remains available to callers that need check-then-refresh.
 *
 * The exported maintenance operations never commit. APEX or the SQLcl caller owns
 * the transaction and must commit successful work or roll it back. A successful
 * function return therefore does not, by itself, mean that the changes are durable.
 * Individual post failures are isolated with savepoints so a batch can continue.
 *
 * @module fetchPosts
 */

/**
 * Fields consumed from a WordPress REST API post. Other API fields are preserved
 * in fetch results but are not used when constructing database bind payloads.
 *
 * @typedef {Object} WordPressPost
 * @property {number} id Positive safe-integer source post ID.
 * @property {string} slug Source URL slug.
 * @property {string} link Absolute HTTPS permalink.
 * @property {string} date_gmt Publication time in UTC, formatted YYYY-MM-DDTHH:mm:ss.
 * @property {string} modified_gmt Last source edit time in the same UTC format.
 * @property {{rendered: string}} title Rendered title, possibly containing HTML/entities.
 * @property {{rendered: string}} [content] Rendered HTML body; omitted by metadata checks.
 * @property {string} [status] Publication state, when the API includes it.
 */

/**
 * Validated values used by JSON_TABLE in the database merge statements.
 * The timestamp strings represent UTC even though Oracle DATE has no time zone.
 *
 * @typedef {Object} TransformedPost
 * @property {number} id WordPress post ID.
 * @property {string} slug Source slug.
 * @property {string} link HTTPS permalink.
 * @property {string} created UTC publication timestamp without a trailing Z.
 * @property {string} modified UTC source modification timestamp without a trailing Z.
 * @property {string} title Plain-text title.
 * @property {string} [content] Plain-text body; absent when only metadata is requested.
 */

/**
 * Progress for the current phase. Units may be pages during a source check or
 * posts during indexing; the counters are not one cumulative measure for a run.
 *
 * @typedef {Object} MaintenanceProgress
 * @property {string} message Human-readable phase/progress message.
 * @property {number} sofar Number of completed units in the current phase.
 * @property {number} total Total units; may be zero when there are no candidates.
 */

/**
 * Optional integration with APEX background-process reporting or another caller.
 * The callback is synchronous: its return value is ignored, and exceptions are
 * propagated. Use it for reporting, not for committing or modifying transaction state.
 *
 * @typedef {Object} MaintenanceOptions
 * @property {function(MaintenanceProgress): void} [onProgress] Progress callback.
 */

/**
 * @typedef {MaintenanceOptions & {metadataOnly?: boolean}} FetchOptions
 */

/**
 * Counts for this refresh attempt. These are batch results, not database totals.
 * A resolved operation can contain failed posts; inspect `failed` before treating
 * the whole batch as successful. An outer rollback still discards these changes.
 *
 * @typedef {Object} RefreshSummary
 * @property {number} refreshed Number of posts successfully replaced in this transaction.
 * @property {number} failed Number of failed posts restored to their previous state.
 * @property {number} chunks Number of chunks generated for successfully refreshed posts.
 */

import { convert } from 'html-to-text';
import "mle-js-fetch";

// Resolve the schema-qualified package to avoid depending on public synonyms.
const logger = plsffi.resolvePackage('LOGGER.LOGGER');
const LOG_SCOPE_PREFIX = 'semantic_search.fetch_posts';

/**
 * Dispatch a structured message to the existing Logger PL/SQL package via MLE FFI.
 *
 * Each function gets a scope beneath semantic_search.fetch_posts. Post IDs and
 * diagnostic details go into P_EXTRA so P_TEXT remains a concise description.
 * Avoid passing complete post bodies, embeddings, credentials, or response objects
 * as diagnostics. Logger configuration determines which entries are retained.
 *
 * @param {string} code_unit Function or logical operation appended to the log scope.
 * @param {string} log_level DEBUG, INFO, WARN/WARNING, or ERROR; case-insensitive.
 * @param {number|string|null} post_id Related source post ID, or null for batch events.
 * @param {string} log_message Main log message.
 * @param {*} [debug_info=null] String or JSON-serializable diagnostic context.
 * @returns {*} Result of the selected Logger procedure.
 * @throws {Error} If the log level is unsupported, serialization fails, or Logger fails.
 */
function logMessage( code_unit, log_level, post_id, log_message, debug_info = null) {
  const details = [];
  if (post_id != null) details.push(`post_id: ${post_id}`);
  if (debug_info != null) {
    details.push(typeof debug_info === 'string' ? debug_info : JSON.stringify(debug_info));
  }

  // Named arguments match Logger's public package API; do not serialize its FFI wrapper.
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
    default: {
      // Call Logger directly here: dispatching through logMessage would recurse.
      const message = `Unsupported log level: ${log_level}`;
      logger.log_error({ ...args, p_text: message });
      throw new Error(message);
    }
  }
}

/**
 * Construct and log an application error before the caller throws it.
 *
 * The stack captures the validation failure's origin. A surrounding catch may log
 * it again with transaction/post recovery context; those entries describe different
 * stages of the failure. Logger failures propagate rather than being suppressed.
 *
 * @param {string} codeUnit Function or operation reporting the error.
 * @param {string} message Exception and log message.
 * @param {number|string|null} [postId=null] Source post ID, if known.
 * @param {Object} [context={}] JSON-serializable facts such as page or expected counts.
 * @returns {Error} Logged exception, ready for `throw`; this helper does not throw it.
 */
function loggedError(codeUnit, message, postId = null, context = {}) {
  const error = new Error(message);
  logMessage(codeUnit, 'ERROR', postId, message, { ...context, stack: error.stack });
  return error;
}

const WORDPRESS_API_URL = 'https://public-api.wordpress.com/wp/v2/sites/martincarstenbach.com/posts';
// Match utcTimestamp's exact format instead of relying on session NLS date settings.
const DATE_FORMAT = `'YYYY-MM-DD"T"HH24:MI:SS'`;

/**
 * Write a progress entry and optionally update the caller's progress display.
 *
 * @param {MaintenanceOptions} options Optional caller-supplied reporting hook.
 * @param {string} message Description of the current phase or outcome.
 * @param {number} sofar Completed phase units.
 * @param {number} total Total phase units, including zero for an empty candidate set.
 * @returns {void}
 * @throws {Error} If Logger or the synchronous progress callback fails.
 */
function reportProgress(options, message, sofar, total) {
  logMessage('maintenance', 'INFO', null, message);
  if (options.onProgress) options.onProgress({ message, sofar, total });
}

/**
 * Validate a WordPress GMT timestamp without converting it to local time.
 *
 * WordPress omits the zone suffix from these GMT fields. Append Z only while
 * validating with JavaScript, then retain the original string for explicit UTC
 * DATE storage. The round-trip check rejects normalized dates such as February 30.
 *
 * @param {string} value Expected format: YYYY-MM-DDTHH:mm:ss, with no offset or suffix.
 * @param {number} postId Post whose metadata is being validated; used in error logs.
 * @param {string} field Source field name, such as date_gmt or modified_gmt.
 * @returns {string} Unmodified, validated UTC timestamp.
 * @throws {Error} If the timestamp is absent, malformed, or not a valid calendar time.
 */
function utcTimestamp(value, postId, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}Z`)) ||
      new Date(`${value}Z`).toISOString().slice(0, 19) !== value) {
    throw loggedError('utcTimestamp', `Invalid WordPress UTC timestamp: ${value}`, postId, { field });
  }
  return value;
}

/**
 * Validate and reduce WordPress posts to the values consumed by database merges.
 *
 * Metadata checks skip body validation/conversion because the API deliberately
 * omits content. For full posts, the current storage contract converts both titles
 * and bodies to plain text using html-to-text. UTL_TO_TEXT is also still present
 * in the SQL indexing pipeline; this function does not remove that extraction step.
 * Input objects are read only and the returned objects contain no unrelated fields.
 *
 * @param {WordPressPost[]} posts Source objects to validate and transform.
 * @param {boolean} [includeContent=true] Require and convert the body as well as metadata.
 * @returns {TransformedPost[]} Database payloads with UTC source timestamps.
 * @throws {Error} If required values fail validation or HTML conversion fails.
 */
export function transformPosts(posts, includeContent = true) {
  return posts.map(post => {
    if (!Number.isSafeInteger(post.id) || post.id <= 0 ||
        typeof post.slug !== 'string' || typeof post.title?.rendered !== 'string' ||
        typeof post.link !== 'string' || !/^https:\/\//.test(post.link) ||
        (includeContent && typeof post.content?.rendered !== 'string')) {
      throw loggedError('transformPosts', 'Invalid WordPress post data', post.id, { includeContent });
    }
    return {
      id: post.id, slug: post.slug, link: post.link,
      created: utcTimestamp(post.date_gmt, post.id, 'date_gmt'),
      modified: utcTimestamp(post.modified_gmt, post.id, 'modified_gmt'),
      title: convert(post.title.rendered),
      ...(includeContent ? { content: convert(post.content.rendered) } : {}),
    };
  });
}

/**
 * Fetch and validate the entire published-post collection without database writes.
 *
 * Uses the API's advertised page count instead of treating an HTTP error as normal
 * end-of-pagination. Matching totals, nonempty pages, unique IDs, and a final row
 * count reduce the risk of accepting an incomplete snapshot. They cannot provide
 * an atomic source snapshot if posts change concurrently while requests are made.
 * An empty collection is rejected because this is an established, nonempty blog.
 *
 * @param {FetchOptions} [options={}] Reporting hook and optional metadataOnly flag.
 * @returns {Promise<WordPressPost[]>} Original API objects, not transformed payloads.
 * @throws {Error} If HTTP/JSON processing, post validation, pagination, or reporting fails.
 */
export async function fetchAllPosts(options = {}) {
  const posts = [];
  const seen = new Set();
  let expectedTotal;
  let expectedPages;
  // Keep update checks lightweight: no body download and no embedding generation.
  const fields = options.metadataOnly ? '&_fields=id,slug,link,date_gmt,modified_gmt,title' : '';

  for (let page = 1; ; page++) {
    logMessage('fetchAllPosts', 'INFO', null, 'Fetching WordPress page', { page, metadataOnly: Boolean(options.metadataOnly) });
    // Ascending source IDs give pagination a stable ordering between requests.
    const response = await fetch(`${WORDPRESS_API_URL}?per_page=100&page=${page}&orderby=id&order=asc${fields}`);
    if (!response.ok) throw loggedError('fetchAllPosts', `WordPress page ${page}: HTTP ${response.status}`, null, { page });
    // Missing headers must not be mistaken for a zero-sized, successful response.
    const totalHeader = response.headers.get('X-WP-Total');
    const pagesHeader = response.headers.get('X-WP-TotalPages');
    if (!/^\d+$/.test(totalHeader ?? '') || !/^\d+$/.test(pagesHeader ?? '')) {
      throw loggedError('fetchAllPosts', 'WordPress pagination headers are missing or invalid', null, { page, totalHeader, pagesHeader });
    }
    const total = Number(totalHeader);
    const pages = Number(pagesHeader);
    if (total === 0) throw loggedError('fetchAllPosts', 'WordPress returned an unexpectedly empty collection; previous snapshot retained', null, { page });
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(pages) || pages < 1 || pages > total) {
      throw loggedError('fetchAllPosts', 'Invalid WordPress pagination totals', null, { page, total, pages });
    }
    // Freeze the first page's expectations; changed totals require a fresh check.
    if (page === 1) { expectedTotal = total; expectedPages = pages; }
    if (total !== expectedTotal || pages !== expectedPages) {
      throw loggedError('fetchAllPosts', 'WordPress collection changed during pagination; check again', null,
        { page, total, pages, expectedTotal, expectedPages });
    }
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length === 0) throw loggedError('fetchAllPosts', 'WordPress returned an incomplete collection', null, { page });
    // Validate via the shared transformer, but retain raw objects for the return value.
    transformPosts(batch, !options.metadataOnly);
    for (const post of batch) {
      if (seen.has(post.id)) throw loggedError('fetchAllPosts', `Duplicate WordPress post ${post.id}`, post.id, { page });
      seen.add(post.id);
      posts.push(post);
    }
    reportProgress(options, `Checking WordPress page ${page} of ${pages}`, page, pages);
    if (page === pages) break;
  }
  // A successful last HTTP page is not enough: every advertised record must be present.
  if (posts.length !== expectedTotal) throw loggedError('fetchAllPosts', 'WordPress post count does not match pagination total', null,
    { receivedPosts: posts.length, expectedTotal });
  return posts;
}

/**
 * Fetch and validate one current post immediately before indexing it.
 *
 * Refetching avoids indexing an old metadata snapshot as though it were the latest
 * content. Validate the returned ID and publication state before any local changes.
 * The single-element array preserves the helper's existing interface with transformPosts.
 *
 * @param {number|string} id Positive source post ID, or its numeric string form.
 * @returns {Promise<WordPressPost[]>} One-element array containing the original API object.
 * @throws {Error} If the ID, HTTP response, publication state, or post data is invalid.
 */
export async function fetchSinglePost(id) {
  const postId = Number(id);
  if (!Number.isSafeInteger(postId) || postId <= 0) throw loggedError('fetchSinglePost', 'Invalid WordPress post ID', id);
  logMessage('fetchSinglePost', 'INFO', postId, 'Fetching WordPress post');
  const response = await fetch(`${WORDPRESS_API_URL}/${postId}`);
  if (!response.ok) throw loggedError('fetchSinglePost', `WordPress post ${postId}: HTTP ${response.status}`, postId);
  const post = await response.json();
  if (post.id !== postId) throw loggedError('fetchSinglePost', `WordPress returned the wrong post for ${postId}`, postId, { returnedPostId: post.id });
  if (post.status && post.status !== 'publish') throw loggedError('fetchSinglePost', `Post ${postId} is no longer published`, postId, { status: post.status });
  transformPosts([post]);
  return [post];
}

/**
 * Bind a JavaScript value using Oracle's native JSON type for JSON_TABLE expansion.
 *
 * Values are bound rather than interpolated into SQL. Large post bodies are read
 * from the JSON payload as CLOBs by the indexing merge statement.
 *
 * @param {TransformedPost|TransformedPost[]} payload Validated post or metadata batch.
 * @returns {Object} Named payload bind descriptor for session.execute.
 */
function jsonBind(payload) {
  return { payload: { val: payload, type: oracledb.DB_TYPE_JSON } };
}

/**
 * Upsert checked metadata without changing searchable content or clearing errors.
 *
 * A full check calls this after marking the previous snapshot absent. A successful
 * single-post refresh also calls it to record the exact source version just indexed.
 * LAST_ERROR is cleared separately only after that post is successfully indexed.
 * JSON_TABLE uses ERROR ON ERROR so conversion failures abort rather than silently
 * supplying nulls. All writes remain in the caller's current transaction.
 *
 * @param {TransformedPost[]} posts Metadata to mark present and checked now.
 * @returns {void}
 * @throws {Error} If payload expansion or the database merge fails.
 */
function mergeSource(posts) {
  session.execute(`
    merge into blogpost_source target
    using (select jt.* from json_table(:payload, '$[*]' columns (
      id number path '$.id' error on error,
      title varchar2(255) path '$.title' error on error,
      link varchar2(255) path '$.link' error on error,
      created varchar2(19) path '$.created' error on error,
      modified varchar2(19) path '$.modified' error on error
    )) jt) source on (target.id = source.id)
    when matched then update set target.title = source.title, target.link = source.link,
      target.published_at = to_date(source.created, ${DATE_FORMAT}),
      target.source_modified = to_date(source.modified, ${DATE_FORMAT}),
      target.is_present = 'Y', target.checked_at = systimestamp
    when not matched then insert (id, title, link, published_at, source_modified, is_present, checked_at)
      values (source.id, source.title, source.link, to_date(source.created, ${DATE_FORMAT}),
        to_date(source.modified, ${DATE_FORMAT}), 'Y', systimestamp)`, jsonBind(posts));
}

/**
 * Run a maintenance operation with a database lock shared by APEX and CLI callers.
 *
 * The savepoint precedes lock acquisition so failure recovery restores this
 * operation's work without rolling back earlier work in the caller's transaction.
 * NOWAIT rejects another active run immediately. On success the lock remains held
 * until the caller commits or rolls back; do not leave a successful call uncommitted.
 * Rollback failures are logged and propagated because restoration is then uncertain.
 *
 * @template T
 * @param {string} operation Function name used to correlate lifecycle/error log entries.
 * @param {function(): Promise<T>} work Operation to execute while holding the singleton row.
 * @returns {Promise<T>} Result of work, without committing it.
 * @throws {Error} If locking, work, logging, or recovery fails.
 */
async function withMaintenanceLock(operation, work) {
  logMessage(operation, 'INFO', null, 'Starting maintenance operation');
  try {
    session.execute('savepoint blog_maintenance');
  } catch (error) {
    logMessage(operation, 'ERROR', null, 'Could not create maintenance savepoint', { message: String(error.message || error), stack: error.stack });
    throw error;
  }
  try {
    // The seed row must exist: an empty SELECT would acquire no protective row lock.
    const result = session.execute('select id from blog_refresh_state where id = 1 for update nowait');
    if (result.rows.length !== 1) throw loggedError(operation, 'BLOG_REFRESH_STATE must contain the singleton row with ID 1');
    logMessage(operation, 'INFO', null, 'Acquired maintenance lock');
    const resultValue = await work();
    logMessage(operation, 'INFO', null, 'Maintenance operation finished; transaction remains with caller');
    return resultValue;
  } catch (error) {
    logMessage(operation, 'ERROR', null, 'Maintenance operation failed; rolling back to savepoint',
      { message: String(error.message || error), stack: error.stack });
    try {
      session.execute('rollback to blog_maintenance');
    } catch (rollbackError) {
      logMessage(operation, 'ERROR', null, 'Maintenance rollback failed',
        { message: String(rollbackError.message || rollbackError), stack: rollbackError.stack });
      throw rollbackError;
    }
    logMessage(operation, 'INFO', null, 'Rolled back maintenance operation');
    if (error.errorNum === 54 || /ORA-00054/.test(String(error.message))) {
      throw loggedError(operation, 'A blog check or refresh is already running. Try again after it finishes.');
    }
    throw error;
  }
}

/**
 * Replace the source metadata snapshot after a complete, successful API fetch.
 *
 * Internal worker: must run through withMaintenanceLock. Failure anywhere after
 * fetching is rolled back by that wrapper, including absence flags and timestamps.
 * This does not refresh BLOGPOSTS, regenerate chunks, or clear indexing failures.
 *
 * @param {MaintenanceOptions} options Synchronous progress callback, if supplied.
 * @returns {Promise<number>} Number of published posts in the accepted snapshot.
 * @throws {Error} If fetching, validation, snapshot DML, or reporting fails.
 */
async function checkForUpdatesInternal(options) {
  const posts = transformPosts(await fetchAllPosts({ ...options, metadataOnly: true }), false);
  // No snapshot DML happens until all pages have been received and validated.
  logMessage('checkForUpdates', 'INFO', null, 'Replacing validated metadata snapshot', { posts: posts.length });
  // Retain missing source rows for review rather than deleting indexed posts.
  // mergeSource marks every post found in the accepted snapshot present again.
  session.execute("update blogpost_source set is_present = 'N'");
  mergeSource(posts);
  // Advance the successful-check baseline only after the whole metadata merge.
  session.execute('update blog_refresh_state set last_checked_at = systimestamp where id = 1');
  reportProgress(options, `Check complete: ${posts.length} published posts found`, posts.length, posts.length);
  return posts.length;
}

/**
 * Replace one post and its entire chunk set inside the current transaction.
 *
 * The caller must establish blog_post_refresh before calling and roll back to it
 * on error. Updating the body, removing old chunks, generating new embeddings,
 * and advancing the indexing baseline must succeed together for this post.
 * Existing readers retain the previously committed version until the batch commits.
 *
 * @param {TransformedPost} post Validated full post with converted content.
 * @returns {number} Number of replacement chunks generated for the post.
 * @throws {Error} If database work fails, no chunks are produced, or an embedding is null.
 */
function replaceIndexedPost(post) {
  session.execute(`
    merge into blogposts target
    using (select jt.* from json_table(:payload, '$' columns (
      id number path '$.id' error on error,
      slug varchar2(255) path '$.slug' error on error,
      link varchar2(255) path '$.link' error on error,
      created varchar2(19) path '$.created' error on error,
      modified varchar2(19) path '$.modified' error on error,
      content clob path '$.content' error on error,
      title varchar2(255) path '$.title' error on error
    )) jt) source on (target.id = source.id)
    when matched then update set target.slug = source.slug, target.link = source.link,
      target.created = to_date(source.created, ${DATE_FORMAT}), target.content = source.content,
      target.title = source.title, target.modified = to_date(source.modified, ${DATE_FORMAT})
    when not matched then insert (id, slug, link, created, content, title, modified)
      values (source.id, source.slug, source.link, to_date(source.created, ${DATE_FORMAT}),
        source.content, source.title, to_date(source.modified, ${DATE_FORMAT}))`, jsonBind(post));

  // Replace the complete chunk set: edits can change both the text and chunk IDs/count.
  // A per-post rollback restores these deleted rows if any later indexing step fails.
  session.execute('delete from blogpost_chunks where post_id = :id', { id: post.id });
  logMessage('replaceIndexedPost', 'INFO', post.id, 'Generating replacement chunks and embeddings');
  // Pipeline: extract text -> overlapping word chunks -> database-model embeddings.
  // The 4,000-byte chunk limit matches CHUNK_DATA's column capacity. JSON extraction
  // fails explicitly on conversion errors instead of silently yielding null data.
  // DOC_MODEL must match the model used to embed queries for semantic search.
  const generated = session.execute(`
    insert into blogpost_chunks (post_id, chunk_id, chunk_data, chunk_embedding)
    select posts.id, embeddings.embed_id, embeddings.embed_data, to_vector(embeddings.embed_vector)
    from (select id, content from blogposts where id = :id) posts,
      dbms_vector_chain.utl_to_embeddings(
        dbms_vector_chain.utl_to_chunks(dbms_vector_chain.utl_to_text(posts.content),
          json('{
            "limit":4000,"by":"words","max":"200","overlap":"20",
            "split":"recursively","language":"american","normalize":"all"
          }')),
        json('{"provider":"database","model":"doc_model"}')
      ) embedding_result,
      json_table(embedding_result.column_value, '$[*]' columns (
        embed_id number path '$.embed_id' error on error,
        embed_data varchar2(4000) path '$.embed_data' error on error,
        embed_vector clob path '$.embed_vector' error on error
      )) embeddings`, { id: post.id });
  // An INSERT can succeed with zero rows; that is not a valid replacement index.
  const count = Number(generated.rowsAffected);
  if (!count) throw loggedError('replaceIndexedPost', 'No chunks generated; previous indexed version retained', post.id);
  // Check vector nullness in the predicate; COUNT(VECTOR_COLUMN) is unsupported.
  const invalid = session.execute(`select count(*) invalid_count from blogpost_chunks
    where post_id = :id and chunk_embedding is null`, { id: post.id }).rows[0].INVALID_COUNT;
  if (Number(invalid)) throw loggedError('replaceIndexedPost', 'Generated chunks contain missing embeddings', post.id, { invalidChunks: Number(invalid) });

  // Record the expected count only after validating the generated chunk set.
  // The status view later compares this baseline with actual rows to detect gaps.
  session.execute(`update blogposts set indexed_at = systimestamp, indexed_chunk_count = :count
    where id = :id`, { id: post.id, count });
  // The post may have changed again since the metadata check; record what was fetched.
  mergeSource([post]);
  session.execute('update blogpost_source set last_error = null where id = :id', { id: post.id });
  return count;
}

/**
 * Attempt each suggested source-present post, preserving its old index on failure.
 *
 * Internal worker: must run through withMaintenanceLock. The status view owns the
 * New/Changed/Unknown/Missing chunks/Failed decision; absent source posts are never
 * automatically removed or refreshed here. Candidates are materialized before
 * processing, and every candidate is fetched again before replacing its data.
 *
 * A per-post error is recorded after rolling back that post and normally does not
 * reject the batch. A failure in recovery, error storage, reporting, or batch-level
 * SQL escapes to the maintenance wrapper and rolls back the entire operation.
 *
 * @param {MaintenanceOptions} options Synchronous progress callback, if supplied.
 * @returns {Promise<RefreshSummary>} Batch outcome, including failed-post count.
 * @throws {Error} If candidate selection, batch bookkeeping, or recovery cannot complete.
 */
async function refreshSuggestedPostsInternal(options) {
  const candidates = session.execute(`select id from blogpost_refresh_status
    where refresh_suggested = 'Y' and is_present = 'Y' order by id`).rows;
  const summary = { refreshed: 0, failed: 0, chunks: 0 };
  reportProgress(options, `Refreshing ${candidates.length} suggested posts`, 0, candidates.length);
  for (let index = 0; index < candidates.length; index++) {
    const id = Number(candidates[index].ID);
    logMessage('refreshSuggestedPosts', 'INFO', id, 'Starting post refresh');
    // Set a fresh boundary for this post while retaining earlier successful posts.
    session.execute('savepoint blog_post_refresh');
    try {
      const [post] = transformPosts(await fetchSinglePost(id));
      const chunks = replaceIndexedPost(post);
      summary.chunks += chunks;
      summary.refreshed++;
      logMessage('refreshSuggestedPosts', 'INFO', id, 'Post refreshed successfully', { chunks });
    } catch (error) {
      const message = String(error.message || error).slice(0, 1000);
      logMessage('refreshSuggestedPosts', 'ERROR', id, 'Post refresh failed; restoring previous indexed version',
        { message, stack: error.stack });
      session.execute('rollback to blog_post_refresh');
      logMessage('refreshSuggestedPosts', 'INFO', id, 'Rolled back post refresh');
      // Write the error after rollback so it survives a successful batch commit.
      // The failed status remains a candidate for a later retry.
      session.execute('update blogpost_source set last_error = :message where id = :id', { id, message });
      summary.failed++;
    }
    reportProgress(options, `Processed ${index + 1} of ${candidates.length}; ${summary.failed} failed`,
      index + 1, candidates.length);
  }
  // This timestamp means the batch was attempted, even if some individual posts failed.
  // Store its counters with the data changes; the caller commits everything together.
  session.execute(`update blog_refresh_state set last_refreshed_at = systimestamp,
    refreshed_posts = :refreshed, failed_posts = :failed, generated_chunks = :chunks
    where id = 1`, summary);
  reportProgress(options, `Refresh complete: ${summary.refreshed} refreshed, ${summary.failed} failed`,
    candidates.length, candidates.length);
  return summary;
}

/**
 * Public metadata-only operation used by the APEX Check for updates action.
 *
 * Leaves searchable posts and chunks untouched. Commit the successful result to
 * publish the snapshot and release the maintenance lock; this function never commits.
 *
 * @param {MaintenanceOptions} [options={}] Optional synchronous progress reporting.
 * @returns {Promise<number>} Number of source posts in the accepted snapshot.
 * @throws {Error} If a complete metadata check cannot be performed or stored.
 */
export async function checkForUpdates(options = {}) {
  return withMaintenanceLock('checkForUpdates', () => checkForUpdatesInternal(options));
}

/**
 * Public indexing-only operation used by the APEX Refresh suggested posts action.
 *
 * Uses the most recent stored metadata snapshot; it does not first discover new
 * posts. Run checkForUpdates beforehand to discover new/changed source posts.
 * Individual post failures are returned in the summary. The caller must commit
 * successful work and recorded errors, or roll back, to release the lock.
 *
 * @param {MaintenanceOptions} [options={}] Optional synchronous progress reporting.
 * @returns {Promise<RefreshSummary>} Counts for this attempt; inspect failed for partial success.
 * @throws {Error} If the batch itself cannot complete safely.
 */
export async function refreshSuggestedPosts(options = {}) {
  return withMaintenanceLock('refreshSuggestedPosts', () => refreshSuggestedPostsInternal(options));
}

/**
 * Backward-compatible CLI entry: check the source, then incrementally index candidates.
 *
 * Both workers share one lock and transaction. Call the internal workers directly
 * to avoid creating nested maintenance savepoints with the same reserved name.
 * Per-post failures permit other candidates to complete and are reflected in the
 * summary. A batch-level exception rolls back both the check and indexing work.
 * The existing PL/SQL call specification can invoke this export unchanged; APEX
 * invokes the separate operations directly through its JavaScript module import.
 *
 * @param {MaintenanceOptions} [options={}] Optional synchronous progress reporting.
 * @returns {Promise<RefreshSummary>} Incremental indexing outcome after the source check.
 * @throws {Error} If the check or batch cannot complete; the caller still owns commit/rollback.
 */
export async function refreshBlogposts(options = {}) {
  return withMaintenanceLock('refreshBlogposts', async () => {
    await checkForUpdatesInternal(options);
    return refreshSuggestedPostsInternal(options);
  });
}
