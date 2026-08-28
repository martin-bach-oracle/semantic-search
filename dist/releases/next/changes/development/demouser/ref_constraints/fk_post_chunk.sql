-- liquibase formatted sql
-- changeset DEMOUSER:1787927936766 stripComments:false  logicalFilePath:development/demouser/ref_constraints/fk_post_chunk.sql
-- sqlcl_snapshot src/database/demouser/ref_constraints/fk_post_chunk.sql:null:e41bd5723be1742f4a09ed55bb32a3d2b2f62446:create

alter table demouser.blogpost_chunks
    add constraint fk_post_chunk
        foreign key ( post_id )
            references demouser.blogposts ( id )
        enable;

