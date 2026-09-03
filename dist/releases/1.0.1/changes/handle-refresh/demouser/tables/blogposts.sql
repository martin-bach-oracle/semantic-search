-- liquibase formatted sql
-- changeset DEMOUSER:1788461261842 stripComments:false  logicalFilePath:handle-refresh/demouser/tables/blogposts.sql
-- sqlcl_snapshot src/database/demouser/tables/blogposts.sql:bd6f57c11168376ccccbe82d530ded04ef5fdfcf:45f63761c8af270cb492af280e7594fcdf07157b:alter

alter table demouser.blogposts add (
    modified date
)
/

