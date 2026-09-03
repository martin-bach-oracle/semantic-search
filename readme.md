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
docker compose up -d
```

Install the [logger framework](https://github.com/OraOpenSource/Logger/tree/master) once the database is available

```sh
cd /tmp
tag_name=$(basename $(curl -fs -o/dev/null -w %{redirect_url} https://github.com/OraOpenSource/Logger/releases/latest))
curl -OL "https://github.com/OraOpenSource/Logger/raw/master/releases/logger_${tag_name}.zip"
unzip logger_${tag_name}.zip -d logger && rm logger_${tag_name}.zip

sql sys@localhost/freepdb1 as sysdba <<!

create user logger identified by logger;
alter user logger quota 1g on users;
grant connect,create view, create job, create table, create sequence, create trigger, create procedure, create any context, create public synonym to logger;

conn logger/logger@localhost/freepdb1
@@logger/logger_install.sql

create or replace public synonym logger for logger.logger;
create or replace public synonym logger_logs for logger.logger_logs;
create or replace public synonym logger_logs_apex_items for logger.logger_logs_apex_items;
create or replace public synonym logger_prefs for logger.logger_prefs;
create or replace public synonym logger_prefs_by_client_id for logger.logger_prefs_by_client_id;
create or replace public synonym logger_logs_5_min for logger.logger_logs_5_min;
create or replace public synonym logger_logs_60_min for logger.logger_logs_60_min;
create or replace public synonym logger_logs_terse for logger.logger_logs_terse;

grant execute on logger to public;
grant select, delete on logger_logs to public;
grant select on logger_logs_apex_items to public;
grant select, update on logger_prefs to public;
grant select on logger_prefs_by_client_id to public;
grant select on logger_logs_5_min to public;
grant select on logger_logs_60_min to public;
grant select on logger_logs_terse to public;

!

cd -
```

Next, once the database is up and running, install the NPM modules. They are used for the MCP server (optional)

```sh
npm install
```

### Deploy the application

Start by creating the workspace for the APEX application by executing `dist/utils/apex.sql`. It creates the workspace and an admin user.

Use SQLcl projects to deploy the application. Connect as `demouser` to `freepdb1` then run

```sql
@dist/install.sql
```

### Populate the Search

Still connected as `demouser` execute this code block to populate the search tables.

```sql
begin
    demouser.blog_posts_package.refreshblogposts;
    commit;
end;
/
```

This will take a while, especially during the initial load.

## MCP Server

This is work in progress, the MCP server cannot be used at the moment.

The MCP Server is implemented in Typescript. It relies on a REST API published in ORDS, accessible via `http://localhost:8080/ords/demouser/api/search/`. The code is very much not secure since there is no OAuth2 protection implemented yet. Due to a known issue the ORDS configuration isn't exported correctly, make sure the call to `ords.define_handler` contains `p_mle_env_name   => 'SEMANTIC_SEARCH_ENV',` or else the REST calls will fail.

The API calls `semanticSearch()`, defined in `ORDS_MODULE`, which in turn selects from `blogpost_search_source`, the same view that's defined as the search source for the APEX app.

## Troubleshooting

Check the logger log tables for debug information, and correct accordingly.

For ORDS-related problems, check the ORDS server logs.
