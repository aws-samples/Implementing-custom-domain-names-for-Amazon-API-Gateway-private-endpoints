import { proxyDomain } from "../bin/Main";

export const GenerateNginxConfig = (domainsList: proxyDomain[]): string => {
  let conf_file_str = `user  nginx;
worker_processes  auto;

error_log  /var/log/nginx/error.log info;
pid        /var/run/nginx.pid;


events {
    worker_connections  1024;
}


http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    server_names_hash_bucket_size 128;
    log_format  main  '$remote_addr - $remote_user - $server_name $host [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer"'
                      '"$http_user_agent" "$http_x_forwarded_for"';

    access_log  /var/log/nginx/access.log  main;

    sendfile        on;
    #tcp_nopush     on;
 
    keepalive_timeout  65;

    #gzip  on;

    server {
      listen 443 default_server ssl;    
      ssl_certificate /cert.pem;
      ssl_certificate_key /key.pem;   
      location / {
        return 200 '<html><body>Private API URL not implemented.</body></html>';
        add_header Content-Type text/html;
      }        
    }
    `;
  domainsList.forEach((record) => {
    // console.log(`${record.PRIVATE_API_URL}`);
    // extract api id from api gateway url
    const apiId = record.PRIVATE_API_URL.split(".")[0].split("https://")[1];
    const privateAPIurl = `https://API_GATEWAY_VPC_DNS_${record.PRIVATE_API_URL.substring(
      record.PRIVATE_API_URL.indexOf("amazonaws.com") + 13,
    )}`;
    // console.log( `${ privateAPIurl }` )

    const conf_file_item = `
    server {
      listen 443 ssl;
      ssl_certificate /cert.pem;
      ssl_certificate_key /key.pem;          
      server_name ${record.CUSTOM_DOMAIN_URL};
      location / {          
          proxy_set_header X-Upstream-Domain  $server_name;          
          proxy_set_header Referer  $server_name;
          proxy_set_header x-apigw-api-id ${apiId};
          set $apiUrl ${privateAPIurl};
          proxy_pass ${privateAPIurl};
          
      }
    }
`;

    conf_file_str = conf_file_str + conf_file_item;
  });
  conf_file_str = conf_file_str + "}";
  // console.log(conf_file_str)
  return conf_file_str;
};
