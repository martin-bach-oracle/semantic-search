alter table demouser.blogpost_chunks
    add constraint fk_post_chunk
        foreign key ( post_id )
            references demouser.blogposts ( id )
        enable;


-- sqlcl_snapshot {"hash":"e41bd5723be1742f4a09ed55bb32a3d2b2f62446","type":"REF_CONSTRAINT","name":"FK_POST_CHUNK","schemaName":"DEMOUSER","sxml":""}