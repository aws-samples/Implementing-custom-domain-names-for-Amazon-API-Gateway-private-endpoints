#!/bin/sh
if [ "$(aws ec2 describe-vpc-attribute --vpc-id "${1}" --attribute enableDnsSupport --query "EnableDnsSupport.Value" --output text)" = "True" ]; then
    echo "{\"value\":\"previously enabled\"}"
else
    aws ec2 modify-vpc-attribute --enable-dns-support --vpc-id "${1}"
    echo "{\"value\":\"terraform enabled\"}"
fi