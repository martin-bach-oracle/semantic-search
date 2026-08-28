-- liquibase formatted sql
-- changeset DEMOUSER:1787927938531 stripComments:false  logicalFilePath:ords/demouser/ords.sql
-- sqlcl_snapshot {"hash":"1cfd0bd80669a05a59d6ce23eab3e0d37a256cb7","type":"ORDS_SCHEMA","name":"ords","schemaName":"DEMOUSER","sxml":""}
--
        
DECLARE

  l_roles     OWA.VC_ARR;
  l_modules   OWA.VC_ARR;
  l_patterns  OWA.VC_ARR;

BEGIN
  ORDS.ENABLE_SCHEMA(
      p_enabled             => TRUE,
      p_url_mapping_type    => 'BASE_PATH',
      p_url_mapping_pattern => 'demouser',
      p_auto_rest_auth      => FALSE);

  ORDS.DEFINE_MODULE(
      p_module_name    => 'semantic_search_module',
      p_base_path      => '/api/',
      p_items_per_page => 25,
      p_status         => 'PUBLISHED',
      p_comments       => 'Semantic search');

  ORDS.DEFINE_TEMPLATE(
      p_module_name    => 'semantic_search_module',
      p_pattern        => 'search/:searchTerm',
      p_priority       => 0,
      p_etag_type      => 'HASH',
      p_etag_query     => NULL,
      p_comments       => 'search  template');

  ORDS.DEFINE_HANDLER(
      p_module_name    => 'semantic_search_module',
      p_pattern        => 'search/:searchTerm',
      p_method         => 'GET',
      p_source_type    => 'mle/javascript',
      p_items_per_page => 0,
      p_mimes_allowed  => NULL,
      p_comments       => NULL,
      p_mle_env_name => 'SEMANTIC_SEARCH_ENV',
      p_source         => 
'
(req, resp) => {

    // import semanticSearch() from ords_module by means of the module''s import name
    // as defined in the MLE environment SEMANTIC_SEARCH_ENV
    const { semanticSearch } = await import (''ords'');

    // not necessary since you cannot call this particular handler without a
    // question but it''s always good to test for unexpected behaviour
    if (req.uri_parameters.searchTerm === undefined) {
        resp.status(400);
    } else {

        const data = semanticSearch(req.uri_parameters.searchTerm);

        resp.content_type(''application/json'');
        resp.json(data);
    }
}    
    ');

  ORDS.CREATE_ROLE(
      p_role_name=> 'oracle.dbtools.role.autorest.DEMOUSER');
  ORDS.CREATE_ROLE(
      p_role_name=> 'oracle.dbtools.role.autorest.any.DEMOUSER');
  l_roles(1) := 'oracle.dbtools.auth.roles.builtin.VecDB';

  ORDS.DEFINE_PRIVILEGE(
      p_privilege_name => 'oracle.dbtools.auth.privileges.builtin.VecDB',
      p_roles          => l_roles,
      p_patterns       => l_patterns,
      p_modules        => l_modules,
      p_label          => NULL,
      p_description    => NULL,
      p_comments       => NULL); 

  l_roles.DELETE;
  l_modules.DELETE;
  l_patterns.DELETE;

  l_roles(1) := 'oracle.dbtools.autorest.any.schema';
  l_roles(2) := 'oracle.dbtools.role.autorest.DEMOUSER';

  ORDS.DEFINE_PRIVILEGE(
      p_privilege_name => 'oracle.dbtools.autorest.privilege.DEMOUSER',
      p_roles          => l_roles,
      p_patterns       => l_patterns,
      p_modules        => l_modules,
      p_label          => 'DEMOUSER metadata-catalog access',
      p_description    => 'Provides access to the metadata catalog of the objects in the DEMOUSER schema.',
      p_comments       => NULL); 

  l_roles.DELETE;
  l_modules.DELETE;
  l_patterns.DELETE;

  l_roles(1) := 'SODA Developer';
  l_patterns(1) := '/soda/*';

  ORDS.DEFINE_PRIVILEGE(
      p_privilege_name => 'oracle.soda.privilege.developer',
      p_roles          => l_roles,
      p_patterns       => l_patterns,
      p_modules        => l_modules,
      p_label          => NULL,
      p_description    => NULL,
      p_comments       => NULL); 

  l_roles.DELETE;
  l_modules.DELETE;
  l_patterns.DELETE;

  ORDS.FINALIZE_IMPORT(
      p_prune => FALSE,
      p_objects => null);

COMMIT;
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    RAISE;

END;
/


