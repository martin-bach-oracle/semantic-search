-- liquibase formatted sql
-- changeset DEMOUSER:1787927936802 stripComments:false  logicalFilePath:development/demouser/tables/blogposts.sql
-- sqlcl_snapshot src/database/demouser/tables/blogposts.sql:null:238a0e74633a35bba13436fab1fb890fe27d5932:create

create table demouser.blogposts (
    id      number,
    slug    varchar2(255 byte),
    link    varchar2(255 byte),
    created date,
    content clob,
    title   varchar2(255 byte)
);

alter table demouser.blogposts
    add constraint pk_blogposts primary key ( id )
        using index enable;

