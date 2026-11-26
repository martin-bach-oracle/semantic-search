-- liquibase formatted sql
-- changeset DEMOUSER:1795517464537 stripComments:false  logicalFilePath:add-incremental-refresh/demouser/tables/blog_refresh_state.sql
-- sqlcl_snapshot src/database/demouser/tables/blog_refresh_state.sql:null:f745b132da8914de4b4e9dbec3d04f8e02b5575d:create

create table demouser.blog_refresh_state (
    id                number,
    last_checked_at   timestamp(6) with time zone,
    last_refreshed_at timestamp(6) with time zone,
    refreshed_posts   number,
    failed_posts      number,
    generated_chunks  number
);

-- changeset DEMOUSER:1795517464551 stripComments:false  logicalFilePath:add-incremental-refresh/demouser/tables/blog_refresh_state.sql
-- sqlcl_snapshot src/database/demouser/tables/blog_refresh_state.sql:null:40df0cfe7e96799e7759f7863f7dcd19d5daa247:create

alter table demouser.blog_refresh_state add constraint ck_blog_refresh_singleton check ( id = 1 ) enable;

-- changeset DEMOUSER:1795517464558 stripComments:false  logicalFilePath:add-incremental-refresh/demouser/tables/blog_refresh_state.sql
-- sqlcl_snapshot src/database/demouser/tables/blog_refresh_state.sql:null:9c999445ae57ff758c03aff82a3fbf76b1eabc1c:create

alter table demouser.blog_refresh_state add primary key ( id )
    using index enable;

