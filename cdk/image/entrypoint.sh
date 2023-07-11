#!/bin/sh

NGINX_CONFIG=$(echo $NGINX_CONFIG | base64 --decode)

if [ -z "${API_GATEWAY_VPC_DNS:-}" ]; then
  echo "API_GATEWAY_VPC_DNS is not set"
  echo "${NGINX_CONFIG}" > /etc/nginx/nginx.conf
else
  echo "API_GATEWAY_VPC_DNS is set, updating config."
  echo "${NGINX_CONFIG}" | sed "s/API_GATEWAY_VPC_DNS_/${API_GATEWAY_VPC_DNS}/g" > /etc/nginx/nginx.conf
fi

nginx -g "daemon off;"