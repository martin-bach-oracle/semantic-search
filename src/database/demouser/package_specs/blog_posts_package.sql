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


-- sqlcl_snapshot {"hash":"1a445e6814ad3251651dfb8e6ccb45b830fa83ab","type":"PACKAGE_SPEC","name":"BLOG_POSTS_PACKAGE","schemaName":"DEMOUSER","sxml":""}