#!/bin/bash
set -euo pipefail

USAGE="
Usage: $0 --tool <tool> --action <action> [optional args]

available tools:
  cdk                AWS CLoud Deployment Kit
  terraform          Hashicorp Terraform

available actions(CDK):
  deploy             Deploy or update resources
  synth|synthesize   Synthesize deployment plan
  diff               Compare deployed configuration to local configuration
  destroy            Destroy all resources

available actions(terraform)
  apply              Deploy or update resources
  plan               Create deployment plan
  destroy            Destroy all resources

optional args:
  --vars <path to variables file [defaults to ./config/proxy-config.yaml]>
  --proxyconf <path to proxy-config.yaml [defaults to ./config/proxy-config.yaml]>
  --auto-approve <add this arg to auto-approve terraform apply or destroy>
  --configure-backend (local|remote) <add this arg to configure terraform state location [defaults to local]>
"

# Set global vars
src_dir="${PWD}"
outputs_dir="${src_dir}/outputs"
mkdir -p "${outputs_dir}"

# Set Execution values from Args
while [ $# -gt 0 ]; do
	case "${1}" in
	--vars) # Use provided environment file.
		var_file="${2}"
		;;
	--proxyconf) # Use provided proxy configuration
		export PROXY_CONFIG_PATH="${2}"
		;;
	--tool)
		case "${2}" in
		cdk | terraform)
			execution_tool="${2}"
			;;
		*)
			echo "Invalid execution tool: ${USAGE}"
			exit 1
			;;
		esac
		;;
	--action)
		case "${2}" in
		deploy | apply | synth | synthesize | plan | destroy | diff)
			action="${2}"
			;;
		*)
			echo "Invalid execution action: ${USAGE}"
			exit 1
			;;
		esac
		;;
	--auto-approve)
		tf_args="--auto-approve"
		cdk_args="--require-approval never"
		;;
	--configure-backend)
		backend_type=${2:-local}
		backend_file="${src_dir}/terraform/backend.tf"
		case "${backend_type}" in
		local)
			cat <<EOF >"${backend_file}"
EOF
			if [ -z "${action}" ]; then
				echo "Local backend configured."
				exit 0
			fi
			;;
		remote)
			echo "Checking for existing backend configuration..."
			current_bucket=$(grep -E "^.*bucket.*=.*$" terraform/backend.tf | awk '{print$3}' | tr -d '"') || true
			current_prefix=$(grep -E "^.*key.*=.*$" terraform/backend.tf | awk '{print$3}' | tr -d '"') || true
			current_region=$(grep -E "^.*region.*=.*$" terraform/backend.tf | awk '{print$3}' | tr -d '"') || true
			current_table=$(grep -E "^.*dynamodb_table.*=.*$" terraform/backend.tf | awk '{print$3}' | tr -d '"') || true
			echo "Configuring S3 Backend..."
			read -rp "Bucket Name [${current_bucket:-null}]: " state_bucket
			state_bucket=${state_bucket:-${current_bucket:-null}}
			read -rp "Object Key Prefix [${current_prefix:-null}]: " object_prefix
			object_prefix=${object_prefix:-${current_prefix:-null}}
			read -rp "Bucket Region [${current_region:-${AWS_REGION:-null}}]: " bucket_region
			bucket_region=${bucket_region:-${current_region:-${AWS_REGION:-null}}}
			echo "Validating backend configuration..."
			if ! aws s3 ls "s3://${state_bucket}" --region "${bucket_region}" &>/dev/null; then
				echo "Invalid bucket configuration, please see https://developer.hashicorp.com/terraform/language/settings/backends/s3 for details."
				exit 1
			fi
			read -rp "Configure DynamoDB state locking (Y|n): " config_ddb
			config_ddb=${config_ddb:-Y}
			if echo "${config_ddb}" | grep -E "^(y|Y).*$"; then
				read -rp "Table Name [${current_table:-null}]: " ddb_table
				ddb_table=${ddb_table:-${current_table}}
				if ! [ "$(aws dynamodb describe-table --table-name "${ddb_table}" --query "Table.KeySchema[?KeyType=='HASH'].AttributeName" --output text 2>/dev/null)" == "LockID" ]; then
					echo "Invalid dynamodb table configuration (partition key must be 'LockID'), please see https://developer.hashicorp.com/terraform/language/settings/backends/s3 for details."
					exit 1
				fi
			fi
			cat <<EOF >"${backend_file}"
