# Semantic Search

This little project shows how Oracle AI Database can be used to

- fetch all posts from my public website and transform them to text
- store the posts in a table
- use AI Vector Search functionality to chunk the posts
- use an APEX app to search the posts

Due to initial time constraints there isn't much available in terms of error handling/input validation/security. These items are all one the todo list and will be eventually implemented.

## Using the code

Most of you probably want to use the project on an Autonomous AI Database 26ai instance. This saves you from having to deal with any other infrustructure components like ORDS and APEX since they are provided out of the box.

## Using the project with Autonomous AI Database Serverless

Follow these steps to install the project in an [Always Free Autonomous AI Database](https://docs.oracle.com/en/cloud/paas/autonomous-database/serverless/adbsb/autonomous-always-free.html).

### Create the DEMOUSER account

Connect to the ADB-S instance as `ADMIN`, then create the user:

```sql
create user demouser identified by "asdasdsadasdasd your super secret password here asdsgfghrtewfvdckjnb"
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
grant CREATE SEQUENCE to DEMOUSER;
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

Download the latest APEX release to the project root. It is excluded from source control via an entry in `.gitignore`.

```sh
curl -LO https://download.oracle.com/otn_software/apex/apex_26.2_en.zip
unzip -q apex_26.2_en.zip && rm apex_26.2_en.zip
```

If you have access to them, install the latest patches (you get the latest APEX patches with Autonomous AI Database as part of the package).

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

## Common Steps

Regardless whether you chose a local deployment or an ABD-S instance, complete the setup with these steps:

### Create an APEX Workspace

Create a new workspace using `demouser` as the parsing schema. Name it `demouser`. If you want to deviate from the standard set in this project, make sure to update `dist/env/default.properties`.

### Install the Logger Framework

The [logger framework](https://github.com/OraOpenSource/Logger/tree/master) allows us to use logging in Oracle without having to reinvent the wheel. Once the database is available, install it. This framework has been chosen deliberately since any JavaScript logging framework would have required polyfills for the database, and these are additional overhead.

```sh
cd /tmp
tag_name=$(basename $(curl -fs -o/dev/null -w %{redirect_url} https://github.com/OraOpenSource/Logger/releases/latest))
curl -OL "https://github.com/OraOpenSource/Logger/raw/master/releases/logger_${tag_name}.zip"
unzip logger_${tag_name}.zip -d logger && rm logger_${tag_name}.zip

# use ADMIN for ADB-S, best combined with a saved connection
sql sys@localhost/freepdb1 as sysdba <<!

create user logger identified by "&savePassword";
alter user logger quota 1g on users;
grant connect,create view, create job, create table, create sequence, create trigger, create procedure, create any context, create public synonym to logger;

-- adjust for ADB-S!
conn logger/"&savePassword"@localhost/freepdb1
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

### Deploy the application

Make sure the `DEMOUSER` workspace exists. If not, refer to the instructions above to create it. Now, use SQLcl projects to deploy the application. Connect to the designated account and install the software:

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
