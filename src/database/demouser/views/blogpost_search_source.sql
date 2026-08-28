create or replace force editionable view demouser.blogpost_search_source (
    link,
    title,
    post_id,
    chunk_id,
    chunk_data,
    chunk_embedding
) as
    select
        p.link,
        p.title,
        p.id as post_id,
        bpc.chunk_id,
        bpc.chunk_data,
        bpc.chunk_embedding
    from
             blogposts p
        join blogpost_chunks bpc on p.id = bpc.post_id;


-- sqlcl_snapshot {"hash":"65e38703e1277760e6f64b4c8603db64340582bf","type":"VIEW","name":"BLOGPOST_SEARCH_SOURCE","schemaName":"DEMOUSER","sxml":""}