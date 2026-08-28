-- liquibase formatted sql
-- changeset DEMOUSER:1787927936749 stripComments:false  logicalFilePath:development/demouser/mle_envs/semantic_search_env.sql
-- sqlcl_snapshot src/database/demouser/mle_envs/semantic_search_env.sql:null:d2a37c184b75cde576e9674343a44392338eb729:create

create or replace mle env demouser.semantic_search_env imports ( 'ords' module demouser.ords_module );

