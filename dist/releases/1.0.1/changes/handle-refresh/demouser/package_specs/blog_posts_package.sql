-- liquibase formatted sql
-- changeset DEMOUSER:1788461261236 stripComments:false  logicalFilePath:handle-refresh/demouser/package_specs/blog_posts_package.sql
-- sqlcl_snapshot src/database/demouser/package_specs/blog_posts_package.sql:1a445e6814ad3251651dfb8e6ccb45b830fa83ab:2c5dacba73217b5fe99495c0ae9da6da28b0ff18:alter

create or replace package demouser.blog_posts_package as
    procedure refreshblogposts as
        mle module bundle_module signature 'refreshBlogposts';
end;
/