terraform {
    backend "s3" {
        bucket = "${state_bucket}"
        key    = "${object_prefix}"
        region = "${bucket_region}"
        dynamodb_table = "${ddb_table:-null}"
    }
}
EOF
			if [ -z "${action}" ]; then
				echo "Local backend configured."
				exit 0
			fi
			;;
		*)
			echo "Invalid backend, supported values are local and remote"
			exit 1
			;;
		esac
		;;
	--*) # Invalid option
		echo "Passing unrecognized argument to execution tool ${1} ${2}"
		downstream_args=${downstream_args:-}
		downstream_args+=" ${1} ${2}"
		;;
	esac
	shift
done

# Check for execution tool and action
execution_tool=${execution_tool:-}
action=${action:-}
if [ -z "${execution_tool}" ]; then
	echo "ERROR: No execution tool specified. ${USAGE}"
	exit 1
fi
if [ -z "${action}" ]; then
	echo "ERROR: No action specified. ${USAGE}"
	exit 1
fi

# Source Variables File
default_var_file="${src_dir}/config/vars-template.yaml"
var_file=${var_file:-./config/vars.yaml}
var_file="${src_dir}/${var_file}"
if ! [ -f "${var_file}" ]; then
	cat <<EOF
INFO: No --vars argument provided and no vars.yaml found.
Place a valid vars.yaml file in ${PWD}/config
A default vars file has been provided and will be used for this execution
EOF
	var_file="${default_var_file}"
fi

# Export variables from vars file
# Ensure source file is POSIX compatible for line reads
if ! tail -1 "${var_file}" | grep -E '^$'; then
	echo >>"${var_file}"
fi

tmp_var_file="${PWD}/.tmp.vars"
echo >"${tmp_var_file}"
sed -E 's/^(.*VARIABLES:.*| *| *- *|.*---.*)//g;/^$/d;s/: */=/g' "${var_file}" | while read -r line; do
	if [[ $line =~ ^EXTERNAL_PRIVATE_SUBNETS_ID.? ]]; then
		echo "${line}" | tr -d "'" | awk -F= '{print $1"='\''"$2"'\''"}' >>"${tmp_var_file}"
	else
		echo "${line}" | tr -d "'" | awk -F= '{print $1"=\""$2"\""}' >>"${tmp_var_file}"
	fi
done

# shellcheck source=/dev/null # Dynamic file built inline
set -a && source "${tmp_var_file}" && set +a && rm "${tmp_var_file}"

function set_aws_credentials() {
	PS3="Select AWS authentication mechanism: "
	select choice in 'Access Keys' 'AWS CLI Profile'; do
		case "${choice}" in
		"Access Keys")
			AWS_PROFILE="${APP_NAME}_${APP_ENVIRONMENT}" && export AWS_PROFILE
			AWS_CONFIG_FILE="${src_dir}/.awsconfig" && export AWS_CONFIG_FILE
			AWS_SHARED_CREDENTIALS_FILE="${src_dir}/.awscredentials" && export AWS_SHARED_CREDENTIALS_FILE
			aws configure --profile "${AWS_PROFILE}"
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

	if [ -z "${AWS_REGION:-}" ]; then
		regions="$(aws ec2 describe-regions --region us-east-1 --query 'Regions[].RegionName' --output text 2>/dev/null)"

		PS3="Select deployment region: "
		select AWS_REGION in ${regions}; do
			export AWS_REGION
			break
		done
		unset PS3
	fi
	export AWS_PROFILE=${AWS_PROFILE:-}
	export AWS_REGION=${AWS_REGION:-}
}


#Validate proxy-config file
PROXY_CONFIG_PATH=${PROXY_CONFIG_PATH:-"config/proxy-config.yaml"}
PROXY_CONFIG_PATH=$(readlink -f "${PROXY_CONFIG_PATH}")
export PROXY_CONFIG_PATH

# Ensure source file is POSIX compatible for line reads
if ! tail -1 "${PROXY_CONFIG_PATH}" | grep -E '^$'; then
	echo >>"${PROXY_CONFIG_PATH}"
fi
if [ -s "${PROXY_CONFIG_PATH}" ]; then
	count=0
	while read -r line
	do
	#validate private API url
		if echo "${line}" | grep PRIVATE_API_URL > /dev/null 2>&1; then
			if ! echo "${line}" | awk '{print$2}' | grep -E "^(https:\/\/)([a-z0-9]*)\.(execute-api)\.([a-z]*)-([a-z]*)-([a-z]*-)?([0-9])\.amazonaws\.(com|cn)\/([a-zA-Z0-9\-\_]*)\/" > /dev/null 2>&1; then
				echo "${line} is invalid or does not match the accepted API URL pattern."
				exit 1
			fi
			count=$(( count + 1))
		fi
	done < "${PROXY_CONFIG_PATH}"
	if [[ $count -lt 1 ]]; then
		echo "No valid PRIVATE_API_URL entries were found in ${PROXY_CONFIG_PATH}"
		exit 1
	fi
