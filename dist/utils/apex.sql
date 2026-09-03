-- create an APEX workspace and application user
declare
    l_workspace_id  number;
    l_ws_name       varchar2(100) := 'DEMO_WS';
    l_user_name     varchar2(100) := 'MARTIN';
    l_schema_name   varchar2(100) := 'DEMOUSER';
begin
    if user != 'SYS' then
        raise_application_error(-20001, 'you must be SYS');
    end if;

    begin
        select
            to_char(workspace_id)
            into l_workspace_id
        from
            apex_workspaces
        where
            workspace = l_ws_name;
        
        dbms_output.put_line('Workspace ' || l_ws_name || ' exists, continuing');
    exception
        when no_data_found then

            apex_instance_admin.add_workspace (
                p_workspace      => l_ws_name,
                p_primary_schema => l_schema_name
            );

            -- if the workspace has newly been created its ID isn't known
            -- which would lead to errors in the next step
            l_workspace_id := apex_util.find_security_group_id(l_ws_name);

            dbms_output.put_line('workspace ' || l_ws_name || ' successfully created');
    end;

    commit;

    apex_util.set_security_group_id (
        p_security_group_id => l_workspace_id
    );
    
    if apex_util.is_username_unique(p_username => l_user_name) then
        apex_util.create_user(
            p_user_name                     => l_user_name,
            p_first_name                    => '',
            p_last_name                     => '',
            p_description                   => '',
            p_email_address                 => '',
            p_web_password                  => 'secret',
            p_developer_privs               => 'ADMIN:CREATE:DATA_LOADER:EDIT:HELP:MONITOR:SQL',
            p_default_schema                => l_schema_name,
            p_allow_access_to_schemas       => NULL,
            p_change_password_on_first_use  => 'Y');
        
        dbms_output.put_line('APEX user ' || l_user_name || ' successfully created');
    else
        dbms_output.put_line('User ' || l_user_name || ' already exists in workspace ' || l_ws_name);
    end if;

    commit;
end;
/