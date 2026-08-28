#!/usr/bin/env bash

#
# Deploy script to setup the environment and deploy the code to Oracle Database
# Does not cover the MCP server
#

set -euxo pipefail

[[ ! -f .env ]] && {
    echo ".env file not found. Please create one with the required environment variables (-> readme.md)"
    exit 1;
}

source .env

CONTAINER_RUNTIME=undefined
command -v podman && CONTAINER_RUNTIME=podman
command -v docker && CONTAINER_RUNTIME=docker

if [[ CONTAINER_RUNTIME == undefined ]]; then
    echo "ERR: neither docker nor podman found, exiting"
    exit 1
fi

if ! command -v sql; then
    echo ERR: SQLcl not found in your path, exiting
    exit 1
else
    SQLCL=$(command -v sql)
fi

#
# Download the ONNX model and copy it to the container
#
function init() {

    [[ ! -d model ]] && mkdir model

    # model file not found. Initiating download from the object storage bucket.
    # see https://docs.oracle.com/en/database/oracle/oracle-database/26/vecse/sql-quick-start-using-vector-embedding-model-uploaded-database.html
    # for details on the model
    
    curl -Lo model/all_MiniLM_L12_v2_augmented.zip \
        https://adwc4pm.objectstorage.us-ashburn-1.oci.customer-oci.com/p/TtH6hL2y25EypZ0-rrczRZ1aXp7v1ONbRBfCiT-BDBN8WLKQ3lgyW6RxCfIFLdA6/n/adwc4pm/b/OML-ai-models/o/all_MiniLM_L12_v2_augmented.zip


    unzip -q model/all_MiniLM_L12_v2_augmented.zip -d model || {
        echo "Failed to unzip the model file."
        exit 1;
    }

    # copying extracted model to container
    "${CONTAINER_RUNTIME}" exec -it semantic-search-oracle-1 mkdir -p /opt/oracle/ai
    "${CONTAINER_RUNTIME}" cp model/all_MiniLM_L12_v2.onnx semantic-search-oracle-1:/opt/oracle/ai

}

#
# MAIN
#

[[ ! -f model/all_MiniLM_L12_v2_augmented.zip ]] && init

[[ -z "${APP_USER_PASSWORD}" ]] && { 
    echo "APP_USER_PASSWORD is not set in the .env file, yet it should have been ... please check!" 
    exit 1;
}

# simulate a build by bundling the JavaScript code into a single file and injecting it into the database
# load the doc model into demouser's schema
npx esbuild src/javascript/fetchPosts.js --bundle --outfile=build/bundle.js --format=esm --external:"mle-js-fetch" && \
{
    echo whenever sqlerror exit 1
    echo mle create-module -filename build/bundle.js -module-name bundle_module -replace

    echo "exec dbms_vector.drop_onnx_model (model_name => 'DOC_MODEL', force => true);"
    echo "exec dbms_vector.load_onnx_model (directory => 'MODEL_DIR', file_name  => 'all_MiniLM_L12_v2.onnx', model_name => 'doc_model');"
    echo commit;
} | ${SQLCL} demouser/"${APP_USER_PASSWORD}"@localhost/freepdb1