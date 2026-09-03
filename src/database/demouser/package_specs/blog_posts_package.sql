create or replace package demouser.blog_posts_package as
    procedure refreshblogposts as
        mle module bundle_module signature 'refreshBlogposts';
end;
/


-- sqlcl_snapshot {"hash":"2c5dacba73217b5fe99495c0ae9da6da28b0ff18","type":"PACKAGE_SPEC","name":"BLOG_POSTS_PACKAGE","schemaName":"DEMOUSER","sxml":""}