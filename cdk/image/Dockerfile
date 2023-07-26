ARG PLATFORM
ARG IMAGE
FROM --platform=${PLATFORM} ${IMAGE}

RUN amazon-linux-extras install -y nginx1 \
    && yum update -y \
    && yum install -y openssl \
    && yum clean all && \
    rm -rf /var/cache/yum

ADD --chmod=500 entrypoint.sh /entrypoint.sh
ADD --chmod=400 openssl.cnf /openssl.cnf

ENTRYPOINT [ "/entrypoint.sh" ]