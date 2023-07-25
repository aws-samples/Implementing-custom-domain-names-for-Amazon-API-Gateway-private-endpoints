#!/bin/sh

NGINX_CONFIG_DECODED=$(echo $NGINX_CONFIG | base64 --decode)

# Generate certificate
ENDPOINT_URL=$(echo $NGINX_CONFIG | base64 -d | grep -e '\$endpointUrl .*;' | awk '{print$3}' | awk -F";" '{print$1}' |head -1)
SERVER_NAMES=$(echo $NGINX_CONFIG | base64 -d | grep -e '.*server_name .*;' | awk '{print$2}' | awk -F';' '{print$1}')

# Update openssl.cnf file
DNS_COUNT=1
echo "Appending endpoint URL to certificate request."
echo "DNS.${DNS_COUNT} = ${ENDPOINT_URL}" >> /openssl.cnf
for server_name in ${SERVER_NAMES}; do
  DNS_COUNT=$((DNS_COUNT + 1))
  echo "Appending ${server_name} to certificate request."
  echo "DNS.${DNS_COUNT} = ${server_name}" >> /openssl.cnf
done

# Generate certificate and key
echo "Generating certificate and key."
openssl req -new -x509 -days 365 -nodes -config /openssl.cnf -out /cert.pem -keyout /key.pem

if [ -z "${API_GATEWAY_VPC_DNS:-}" ]; then
  echo "API_GATEWAY_VPC_DNS is not set"
  echo "${NGINX_CONFIG_DECODED}" > /etc/nginx/nginx.conf
else
  echo "API_GATEWAY_VPC_DNS is set, updating config."
  echo "${NGINX_CONFIG_DECODED}" | sed "s/API_GATEWAY_VPC_DNS_/${API_GATEWAY_VPC_DNS}/g" > /etc/nginx/nginx.conf
fi

nginx -g "daemon off;"