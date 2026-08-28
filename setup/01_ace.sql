alter session set container = freepdb1;

begin
    dbms_network_acl_admin.append_host_ace(
        host => 'public-api.wordpress.com',
        ace  =>  xs$ace_type(
            privilege_list => xs$name_list('http'),
            principal_name => 'demouser',
            principal_type => xs_acl.ptype_db
        )
    );
end;
/

commit;