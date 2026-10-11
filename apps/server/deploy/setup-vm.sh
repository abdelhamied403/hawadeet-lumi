#!/usr/bin/env bash
# Run ON the VM (Ubuntu), from the veogen folder, after deploy/push.sh has copied the project:
#   ./deploy/setup-vm.sh veogen-example.duckdns.org
# Installs Bun and Caddy, sets the login, and starts Veogen behind HTTPS on the given domain.
# Safe to run again; it keeps an existing password and secret.
set -euo pipefail

DOMAIN="${1:?Usage: ./deploy/setup-vm.sh <domain that points at this VM>}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="$(id -un)"
cd "$APP_DIR"

echo "== Packages (Caddy, Arabic caption fonts) =="
sudo apt-get update -y
sudo apt-get install -y curl unzip gpg debian-keyring debian-archive-keyring apt-transport-https fonts-noto-core rsync
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi

echo "== Bun =="
if [ ! -x "$HOME/.bun/bin/bun" ]; then curl -fsSL https://bun.sh/install | bash; fi
"$HOME/.bun/bin/bun" install --production

echo "== Login =="
touch .env && chmod 600 .env
if ! grep -q '^JWT_SECRET=.\+' .env; then
  sed -i '/^JWT_SECRET=/d' .env
  echo "JWT_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '/+=\n')" >> .env
fi
if ! grep -q '^AUTH_PASSWORD=.\+' .env; then
  sed -i '/^AUTH_PASSWORD=/d' .env
  while true; do
    read -r -s -p "Choose the app password (12+ characters, letters and digits): " PASSWORD; echo
    if [[ "$PASSWORD" =~ ^[A-Za-z0-9_.-]{12,}$ ]]; then break; fi
    echo "Use 12 or more letters, digits, dots, dashes or underscores."
  done
  echo "AUTH_PASSWORD=$PASSWORD" >> .env
fi
sed -i '/^WEB_ORIGIN=/d' .env
echo "WEB_ORIGIN=https://$DOMAIN" >> .env

echo "== Firewall (ports 80 and 443) =="
# Oracle's Ubuntu images reject everything but SSH in iptables, on top of the cloud console's own rules.
for PORT in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 1 -p tcp --dport "$PORT" -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save; fi

echo "== HTTPS proxy =="
sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
$DOMAIN {
	reverse_proxy 127.0.0.1:4517
}
CADDY
sudo systemctl enable --now caddy
sudo systemctl reload caddy

echo "== Service =="
sudo tee /etc/systemd/system/veogen.service >/dev/null <<UNIT
[Unit]
Description=Veogen pipeline server
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
# The daily part is created at the owner's local time.
Environment=TZ=Africa/Cairo
Environment=PATH=$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$HOME/.bun/bin/bun run src/server/index.ts
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable veogen
sudo systemctl restart veogen
sleep 3
sudo systemctl --no-pager --lines=5 status veogen || true

echo
echo "Done. In the app, use this server address: https://$DOMAIN"
echo "If it does not answer, check that ports 80 and 443 are open in the cloud console's ingress rules."
