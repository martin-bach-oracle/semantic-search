-- liquibase formatted sql
-- changeset DEMOUSER:1795513036727 stripComments:false  logicalFilePath:ords/demouser/ords.sql
-- sqlcl_snapshot {"hash":"accbc04fe39512b76d49c0fd9894b04d05697ad5","type":"ORDS_SCHEMA","name":"ords","schemaName":"DEMOUSER","sxml":""}
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


