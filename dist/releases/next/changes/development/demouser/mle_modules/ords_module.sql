-- liquibase formatted sql
-- changeset DEMOUSER:1787927937002 stripComments:false  logicalFilePath:development/demouser/mle_modules/ords_module.sql
-- sqlcl_snapshot src/database/demouser/mle_modules/ords_module.sql:null:650601179fab5e1ba33bad071f0ed67e6af4132b:create

create or replace mle module demouser.ords_module language javascript as
    export function semanticSearch(searchTerm, limit = 5) {

    if (typeof searchTerm !== 'string' || searchTerm === undefined || searchTerm === null) {
        throw new Error('searchTerm must be a non-null string');
    }

    const result = session.execute(
        `select
            link,
            title
        from
            blogpost_search_source
        order by
            vector_distance(chunk_embedding , vector_embedding(doc_model using :searchTerm as data), cosine) 
        fetch first :limit rows only`,
        [ searchTerm, limit ],
        {
            fetchTypeHandler: function (metaData) {
                metaData.name = metaData.name.toLowerCase();
            }
        }
    );

    return result.rows;
}
/

