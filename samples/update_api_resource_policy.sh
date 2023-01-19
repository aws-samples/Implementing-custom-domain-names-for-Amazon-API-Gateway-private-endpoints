#!/bin/bash
set -euo pipefail

USAGE="
Usage: $0 --private_api_id <private_api_id> --private_api_stage_name <private_api_stage_name> [optional args]

args:
--private_api_id <private_api_id>
--private_api_stage_name <private_api_stage_name>

optional args:
  --aws_profile
  --aws_region
  --output_file_path
"

# Set global vars
DEFAULT_OUTPUT_FILE_PATH="./outputs/outputs.json"

if [ $# -lt 1 ]; then
	echo "$USAGE"
else
	# Set Execution values from Args
	while [ $# -gt 0 ]; do
		case "${1}" in
		--private_api_id) # Private API Id
			API_ID="${2}"
			;;
		--private_api_stage_name) # API Stage
			API_STAGE_NAME="${2}"
			;;
		--aws_profile)
			AWS_PROFILE="${2}"
			;;
		--aws_region)
			AWS_REGION="${2}"
			;;
		--output_file_path) # Optional outputs file path, default is -/outputs/outputs.json
			OUTPUT_FILE_PATH="${2}"
			;;
		\?) # Invalid option
			echo "Invalid option ${1} ${2} passed."
			echo "$USAGE"
            exit 1
			;;
		esac
		shift
	done
fi

OUTPUT_FILE_PATH="${OUTPUT_FILE_PATH:=$DEFAULT_OUTPUT_FILE_PATH}"

function set_aws_credentials() {
	PS3="Select AWS authentication mechanism: "
	select choice in 'Access Keys' 'AWS CLI Profile'; do
		case ${choice} in
		"Access Keys")
			echo -n "Enter AWS_ACCESS_KEY_ID: "
			read -r AWS_ACCESS_KEY_ID
			export AWS_ACCESS_KEY_ID
			echo -n "Enter AWS_SECRET_ACCESS_KEY: "
			read -r AWS_SECRET_ACCESS_KEY
			export AWS_SECRET_ACCESS_KEY
			break
			;;
		"AWS CLI Profile")
			profiles=$(aws configure list-profiles)
			select AWS_PROFILE in ${profiles}; do
				break
			done
			export AWS_PROFILE
			break
			;;
		esac
	done
	unset PS3

	regions="$(aws ec2 describe-regions --region us-east-1 --query 'Regions[].RegionName' --output text 2>/dev/null)"

	PS3="Select deployment region: "
	select AWS_REGION in ${regions}; do
		export AWS_REGION
		break
	done
	unset PS3
}

export AWS_PROFILE=${AWS_PROFILE:-}
export AWS_REGION=${AWS_REGION:-}
export AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:-}
export AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:-}
export OUTPUT_FILE_PATH="${PWD}/${OUTPUT_FILE_PATH}"
if ! aws sts get-caller-identity; then
	echo "AWS credentials not set in environment or incorrect, redirecting to provide credentials."
	set_aws_credentials
fi

POLICY_STMT=$(jq .API_RESOURCE_POLICY_MAPPING."${API_ID}" "$OUTPUT_FILE_PATH" | jq -c . | jq tojson) || POLICY_STMT=""

if [ -z "$POLICY_STMT" ]; then
	echo "Either provided private api id (${API_ID}) is not correct or there is an error parsing the outputs file from location $OUTPUT_FILE_PATH "
	exit 1
else
	POLICY="[{\"op\": \"replace\", \"path\": \"/policy\", \"value\": ${POLICY_STMT} }]"

	echo -e "\nUpdating Resource Policy on Private API with Id ${API_ID} \n"
	aws apigateway update-rest-api \
		--rest-api-id "$API_ID" \
		--patch-operations "$POLICY"

	echo -e "\nDeploying Private API with Id ${API_ID} \n"
	aws apigateway create-deployment \
		--rest-api-id "$API_ID" \
		--stage-name "$API_STAGE_NAME"
fi

exit 0
