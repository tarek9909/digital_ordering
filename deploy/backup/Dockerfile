# Backup sidecar: mysqldump/mysqlbinlog from the same MySQL version, and rclone for any off-site target
# (Backblaze B2, Cloudflare R2, Wasabi, another server over SFTP, …) and for reading MinIO over S3.
#
# L-23: every downloaded binary is checksum-verified before use. To upgrade rclone, take the value for
# rclone-vX.Y.Z-linux-amd64.zip from https://downloads.rclone.org/vX.Y.Z/SHA256SUMS (PGP-signed by the rclone
# maintainers) and change both ARGs together. The MinIO client (mc) is no longer installed here: dl.min.io stopped
# serving community mc builds (HTTP 410), and rclone reads MinIO directly with the read-only backup identity.
FROM mysql:8.4
ARG RCLONE_VERSION=v1.69.1
# From https://downloads.rclone.org/v1.69.1/SHA256SUMS (fetched 2026-10-22).
ARG RCLONE_SHA256=231841f8d8029ae6cfca932b601b3b50d0e2c3c2cb9da3166293f1c3eae7d79c
RUN microdnf install -y unzip cronie findutils gzip && microdnf clean all \
 && curl -fsSL "https://downloads.rclone.org/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-amd64.zip" -o /tmp/rclone.zip \
 && echo "${RCLONE_SHA256}  /tmp/rclone.zip" | sha256sum -c - \
 && unzip -j /tmp/rclone.zip '*/rclone' -d /usr/local/bin && chmod +x /usr/local/bin/rclone && rm /tmp/rclone.zip
COPY mysql-client.sh backup.sh binlogs.sh files.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh
ENV RCLONE_CONFIG=/config/rclone/rclone.conf
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
