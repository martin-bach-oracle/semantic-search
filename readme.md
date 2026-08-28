# Semantic Search

This little project shows how Oracle AI Database can be used to

- fetch all posts from my public website and transform them to text
- store the posts in a table
- use AI Vector Search functionality to chunk the posts
- use an APEX app to search the posts

Due to initial time constraints there isn't much available in terms of error handling/input validation/security. These items are all one the todo list and will be eventually implemented.

## Using the code

Follow these steps.

### Download APEX

Download the latest APEX release to the project root

```
curl -LO https://download.oracle.com/otn_software/apex/apex_26.1_en.zip
unzip -q apex_26.1_en.zip && rm apex_26.1_en.zip
```

The compose file will bring up the database and once it's up, intall ORDS and APEX. Optionally apply the latest APEX patch.

### Initialise the database

The database should automatically initialise with the necessary network rules (see `compose.yml`). You need an `.env` file for this to work. Create it an populate it with the following values:

```sh
ORACLE_PASSWORD=<your oracle DBA password>
APP_USER_PASSWORD=<your application schema/owner password>
```

Then start the database, install ORDS and APEX.

```sh
docker compose up
```

Next, once the database is up and running, install the NPM modules. They are used for the MCP server (optional)

```sh
npm install
```

### Deploy the application

Use SQLcl projects to deploy the application. Connect as `demouser` to `freepdb1` then run

```sql
@dist/install.sql
```

Note that the APEX application's workspace must use `demouser` as its parsing schema! You must create the workspace manually. Once imported, you must create a vector provider in workspace utilities.

### Populate the search

Next, execute `deploy.sh` to download/copy the ONNX AI model into the database container. Create the doc model while connected as a DBA to `freepdb1`:

With the doc model created, it's time to stage the initial load.

```sql
begin
    blog_posts_package.refreshBlogposts;

    INSERT INTO blogpost_chunks (
        post_id, 
        chunk_id,
        chunk_data,
        chunk_embedding
    )
    SELECT
        p.id                       post_id,
        et.embed_id                chunk_id,
        et.embed_data              chunk_data,
        to_vector(et.embed_vector) chunk_embedding
    FROM
        blogposts p,
        dbms_vector_chain.utl_to_embeddings(
            dbms_vector_chain.utl_to_chunks(
                dbms_vector_chain.utl_to_text(p.content),
                JSON(
                        '{"normalize":"all"}'
                    )
            ),
            JSON(
                    '{"provider":"database", "model":"doc_model"}'
                )
        ) t,
        JSON_TABLE ( t.column_value, '$[*]'
                COLUMNS (
                    embed_id NUMBER PATH '$.embed_id',
                    embed_data VARCHAR2 ( 4000 ) PATH '$.embed_data',
                    embed_vector CLOB PATH '$.embed_vector'
                )
            )
        et
    WHERE p.id not in (select post_id from blogpost_chunks);
end;
/

commit;
```

This will take a while, especially during the initial load. The code has plenty of potential for improvement, especially for delta-loading. `refreshBlogposts` in the package refer to the JavaScript function `refreshBlogposts()` in `src/javascript/fetchPosts.js`. 
See also `src/database/snippets.sql` for more snippets.

## MCP Server

The MCP Server is implemented in Typescript. It relies on a REST API published in ORDS, accessible via `http://localhost:8080/ords/demouser/api/search/`. The code is very much not secure since there is no OAuth2 protection implemented yet. Due to a known issue the ORDS configuration isn't exported correctly, make sure the call to `ords.define_handler` contains `p_mle_env_name   => 'SEMANTIC_SEARCH_ENV',` or else the REST calls will fail.

The API calls `semanticSearch()`, defined in `ORDS_MODULE`, which in turn selects from `blogpost_search_source`, the same view that's defined as the search source for the APEX app.

## Troubleshooting

Check the log table for debug information, and correct accordingly.

For ORDS-related problems, check the ORDS server logs.
