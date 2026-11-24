-- liquibase formatted sql
-- changeset DEMOUSER:1795513035350 stripComments:false  logicalFilePath:add-refresh-page/demouser/tables/dbtools$execution_history.sql
-- sqlcl_snapshot src/database/demouser/tables/dbtools$execution_history.sql:null:84760672ad11d3908f3544ece70a9993ccca0bea:create

create table demouser.dbtools$execution_history (
    id         number not null enable,
    hash       clob,
    created_by varchar2(255 byte),
    created_on timestamp(6) with time zone,
    updated_by varchar2(255 byte),
    updated_on timestamp(6) with time zone,
    statement  clob,
    times      number
);

-- changeset DEMOUSER:1795513035364 stripComments:false  logicalFilePath:add-refresh-page/demouser/tables/dbtools$execution_history.sql
-- sqlcl_snapshot src/database/demouser/tables/dbtools$execution_history.sql:null:19420d27cb1ab6a97d946437e77539e011c0e441:create

alter table demouser.dbtools$execution_history
    add constraint dbtools$execution_history_pk primary key ( id )
        using index enable;

