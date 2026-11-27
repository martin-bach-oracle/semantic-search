#!/usr/bin/env bash

#
# Load the embedding model as DEMOUSER.DOC_MODEL in the local database.
# Requires the MODEL_DIR directory and grants from setup/02_ai_model.sql.
#
# Usage: bash deploy-local.sh [database-container-name]
#
# Replaces an existing DOC_MODEL. Does not deploy application code or schema DDL.
#

set -euo pipefail

# --- Globals
MODEL_DIR=./model
MODEL_FILE="${MODEL_DIR}/all_MiniLM_L12_v2_augmented.zip"
CONTAINER_NAME=${1:-semantic-search-oracle-1}

## --- sanity checks
[[ ! -f .env ]] && {
    echo ".env file not found. Please create one with the required environment variables (-> readme.md)"
    exit 1;
}

source .env

CONTAINER_RUNTIME=undefined
command -v podman && CONTAINER_RUNTIME=podman
command -v docker && CONTAINER_RUNTIME=docker

if [[ "${CONTAINER_RUNTIME}" == undefined ]]; then
    echo "ERR: neither docker nor podman found, exiting"
    exit 1
fi

if [ "$("${CONTAINER_RUNTIME}" inspect -f '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null)" != "true" ]; then
  echo "ERR: DB container ${CONTAINER_NAME} is NOT running, exiting"
  exit 1
fi

if ! command -v sql; then
    echo ERR: SQLcl not found in your path, exiting
    exit 1
else
    SQLCL=$(command -v sql)
fi

#
# Download the ONNX model and copy it to the container unless it exists
#

if ! "${CONTAINER_RUNTIME}" exec "${CONTAINER_NAME}" test -f /opt/oracle/ai/all_MiniLM_L12_v2.onnx; then

    [[ ! -d "${MODEL_DIR}" ]] && mkdir -vp "${MODEL_DIR}"
    if [[ ! -f "${MODEL_DIR}/all_MiniLM_L12_v2.onnx" ]]; then
      if [[ ! -f "${MODEL_FILE}" ]]; then

        # model file not found. Initiating download from the object storage bucket.
        # see https://docs.oracle.com/en/database/oracle/oracle-database/26/vecse/sql-quick-start-using-vector-embedding-model-uploaded-database.html
        # for details on the model
        
        curl -fLo "${MODEL_FILE}" \
            https://adwc4pm.objectstorage.us-ashburn-1.oci.customer-oci.com/p/TtH6hL2y25EypZ0-rrczRZ1aXp7v1ONbRBfCiT-BDBN8WLKQ3lgyW6RxCfIFLdA6/n/adwc4pm/b/OML-ai-models/o/all_MiniLM_L12_v2_augmented.zip

      fi

      unzip -q "${MODEL_FILE}" -d "${MODEL_DIR}" || {
            echo "Failed to unzip the model file."
            exit 1;
        }
    fi

    # copy extracted ONNX model to container and make sure oracle can read it
    "${CONTAINER_RUNTIME}" exec "${CONTAINER_NAME}" mkdir -p /opt/oracle/ai
    "${CONTAINER_RUNTIME}" cp "${MODEL_DIR}/all_MiniLM_L12_v2.onnx" "${CONTAINER_NAME}":/opt/oracle/ai
    "${CONTAINER_RUNTIME}" exec --user root "${CONTAINER_NAME}" chown 54321:54321 /opt/oracle/ai/all_MiniLM_L12_v2.onnx

fi

#
# MAIN
#

[[ -z "${APP_USER_PASSWORD:-}" ]] && {
    echo "APP_USER_PASSWORD is not set in the .env file, yet it should have been ... please check!" 
    exit 1;
}

# Load the model only; JavaScript modules and releases are deployed separately.
{
    echo whenever oserror exit 1
    echo whenever sqlerror exit 1

    echo "exec dbms_vector.drop_onnx_model (model_name => 'DOC_MODEL', force => true);"
    echo "exec dbms_vector.load_onnx_model (directory => 'MODEL_DIR', file_name  => 'all_MiniLM_L12_v2.onnx', model_name => 'doc_model');"
    echo commit;
    echo exit
} | "${SQLCL}" "demouser/\"${APP_USER_PASSWORD}\"@localhost/freepdb1"
