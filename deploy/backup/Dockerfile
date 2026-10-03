# pg_dump 16 + AWS CLI. Same major version as the server.
ARG POSTGRES_VERSION=16
FROM postgres:${POSTGRES_VERSION}-bookworm
RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends awscli ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
USER postgres
ENTRYPOINT ["/usr/local/bin/backup.sh"]
CMD ["loop"]