else
  echo "No valid proxy configuration file exists in ${PROXY_CONFIG_PATH}.  A valid file must exist before deployment can continue."
  exit 1
fi

if ! aws sts get-caller-identity > /dev/null 2>&1; then
	echo "AWS credentials not set in environment or incorrect, redirecting to provide credentials."
	set_aws_credentials
fi

# CDK Execution
if [ "${execution_tool}" == "cdk" ]; then
	
	#Set CDK specific vars
	cdk_dir="${src_dir}/cdk"
	pushd "${cdk_dir}" > /dev/null

	#install packages
	echo "Installing Node.js Packages"
	npm install

	# Check for bootstrap
	if ! aws cloudformation describe-stacks --stack-name CDKToolkit >/dev/null 2>&1; then
		echo "CDK requires bootstrapping, please wait."
		cdk_env="aws://$(aws sts get-caller-identity --query 'Account' --output text)/${AWS_REGION}"
		(cd "${src_dir}" && NODE_HOME="${cdk_dir}/node_modules" npx -yes cdk bootstrap --profile "${AWS_PROFILE}" "${cdk_env}")
		success=$?
		if [ "${success}" != 0 ]; then
			echo "CDK bootstrapping failed, review and correct any errors shown in this terminal or in your AWS console.  Then delete the failed stack and try again."
			exit 1
		fi
	fi



	#Execute action
	case "${action}" in
	deploy | synth | synthesize | diff | destroy)
		pushd "${cdk_dir}" > /dev/null
			PROXY_DOMAINS=$(ts-node pre-hook.ts --proxyFilePath="${PROXY_CONFIG_PATH}" | jq -c .)
			export PROXY_DOMAINS

			npx --yes cdk --profile "${AWS_PROFILE}" "${action}" ${cdk_args:-} ${downstream_args:-}

			success=$?
			if [ $success != 0 ]; then
				exit $success
			elif [ "${action}" == "deploy" ]; then
				STACK_OUTPUTS=$(aws cloudformation describe-stacks --stack-name "${APP_NAME}-${APP_ENVIRONMENT}" --query "Stacks[0].Outputs" --output json | jq -c .)
				ts-node post-hook.ts --region "${AWS_REGION}" \
				--proxyFilePath="${PROXY_CONFIG_PATH}" \
				--destinationPath="${src_dir}/outputs/outputs.json" \
				--stackOutputs="${STACK_OUTPUTS}"
			fi
			
			if [ "${auth_mode:-}" == "access_keys" ]; then
				rm "${AWS_CONFIG_FILE}" "${AWS_SHARED_CREDENTIALS_FILE}"
			fi
		popd >/dev/null
		;;
	*)
		echo "Invalid action for AWS CDK (${action})."
		exit 1
		;;
	esac
fi

# Terraform Execution
if [ "${execution_tool}" == "terraform" ]; then
	case "${action}" in
	plan | apply | destroy)
		if [ ! -f "${src_dir}/config/proxy-config.yaml" ]; then
			cat <<EOF
ERROR: proxy-config.yaml is required in the config directory and is not present.
Place a valid proxy-config.yaml file in: ${src_dir}
A template file has been provided.
EOF
			exit 1
		fi
		pushd "${src_dir}/terraform" >/dev/null
		# Collection of variables required by terraform
		tfvars_file="${src_dir}/outputs/${APP_NAME}-${APP_ENVIRONMENT}.tfvars"
		echo >"${tfvars_file}"
		sed -E 's/^(.*VARIABLES:.*| *| *- *|.*---.*)//g;/^$/d;s/: */=/g;s/#.*$//g' "${var_file}" | while read -r line; do
			if [[ $line =~ ^EXTERNAL_PRIVATE_SUBNETS_ID.? ]]; then
				echo "${line}" | awk -F= '{print tolower($1)"="$2}' >>"${tfvars_file}"
			elif [[ $line =~ ^PROXY_CONFIG_PATH.? ]]; then
				echo "proxy_config_path=\"${PROXY_CONFIG_PATH}\"" >>"${tfvars_file}"
			else
				echo "${line}" | awk -F= '{print tolower($1)"=\""$2"\""}' >>"${tfvars_file}"
			fi
		done
		terraform init
		terraform "${action}" --var-file="${tfvars_file}" ${tf_args:-} ${downstream_args:-}
		popd >/dev/null
		;;
	*)
		echo "Invalid action for Terraform (${action})."
		exit 1
		;;
	esac
fi

exit 0
