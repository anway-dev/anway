FROM alpine:latest
RUN apk add --no-cache curl bash
COPY load-gen.sh /load-gen.sh
RUN chmod +x /load-gen.sh
CMD ["/load-gen.sh"]
