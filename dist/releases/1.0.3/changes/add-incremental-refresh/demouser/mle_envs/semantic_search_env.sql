-- liquibase formatted sql
-- changeset DEMOUSER:1795723486852 stripComments:false  logicalFilePath:development/demouser/mle_envs/semantic_search_env.sql
-- sqlcl_snapshot src/database/demouser/mle_envs/semantic_search_env.sql:null:c18350c856ff025500cc8413909d1eae43e2c34b:create

create or replace mle env demouser.semantic_search_env imports ( 'blog_posts' module demouser.bundle_module, 'ords' module demouser.ords_module);

