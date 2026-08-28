-- liquibase formatted sql
-- changeset DEMOUSER:1787927936738 stripComments:false  logicalFilePath:development/demouser/package_specs/blog_posts_package.sql
-- sqlcl_snapshot src/database/demouser/package_specs/blog_posts_package.sql:null:1a445e6814ad3251651dfb8e6ccb45b830fa83ab:create

create or replace package demouser.blog_posts_package as
    function fetchallposts return json as
        mle module bundle_module signature 'fetchAllPosts';
    function fetchsinglepost (
        p_id number
    ) return json as
        mle module bundle_module signature 'fetchSinglePost';
    procedure refreshblogposts as
        mle module bundle_module signature 'refreshBlogposts';
end;
/

