alter session set container = freepdb1;

host mkdir -vp /opt/oracle/ai

create directory model_dir as '/opt/oracle/ai';

grant read, write on directory model_dir to demouser;