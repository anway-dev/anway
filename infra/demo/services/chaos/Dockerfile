FROM alpine:latest
RUN apk add --no-cache curl bash git docker-cli openssl
COPY chaos.sh /chaos.sh
RUN chmod +x /chaos.sh
CMD ["/chaos.sh"]
