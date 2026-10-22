#!/bin/sh
# One-time server preparation on Ubuntu 22.04/24.04 or Debian 12 (run as root):
#   Docker + Compose, firewall (22, 80, 443 only), unattended security updates, a deploy user.
#
# L-23: Docker comes from Docker's signed apt repository (https://docs.docker.com/engine/install/ubuntu/ and
# .../debian/), not `curl get.docker.com | sh`. The repository key is checked against Docker's published
# fingerprint before apt trusts it, and apt then verifies every package signature.
set -eu
DOCKER_GPG_FINGERPRINT=9DC858229FC7DD38854AE2D88D81803C0EBFCD88

apt-get update
apt-get install -y ca-certificates curl gnupg ufw unattended-upgrades fail2ban

if ! command -v docker >/dev/null; then
  . /etc/os-release
  case "$ID" in
    ubuntu|debian) ;;
    *) echo "unsupported distribution: $ID (expected ubuntu or debian)" >&2; exit 1 ;;
  esac
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /tmp/docker.asc
  FPR=$(gpg --show-keys --with-colons /tmp/docker.asc 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }')
  if [ "$FPR" != "$DOCKER_GPG_FINGERPRINT" ]; then
    echo "Docker repository key fingerprint mismatch (got '$FPR'); not installing." >&2
    rm -f /tmp/docker.asc
    exit 1
  fi
  mv /tmp/docker.asc /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID ${VERSION_CODENAME:?} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
dpkg-reconfigure -f noninteractive unattended-upgrades
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash -G docker deploy
mkdir -p /opt/tanbeeh && chown deploy:deploy /opt/tanbeeh
echo "Done. Add your CI public key to /home/deploy/.ssh/authorized_keys and put the deploy/ folder in /opt/tanbeeh."
echo "Host key fingerprints for the VPS_HOST_FINGERPRINT GitHub secret (see deploy/README.md §4):"
for k in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$k"; done
