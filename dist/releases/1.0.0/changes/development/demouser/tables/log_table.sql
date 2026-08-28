-- liquibase formatted sql
-- changeset DEMOUSER:1787927937057 stripComments:false  logicalFilePath:development/demouser/tables/log_table.sql
-- sqlcl_snapshot src/database/demouser/tables/log_table.sql:null:6cb38236fc5128ee46bb342ac6e8431172851f7a:create

create table demouser.log_table (
    id          number generated always as identity minvalue 1 maxvalue 9999999999999999999999999999 increment by 1 cache 20 noorder nocycle
    nokeep noscale not null enable,
    code_unit   varchar2(100 byte),
    log_level   varchar2(20 byte),
    post_id     number,
    log_message varchar2(4000 byte),
    log_time    timestamp(6) default current_timestamp,
    debug_info  json
);

alter table demouser.log_table
    add constraint pk_log_table primary key ( id )
        using index enable;

