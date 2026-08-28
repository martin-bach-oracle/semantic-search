alter session set container = freepdb1;

create directory model_dir as '/opt/oracle/ai';

grant read, write on directory model_dir to demouser;