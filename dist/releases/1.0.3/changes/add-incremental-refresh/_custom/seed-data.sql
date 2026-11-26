-- liquibase formatted sql
-- changeset  SqlCl:1795723683931 stripComments:false logicalFilePath:add-incremental-refresh/_custom/seed-data.sql
-- sqlcl_snapshot dist/releases/next/changes/add-incremental-refresh/_custom/seed-data.sql:null:null:custom

insert into demouser.blog_refresh_state (id)
select 1
where not exists (
    select 1
    from demouser.blog_refresh_state
    where id = 1
);