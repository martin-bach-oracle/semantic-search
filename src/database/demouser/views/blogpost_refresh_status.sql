create or replace force editionable view demouser.blogpost_refresh_status (
    id,
    title,
    link,
    published_at,
    indexed_modified,
    source_modified,
    indexed_at,
    indexed_chunk_count,
    chunk_count,
    embedded_chunk_count,
    is_present,
    checked_at,
    last_error,
    status,
    refresh_suggested
) as
    with chunk_counts as (
        select
            post_id,
            count(*) chunk_count,
            count(
                case
                    when chunk_embedding is not null then
                        1
                end
            )        embedded_chunk_count
        from
            blogpost_chunks
        group by
            post_id
    ), post_status as (
        select
            coalesce(p.id, s.id)                id,
            coalesce(s.title, p.title)          title,
            coalesce(s.link, p.link)            link,
            coalesce(s.published_at, p.created) published_at,
            p.modified                          indexed_modified,
            s.source_modified,
            p.indexed_at,
            p.indexed_chunk_count,
            nvl(c.chunk_count, 0)               chunk_count,
            nvl(c.embedded_chunk_count, 0)      embedded_chunk_count,
            coalesce(s.is_present,
                     case
                         when r.last_checked_at is not null then
                             'N'
                     end
            )                                   is_present,
            s.checked_at,
            s.last_error,
            case
                when s.is_present = 'N'
                     or ( s.id is null
                          and r.last_checked_at is not null ) then
                    'Missing from source'
                when s.last_error is not null then
                    'Failed'
                when p.id is null then
                    'New'
                when s.id is null
                     or p.modified is null
                     or p.indexed_at is null
                     or p.indexed_chunk_count is null then
                    'Unknown'
                when p.modified <> s.source_modified then
                    'Changed'
                when nvl(c.chunk_count, 0) = 0
                     or c.chunk_count <> p.indexed_chunk_count
                     or c.embedded_chunk_count <> c.chunk_count then
                    'Missing chunks'
                else
                    'Current'
            end                                 status
        from
            blogposts          p
            full outer join blogpost_source    s on s.id = p.id
            left join chunk_counts       c on c.post_id = p.id
            cross join blog_refresh_state r
        where
            r.id = 1
    )
    select
        post_status.id,
        post_status.title,
        post_status.link,
        post_status.published_at,
        post_status.indexed_modified,
        post_status.source_modified,
        post_status.indexed_at,
        post_status.indexed_chunk_count,
        post_status.chunk_count,
        post_status.embedded_chunk_count,
        post_status.is_present,
        post_status.checked_at,
        post_status.last_error,
        post_status.status,
        case
            when status in ( 'New', 'Changed', 'Missing chunks', 'Unknown', 'Failed' )
                 and is_present = 'Y' then
                'Y'
            else
                'N'
        end refresh_suggested
    from
        post_status;


-- sqlcl_snapshot {"hash":"5f42128c3c34ffd37bad3fb5a10caf8e3cd5a496","type":"VIEW","name":"BLOGPOST_REFRESH_STATUS","schemaName":"DEMOUSER","sxml":""}