ARG PLATFORM
ARG IMAGE
FROM --platform=${PLATFORM} ${IMAGE}

RUN amazon-linux-extras install -y nginx1 \
    && yum update -y \
    && yum clean all

ADD --chmod=500 entrypoint.sh /entrypoint.sh

ENTRYPOINT [ "/entrypoint.sh" ]