ARG PLATFORM
ARG IMAGE
FROM --platform=${PLATFORM} ${IMAGE}

RUN amazon-linux-extras install -y nginx1 \
    && yum clean all