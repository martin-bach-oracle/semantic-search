-- liquibase formatted sql
-- changeset DEMOUSER:1787927936782 stripComments:false  logicalFilePath:development/demouser/tables/blogpost_chunks.sql
-- sqlcl_snapshot src/database/demouser/tables/blogpost_chunks.sql:null:de1f070f6c27006cf9ef0439855ba5aa9c49aa43:create

create table demouser.blogpost_chunks (
    id              number generated always as identity minvalue 1 maxvalue 9999999999999999999999999999 increment by 1 cache 20 noorder
    nocycle nokeep noscale not null enable,
    post_id         number,
    chunk_id        number,
    chunk_data      varchar2(4000 byte),
    chunk_embedding vector
);

alter table demouser.blogpost_chunks
    add constraint pk_chunks primary key ( id )
        using index enable;

