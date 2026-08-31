#!/usr/bin/env bash
# ============================================================
# 下载站 · Nginx 一键反代配置脚本（Debian 12 / Ubuntu）
#
# 用法:
#   sudo bash nginx-setup.sh <站点域名> [面板域名] [站点端口] [面板端口] [HTTPS邮箱]
#
# 示例:
#   sudo bash nginx-setup.sh dl.example.com panel.example.com
#   sudo bash nginx-setup.sh dl.example.com panel.example.com 3000 8080 you@example.com
#
# 说明:
#   - 站点域名 -> 下载站(默认 3000)
#   - 面板域名 -> 开服面板(默认 8080)，可选，不传则不配
#   - 第 5 个参数填邮箱时自动申请免费 HTTPS 证书并强制跳转
#   - 执行前请先把域名 A 记录解析到本服务器 IP
# ============================================================
set -euo pipefail

SITE_DOMAIN="${1:?用法: sudo bash nginx-setup.sh <站点域名> [面板域名] [站点端口] [面板端口] [HTTPS邮箱]}"
PANEL_DOMAIN="${2:-}"
SITE_PORT="${3:-3000}"
PANEL_PORT="${4:-8080}"
SSL_EMAIL="${5:-}"

echo "==> [1/5] 安装 Nginx"
if ! command -v nginx >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx
fi

echo "==> [2/5] 生成下载站反代配置 (${SITE_DOMAIN} -> :${SITE_PORT})"
cat > /etc/nginx/sites-available/download-station <<EOF
server {
    listen 80;
    server_name ${SITE_DOMAIN};

    # 允许上传大文件（与 .env 中 MAX_FILE_SIZE_MB 对应）
    client_max_body_size 2048m;

    location / {
        proxy_pass http://127.0.0.1:${SITE_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

ln -sf /etc/nginx/sites-available/download-station /etc/nginx/sites-enabled/download-station

if [ -n "${PANEL_DOMAIN}" ]; then
  echo "==> [3/5] 生成面板反代配置 (${PANEL_DOMAIN} -> :${PANEL_PORT})"
  cat > /etc/nginx/sites-available/ds-panel <<EOF
server {
    listen 80;
    server_name ${PANEL_DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${PANEL_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/ds-panel /etc/nginx/sites-enabled/ds-panel
fi

rm -f /etc/nginx/sites-enabled/default

echo "==> [4/5] 测试并重载 Nginx"
nginx -t
systemctl reload nginx

# 防火墙放行 80/443（装了 ufw 才执行）
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80,443/tcp >/dev/null 2>&1 || true
fi

if [ -n "${SSL_EMAIL}" ]; then
  echo "==> [5/5] 配置 HTTPS 证书 (certbot)"
  if ! command -v certbot >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
  fi
  DOMAINS=(-d "${SITE_DOMAIN}")
  if [ -n "${PANEL_DOMAIN}" ]; then DOMAINS+=(-d "${PANEL_DOMAIN}"); fi
  certbot --nginx "${DOMAINS[@]}" --agree-tos -m "${SSL_EMAIL}" --redirect --non-interactive
fi

echo "========================================"
echo "  配置完成！"
echo "  下载站: http://${SITE_DOMAIN}"
[ -n "${PANEL_DOMAIN}" ] && echo "  面板:   http://${PANEL_DOMAIN}"
if [ -n "${SSL_EMAIL}" ]; then
  echo "  HTTPS:  https://${SITE_DOMAIN}（自动跳转）"
fi
echo "========================================"
