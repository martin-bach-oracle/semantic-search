
  CREATE OR REPLACE MLE MODULE "DEMOUSER"."ORDS_MODULE" 
   LANGUAGE JAVASCRIPT AS 
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


-- sqlcl_snapshot {"hash":"f72726ccdf7679af7474574f0f37a5b2170ef74c","type":"MLE_MODULE","name":"ORDS_MODULE","schemaName":"DEMOUSER","sxml":""}