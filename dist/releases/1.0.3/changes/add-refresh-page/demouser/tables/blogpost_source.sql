-- liquibase formatted sql
-- changeset DEMOUSER:1795513035355 stripComments:false  logicalFilePath:add-refresh-page/demouser/tables/blogpost_source.sql
-- sqlcl_snapshot src/database/demouser/tables/blogpost_source.sql:null:3ee4cdc388024c9301ff1ceab618027aa335c9d8:create

create table demouser.blogpost_source (
    id              number,
    title           varchar2(255 byte),
    link            varchar2(255 byte),
    published_at    date not null enable,
    source_modified date not null enable,
    is_present      varchar2(1 byte) default 'Y' not null enable,
    checked_at      timestamp(6) with time zone not null enable,
    last_error      varchar2(4000 byte)
);

-- changeset DEMOUSER:1795513035362 stripComments:false  logicalFilePath:add-refresh-page/demouser/tables/blogpost_source.sql
-- sqlcl_snapshot src/database/demouser/tables/blogpost_source.sql:null:58b66863522b24fa488b8cf6502045415f7169c0:create

alter table demouser.blogpost_source
    add constraint ck_blogpost_source_present
        check ( is_present in ( 'Y', 'N' ) ) enable;

-- changeset DEMOUSER:1795513035371 stripComments:false  logicalFilePath:add-refresh-page/demouser/tables/blogpost_source.sql
-- sqlcl_snapshot src/database/demouser/tables/blogpost_source.sql:null:9f138f664ad6532fe2cff5911ae5b1b5c26f069f:create

alter table demouser.blogpost_source add primary key ( id )
    using index enable;

