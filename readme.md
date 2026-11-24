# Semantic Search

This demo uses Oracle AI Database, JavaScript MLE, AI Vector Search and Oracle
APEX to search posts from [martincarstenbach.com](https://martincarstenbach.com/)
by meaning. JavaScript fetches WordPress posts, converts their HTML to plain text,
and stores them in Oracle. The database extracts text, creates overlapping chunks,
and generates embeddings with the local ONNX model `DOC_MODEL`.

The readable APEX application contains three pages:

| Page | Purpose |
| --- | --- |
| 1 — Home | Introduces the demo and links to search. |
| 2 — Semantic Search | Searches `BLOGPOST_SEARCH_SOURCE` and links matching passages to their original posts. |
| 3 — Blog Refresh | Checks for new or changed posts, reports chunk counts and refreshes suggested posts in the background. |

The application uses Oracle APEX Accounts authentication. Blog Refresh has no
additional maintenance role restriction. This is a lab/demo application; the
custom ORDS search endpoint has no application-specific OAuth protection configured.

## Source and release status

The current development changes have not all been captured in SQLcl Projects
exports. Distinguish the editable implementation from the exported database
baseline and packaged releases:

| Location | Current contents |
| --- | --- |
| `src/javascript/fetchPosts.js` | Incremental check/refresh implementation, Logger tracing, inline comments and JSDoc. |
| `src/database/demouser/apex_apps/f101/readable/` | APEXlang source including Blog Refresh and the application's MLE environment setting. |
| `src/database/demouser/apex_apps/f101/f101.sql` | SQL application export that has not yet captured Page 3. |
| `src/database/demouser/mle_modules/bundle_module.js` and `.sql` | Older generated bundle that still truncates and reloads both indexing tables. Rebuild/load the JavaScript source before testing the new refresh. |
| `src/database/demouser/tables/` and `views/` | Exported baseline; the Blog Refresh schema additions listed below are not yet exported here. |
| `src/database/demouser/mle_envs/semantic_search_env.sql` | Exports the `ords` import only; the new `blog_posts` mapping still needs capturing. |
| `sql_changes.sql` | One-time additional MLE import mapping, not a complete schema migration. |
| `dist/` | Packaged SQLcl Projects releases through `1.0.2`; does not yet package the new incremental refresh and Page 3 together. |

Installing `dist/install.sql` alone does not install the complete Blog Refresh
feature. Finish the development database changes, test them and export/stage a
new release as described below. Do not modify historical release changesets to
include the new work.

## Using the code

Most of you probably want to use the project on an Autonomous AI Database 26ai instance. ORDS and APEX are provided by the service, which reduces local setup work.

The current source targets APEXlang `26.1.0+3102`; the SQLcl project configuration
specifies SQLcl `26.3.1.0`. Use an Oracle database with MLE, AI Vector Search and
Oracle Text available. JavaScript MLE runs inside the database; Node.js/npm are
needed locally to bundle the `html-to-text` dependency. Background processing
requires `CREATE JOB` for the parsing schema and an enabled job-processing setup.
The local Compose setup additionally needs Docker Compose or a compatible Podman
setup.

## Using the project with Autonomous AI Database Serverless

Follow these steps to install the project in an [Always Free Autonomous AI Database](https://docs.oracle.com/en/cloud/paas/autonomous-database/serverless/adbsb/autonomous-always-free.html).

### Create the DEMOUSER account

Connect to the ADB-S instance as `ADMIN`, then create the user:

```sql
create user demouser identified by "<choose-a-schema-password>"
default tablespace users
quota 1g on users;

grant CREATE SEQUENCE to DEMOUSER;
grant CREATE ASSERTION to DEMOUSER;
grant CREATE DOMAIN to DEMOUSER;
grant CREATE JOB to DEMOUSER;
grant CREATE MINING MODEL to DEMOUSER;
grant CREATE MLE to DEMOUSER;
grant CREATE SESSION to DEMOUSER;
grant DEBUG CONNECT SESSION to DEMOUSER;
grant EXECUTE DYNAMIC MLE to DEMOUSER;
grant FORCE TRANSACTION to DEMOUSER;
grant CREATE CLUSTER to DEMOUSER;
grant CREATE MATERIALIZED VIEW to DEMOUSER;
grant CREATE OPERATOR to DEMOUSER;
grant CREATE PROCEDURE to DEMOUSER;
grant CREATE PROPERTY GRAPH to DEMOUSER;
grant CREATE SYNONYM to DEMOUSER;
grant CREATE TABLE to DEMOUSER;
grant CREATE TRIGGER to DEMOUSER;
grant CREATE TYPE to DEMOUSER;
grant CREATE VIEW to DEMOUSER;
```

This will become the parsing schema for the APEX application.

## Using the project on your local laptop

If you prefer to run the project locally, you require podman or docker compose. Since APEX doesn't arrive pre-installed with Oracle AI Database Free, you need to install it yourself.

### Download APEX

Download the APEX distribution you intend to run and extract it into `./apex`,
which is mounted into the ORDS container and excluded from Git. For example, to
use APEX 26.2 with the current 26.1 APEXlang source:

```sh
curl -LO https://download.oracle.com/otn_software/apex/apex_26.2_en.zip
unzip -q apex_26.2_en.zip && rm apex_26.2_en.zip
```

If you have access to them, install the latest patches (you get the latest APEX patches with Autonomous AI Database as part of the package).

The compose file will bring up the database and once it's up, install ORDS and APEX. Optionally apply the latest APEX patch.

### Initialise the database

The Compose file currently selects database image `ghcr.io/gvenzl/oracle-free:23.26.3`
and ORDS image `container-registry.oracle.com/database/ords:26.2.2`. It exposes the
database on port 1521 and ORDS HTTP on port 8080.

On initial database creation, the scripts mounted from `setup/` grant `DEMOUSER`
HTTP access to `public-api.wordpress.com` and create the `MODEL_DIR` directory
object with read/write grants. They do not load the ONNX model or install the
application schema. These initialization scripts are not a mechanism for upgrading
an existing database volume.

Create an `.env` file with runtime passwords:

```sh
ORACLE_PASSWORD='<your oracle DBA password>'
APP_USER_PASSWORD='<your application schema/owner password>'
```

Keep `.env` out of source control. Then start the services:

```sh
docker compose up -d
```

## Common steps

Whether you use a local deployment or an ADB-S instance, complete these steps.

### Confirm schema privileges and outbound access

Use `DEMOUSER` as the application owner/parsing schema, with the privileges needed
to create the project's schema objects, load the mining model, execute MLE and run
APEX background jobs. The account-creation example above lists lab grants; creating
an `APP_USER` through Compose does not replace checking its effective privileges.

The refresh code makes HTTPS requests from the database to
`public-api.wordpress.com`. On a local first initialization, `setup/01_ace.sql`
adds the HTTP host ACE. For an existing local database or Autonomous Database,
configure the corresponding outbound access separately; the local setup script
contains `ALTER SESSION SET CONTAINER` and should not be run unchanged on ADB-S.

### Create an APEX Workspace

Create a new workspace using `demouser` as the parsing schema. Name it `demouser`. If you want to deviate from the standard set in this project, make sure to update `dist/env/default.properties`.

### Install the Logger Framework

Install the [OraOpenSource Logger framework](https://github.com/OraOpenSource/Logger)
in a `LOGGER` schema using its installation instructions. Both the refresh module
and the Blog Refresh background process resolve the package as
`plsffi.resolvePackage('LOGGER.LOGGER')`; a public synonym is not required.

Grant the application schema permission to invoke Logger and, if it should inspect
logs directly, read its log table. Run these grants as `LOGGER` or an appropriately
privileged administrator:

```sql
grant execute on logger.logger to demouser;
grant select on logger.logger_logs to demouser;
```

The exported `DEMOUSER.LOG_TABLE` is a separate legacy table. The current refresh
implementation writes through the Logger package, not that table. Confirm an
actual log entry can be written as `DEMOUSER`; resolving an FFI package alone does
not verify that its procedures can be invoked.

### Load the embedding model

The ingestion pipeline, APEX vector provider and ORDS search all refer to
`DEMOUSER.DOC_MODEL`. Use the augmented `all_MiniLM_L12_v2.onnx` model, with its
pre/post-processing, for both stored chunks and query embeddings.

For a local database, copy the model into the database container's
`/opt/oracle/ai` directory and make it readable by the database OS user. The
`setup/02_ai_model.sql` script creates `MODEL_DIR` for that path. Once the model
file is present, load it as `DEMOUSER`:

```sql
begin
    dbms_vector.load_onnx_model(
        directory  => 'MODEL_DIR',
        file_name  => 'all_MiniLM_L12_v2.onnx',
        model_name => 'DOC_MODEL'
    );
end;
/
```

On Autonomous Database, use its supported model upload/loading process and keep
the resulting schema model name `DOC_MODEL`; the container directory setup is
local-only. The notes under `model/` describe the model, but use a different example
model name. The current SQLcl Projects releases do not load the model binary.

`deploy-local.sh` contains a local model download/copy/load example and bundles the
JavaScript. It also drops/reloads `DOC_MODEL`, uses the local database connection,
and runs with shell tracing enabled. Do not use it as the general incremental
schema upgrade procedure; the focused module-loading steps below avoid that reset
and keep passwords out of command arguments and traced output.

### Install a packaged release

Create the workspace first and review `dist/env/default.properties`. The checked-in
properties specify workspace/schema `DEMOUSER` and remap source application 101
to application ID **1042**. The readable APEXlang deployment configuration instead
specifies **101**. Select the intended application ID before importing/exporting;
these are different deployment configurations, not evidence of the running app ID.

Connect to the intended schema in SQLcl and run the packaged installer from the
`dist` directory so its relative changelog, search-path and properties references
resolve there:

```sql
cd dist
@install.sql
cd ..
```

The existing package is a baseline installation. To use Blog Refresh before the
next complete release is generated, its schema, updated module and readable app
source must also be present in the development database.

## Developing and releasing Blog Refresh

Use SQLcl Projects to capture tested database/application changes. The following
source-to-database steps prepare development testing; exporting and staging them
then produces the deployable release. No new JavaScript call specifications are
needed for Page 3: its server-side code uses MLE/JavaScript and imports the module
directly.

### Confirm the refresh schema is installed

The new JavaScript and Page 3 require these additions to the exported baseline:

| Object | Required additions/contents |
| --- | --- |
| `BLOGPOSTS` | `INDEXED_AT` and `INDEXED_CHUNK_COUNT`, alongside the existing `MODIFIED` column. |
| `BLOGPOST_SOURCE` | `ID`, `TITLE`, `LINK`, `PUBLISHED_AT`, `SOURCE_MODIFIED`, `IS_PRESENT`, `CHECKED_AT`, `LAST_ERROR`. |
| `BLOG_REFRESH_STATE` | `ID`, `LAST_CHECKED_AT`, `LAST_REFRESHED_AT`, `REFRESHED_POSTS`, `FAILED_POSTS`, `GENERATED_CHUNKS`; requires the singleton row with `ID = 1`. |
| `BLOGPOST_REFRESH_STATUS` | View combining indexed posts, source metadata and actual/expected chunk counts; exposes `STATUS` and `REFRESH_SUGGESTED`. |

These DDL changes were handled separately during development. Their definitions
are not yet included in `src/database` or the packaged releases, and
`sql_changes.sql` currently contains only the import mapping. For a clean target,
obtain/export the complete schema changes before attempting to use Page 3.

The state row is required both by the maintenance lock and by the status view.
Include its insertion in the release as a custom data change or explicitly scoped
DML export. `.dbtools/filters/dml.filters` currently disables table-data export, so
an ordinary schema export will not capture that seed row.

When exporting the view, retain the corrected non-null embedding count:
`count(case when chunk_embedding is not null then 1 end)`. Passing the VECTOR
column directly to `count(chunk_embedding)` produced the reported `ORA-22849` error.

The existing `BLOGPOST_CHUNKS` export defines `CHUNK_DATA` as `VARCHAR2(4000 BYTE)`,
a unique key on `(POST_ID, CHUNK_ID)` and, in `ref_constraints/fk_post_chunk.sql`, a
foreign key to `BLOGPOSTS.ID`. The search view joins those two tables; it does not
generate or store query embeddings itself.

### Build and load the updated MLE module

From the repository root:

```sh
npm ci
npx esbuild src/javascript/fetchPosts.js --bundle --outfile=build/bundle.js --format=esm --external:mle-js-fetch
```

Connect interactively or with your own saved SQLcl connection as `DEMOUSER`, then
load the generated module:

```sql
mle create-module -filename build/bundle.js -module-name bundle_module -replace
```

On the first upgrade, apply the additional `blog_posts` import mapping in
`sql_changes.sql` to the existing `SEMANTIC_SEARCH_ENV`. The environment must retain
its existing `ords` mapping too. The added mapping is one-time DDL; adding the same
import name a second time fails. Replacing the module later does not require adding
the mapping again.

### Import the readable APEX application

The readable source sets the application's MLE environment to
`SEMANTIC_SEARCH_ENV`. From the repository root, connected in SQLcl to the intended
development schema/workspace, validate and import it:

```sql
apex validate -input src/database/demouser/apex_apps/f101/readable
apex import -input src/database/demouser/apex_apps/f101/readable
```

Check the application ID/deployment configuration before import. Validation checks
APEXlang structure; it does not establish that the database objects, module imports,
network access, Logger, model and background processing work at runtime.

### Test, export and stage

1. Test the two maintenance actions and search in the development application.
2. Run `project export` from the project root against that same database. The project
   uses SQLcl `26.3.1.0` and requests both `APEXLANG` and `APPLICATION_SOURCE` exports.
3. Review the exported table/view definitions, seed-data change, MLE module and
   environment mappings, and APEX app exports. Check that the intended application
   was exported and that `BUNDLE_MODULE` contains `checkForUpdates` and
   `refreshSuggestedPosts`, rather than the old truncation implementation.
4. Review and commit the source changes, then run `project stage`. Review and commit
   the generated changesets before creating the next version with `project release`.
5. Generate/test the release artifact with the SQLcl Projects workflow before
   deploying it to another environment. The configured last release is `1.0.2`.

The configured connection name is local developer configuration; use the intended
database connection rather than assuming that name is available on another machine.
See the [SQLcl Projects quick start](https://docs.oracle.com/en/database/oracle/sql-developer-command-line/26.3/sqcug/quick-start.html)
for staging, release and artifact commands.

## Using the application

### Search

Open **Semantic Search** and enter a natural-language question. APEX searches
`BLOGPOST_SEARCH_SOURCE`, which joins `BLOGPOSTS` to `BLOGPOST_CHUNKS` and exposes
post IDs, titles, links, chunk IDs, chunk text and embeddings. Results represent
matching passages, so multiple chunks can point to the same post. The configured
vector provider uses `DEMOUSER.DOC_MODEL`; result links lead to the original post.

### Check and refresh posts

On **Blog Refresh**:

1. Click **Check for updates**. This fetches metadata, validates pagination, IDs
   and UTC timestamps, then replaces the source snapshot. It does not generate
   embeddings or modify indexed post content. HTTP failures, missing/inconsistent
   pagination headers, duplicate IDs and an unexpectedly empty collection reject
   the check and preserve its previous committed snapshot.
2. Review actual/expected chunk counts, source/indexed modification dates and
   refresh suggestions. Legacy indexed posts without the new baseline appear as
   **Unknown** and need an initial refresh to establish it.
3. Click **Refresh suggested posts**. It fetches each candidate's latest body,
   replaces that post and its chunks, then records the successful indexed version
   and expected chunk count. Current posts are skipped. Missing source posts are
   retained for review rather than deleted.
4. Follow **Background Jobs**, which polls every five seconds while the page is
   visible. Use **Reload reports** to update all counts and inspect any errors.

Suggested statuses are **New**, **Changed**, **Unknown**, **Missing chunks** and
**Failed**, provided the last source check still marks the post present. A source
check timestamp is separate from `INDEXED_AT`; checking a post is not indexing it.
The source edit time is stored in `MODIFIED` from WordPress's `modified_gmt`, using
UTC consistently. The indexing timestamp records when its chunks were generated.

The two actions share a serialized APEX background chain. A singleton database row
lock also rejects overlapping maintenance calls outside APEX. Each post has a
savepoint: if processing fails, its previous indexed version is restored and
`LAST_ERROR` remains available for retry. Other posts can continue. The background
worker commits the batch once at the end; searches see the previous committed data
until then. A completed batch can include failed posts, so inspect its failure
count and per-post errors as well as the job state.

The current conversion path still calls `html-to-text` for titles and bodies, then
`UTL_TO_TEXT` before `UTL_TO_CHUNKS` and `UTL_TO_EMBEDDINGS`. Chunking is configured
with `by: words`, `max: 200`, `overlap: 20`, recursive splitting and a 4,000-byte
limit matching `CHUNK_DATA`. JSON extraction uses `ERROR ON ERROR` to avoid
silently accepting conversion failures. See the
[UTL_TO_CHUNKS reference](https://docs.oracle.com/en/database/oracle/oracle-database/26/vecse/utl_to_chunks-dbms_vector_chain.html)
for the chunking parameters.

### Refresh from SQLcl

After loading the updated module and schema, the existing
`BLOG_POSTS_PACKAGE.REFRESHBLOGPOSTS` call specification remains available. It now
checks the source and refreshes candidates incrementally. It does not commit;
SQLcl callers own the transaction and must release the maintenance lock promptly:

```sql
begin
    demouser.blog_posts_package.refreshblogposts;
    commit;
exception
    when others then
        rollback;
        raise;
end;
/
```

The JavaScript exports `checkForUpdates()` and `refreshSuggestedPosts()` support
the separate APEX actions. They have no additional PL/SQL call specifications.
Initial indexing can take a while because every candidate needs chunks/embeddings.

## ORDS and MCP prototype

The custom endpoint is `GET /ords/demouser/api/search/:searchTerm` (HTTP port 8080
in the local Compose setup). URL-encode the search text in the path. The handler
imports `semanticSearch()` from `ORDS_MODULE` using the `ords` environment mapping.
Both the schema export and current packaged ORDS script explicitly set
`p_mle_env_name => 'SEMANTIC_SEARCH_ENV'`; preserve this when re-exporting.

`semanticSearch()` ranks stored chunks using cosine distance against
`vector_embedding(DOC_MODEL using :searchTerm as data)`. It returns up to five
lowercase `title`/`link` objects by default; several results may reference one post.
This module is separate from the new incremental refresh code.

The TypeScript prototype at `src/typescript/mcp.ts` exposes a stdio MCP tool named
`fetchSearchResults`, backed by that HTTP endpoint. Its base URL is currently
hard-coded to the local service. The MCP integration is experimental and has not
been validated as a supported end-to-end setup by this source review.

## Troubleshooting and validation

- **Page 3 reports missing tables, columns or view:** export/apply the Blog Refresh
  schema additions. The current historical schema export and `sql_changes.sql`
  alone are insufficient for a clean installation of that feature.
- **Module import or missing-function errors:** rebuild/load `BUNDLE_MODULE`, check
  the `blog_posts` import in `SEMANTIC_SEARCH_ENV`, and check the app's environment
  setting. The old generated bundle exports no incremental maintenance functions.
- **Refresh does not start:** verify APEX background processing and `CREATE JOB`.
  Check for another transaction holding the singleton lock; CLI callers must
  commit or roll back after a maintenance call.
- **Source checks fail:** inspect the logged page/status and pagination details,
  network access to `public-api.wordpress.com`, and the previous successful check
  timestamp. Do not treat partially fetched data as a successful refresh.
- **Indexing/search model errors:** verify `DOC_MODEL` exists in `DEMOUSER` and is
  the model intended for both indexed documents and query embeddings.
- **A refresh completes with failures:** inspect `LAST_ERROR` and retry suggested
  posts. A batch success state does not imply every post was refreshed.
- **Logger diagnostics:** query `LOGGER.LOGGER_LOGS` for scopes starting with
  `semantic_search.fetch_posts` or `semantic_search.apex.blog_refresh`. Error logs
  include contextual details/post IDs and JavaScript stacks; lifecycle logs cover
  fetches, locks, indexing, recovery and the background commit boundary. The actual
  entries retained depend on Logger configuration and working schema grants.
- **ORDS errors:** check the ORDS server logs and handler's MLE environment/imports.

Documentation and offline source/JavaScript checks do not establish live behavior.
After loading changes, test update checks, initial/incremental indexing, failed-post
rollback and retry, concurrent-run rejection, background progress and semantic
search against the target database/application.
