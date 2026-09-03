-- liquibase formatted sql
-- changeset DEMOUSER:1788461261839 stripComments:false  logicalFilePath:handle-refresh/demouser/tables/blogpost_chunks.sql
-- sqlcl_snapshot src/database/demouser/tables/blogpost_chunks.sql:5841912435bd24ce6706084d99ea07ae8be00683:ac5dc925d0d307fd54bf856ce36e4ea6c862788a:alter

alter table demouser.blogpost_chunks modify (
    post_id not null enable
)
/

alter table demouser.blogpost_chunks modify (
    chunk_id not null enable
)
/

alter table demouser.blogpost_chunks modify (
    chunk_data not null enable
)
/

alter table demouser.blogpost_chunks
    add constraint uk_blogpost_chunks unique ( post_id,
                                               chunk_id )
        using index enable
/

