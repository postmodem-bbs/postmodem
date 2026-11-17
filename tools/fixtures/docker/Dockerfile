# SPDX-License-Identifier: AGPL-3.0-or-later
# A legacy Przemo 1.12.9 board, preloaded: start it and the database is already there.
# Build via `pnpm fixtures:image` (it prepares the context in var/fixtures/context-<preset>/).
# Credentials are public fixture credentials: przemo / przemo, database `przemo`.
ARG MARIADB_VERSION=10.11

FROM mariadb:${MARIADB_VERSION} AS load
COPY schema/ /fixture/schema/
COPY data.sql.gz /fixture/
# The official image declares /var/lib/mysql a VOLUME, so the data goes to /fixture-data
# where it can be baked into the image layer.
RUN set -eu; \
    mariadb-install-db --user=mysql --datadir=/fixture-data --auth-root-authentication-method=normal --skip-test-db >/dev/null; \
    mariadbd --user=mysql --datadir=/fixture-data --skip-networking --socket=/tmp/load.sock --sql-mode= \
             --character-set-server=latin2 --collation-server=latin2_general_ci --innodb-flush-log-at-trx-commit=0 & \
    for i in $(seq 1 60); do mariadb-admin --socket=/tmp/load.sock ping >/dev/null 2>&1 && break; sleep 1; done; \
    mariadb --socket=/tmp/load.sock -uroot -e "\
      CREATE DATABASE przemo CHARACTER SET latin2 COLLATE latin2_general_ci; \
      CREATE USER 'przemo'@'%' IDENTIFIED BY 'przemo'; \
      GRANT ALL ON przemo.* TO 'przemo'@'%'; \
      CREATE USER 'przemo'@'localhost' IDENTIFIED BY 'przemo'; \
      GRANT ALL ON przemo.* TO 'przemo'@'localhost';"; \
    mariadb --socket=/tmp/load.sock -uroot --default-character-set=latin2 przemo < /fixture/schema/mysql_schema.sql; \
    mariadb --socket=/tmp/load.sock -uroot --default-character-set=latin2 przemo < /fixture/schema/mysql_basic.sql; \
    zcat /fixture/data.sql.gz | mariadb --socket=/tmp/load.sock -uroot --default-character-set=latin2 przemo; \
    mariadb-admin --socket=/tmp/load.sock -uroot shutdown; \
    wait

FROM mariadb:${MARIADB_VERSION}
ARG PRESET=small
LABEL org.opencontainers.image.title="Postmodem legacy fixture: Przemo 1.12.9 (${PRESET})" \
      org.opencontainers.image.source="https://github.com/postmodem-bbs/postmodem" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later AND GPL-2.0-or-later" \
      org.opencontainers.image.description="Generated test data only. Credentials: przemo/przemo, database przemo."
COPY --from=load --chown=mysql:mysql /fixture-data /fixture-data
COPY manifest.json /fixture/manifest.json
EXPOSE 3306
HEALTHCHECK --interval=2s --timeout=3s --retries=60 \
  CMD ["mariadb-admin", "ping", "-h", "127.0.0.1", "-uprzemo", "-pprzemo", "--silent"]
CMD ["mariadbd", "--datadir=/fixture-data", "--sql-mode=", "--character-set-server=latin2", "--collation-server=latin2_general_ci"]
