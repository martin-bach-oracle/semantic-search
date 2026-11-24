-- liquibase formatted sql
-- changeset DEMOUSER:1795513036431 stripComments:false  logicalFilePath:add-refresh-page/demouser/tables/blogposts.sql
-- sqlcl_snapshot src/database/demouser/tables/blogposts.sql:c2e26b4d2e3e544251064865d1afc07ed8cc52bc:42de6cce40c4693571c4e6ee794ab2705601c4d5:alter

alter table demouser.blogposts add (
    indexed_at timestamp(6) with time zone
)
/

-- changeset DEMOUSER:1795513036434 stripComments:false  logicalFilePath:add-refresh-page/demouser/tables/blogposts.sql
-- sqlcl_snapshot src/database/demouser/tables/blogposts.sql:c2e26b4d2e3e544251064865d1afc07ed8cc52bc:2943166df57fd9e22cc338d95d2f7d9a08b319cf:alter

alter table demouser.blogposts add (
    indexed_chunk_count number
)
/

