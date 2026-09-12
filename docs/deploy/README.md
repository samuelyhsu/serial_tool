# 自建服务器部署（serial.uplume.com）

GitHub Pages 那份之外，同一份产物再部署一份到自己的服务器，由
`.github/workflows/deploy.yml` 的 `self-hosted` job 通过 rsync 推送。触发方式与 Pages
那份相同：打 tag 发布时由 `release.yml` 调用，或者到 Actions 页手动 dispatch。

## 前提：必须是 HTTPS

Web Serial API 只在**安全上下文**（https 或 localhost）下可用。纯 http 的站点上
`navigator.serial` 根本不存在，页面会显示「此浏览器不支持 Web Serial」横幅。

## 安全模型：部署密钥只能做一件事

这把密钥存在 GitHub secrets 里，经手它的是 CI。所以它在服务器上只该有一种能力：
**往站点目录写文件**。给它一个 shell，就等于把这台机器上所有对普通用户可读的东西
（其它服务的配置、凭据）一并交出去。于是：

- 用专门的系统用户 `deploy`，不用 root；
- `authorized_keys` 里用 rsync 自带的 [rrsync](https://download.samba.org/pub/rsync/rrsync.1)
  做强制命令，把这把钥匙钉死在站点目录上：执行别的命令、反向读取、用 `..` 越出目录，
  一律拒绝；
- `authorized_keys` 归 root 所有，`deploy` 自己改不了这条限制；
- 工作流里密钥只交给 Deploy 那一步 —— `npm ci` 执行依赖的 install 脚本时拿不到它。

## 一、服务器（只做一次，root 执行）

### 1. rsync 与部署用户

```bash
apt-get install -y --no-install-recommends rsync   # 两端都要有；Ubuntu 22.04 的包自带 /usr/bin/rrsync
adduser --system --group --home /var/lib/deploy --shell /bin/sh deploy
```

shell 必须是真 shell，不能是 nologin：sshd 靠它执行强制命令。系统用户默认没有可用密码，
登不进交互 shell。

### 2. 站点目录

```bash
install -d -m 755 -o deploy -g deploy /var/www/serial.uplume.com
```

**必须归 `deploy` 所有，只给写权限不够。** rsync `-a` 会把目标目录本身的时间戳同步成
源目录的，而把时间戳设成任意值要求调用者是文件属主
（[utimensat(2)](https://man7.org/linux/man-pages/man2/utimensat.2.html)）；不是属主时
rsync 报 `failed to set times` 并以退出码 23 失败。

### 3. 部署公钥（钉死在站点目录）

```bash
install -d -m 755 -o root -g root /var/lib/deploy/.ssh
echo 'restrict,command="/usr/bin/rrsync -wo /var/www/serial.uplume.com" <公钥内容>' \
  > /var/lib/deploy/.ssh/authorized_keys
chmod 644 /var/lib/deploy/.ssh/authorized_keys
```

- `-wo`：只许写入、不许读取；`restrict`：关掉端口 / agent / X11 转发与 PTY 分配。
- rrsync 下客户端给的路径**相对站点目录**，所以 `DEPLOY_PATH` 填 `.`。填绝对路径反而会出错：
  rrsync 会把它接在站点目录后面，变成 `/var/www/serial.uplume.com/var/www/serial.uplume.com/`。
- 两次部署不会同时写：rrsync 默认对站点目录加独占锁。

### 4. Caddy 站点

站点配置见同目录的 [serial.uplume.com.caddyfile](serial.uplume.com.caddyfile)。
放到主 Caddyfile `import` 的位置 —— 主 Caddyfile 由别的工具管理时尤其如此，别去改它：

```bash
cp serial.uplume.com.caddyfile /etc/caddy/sites/serial.uplume.com.conf
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl restart caddy
```

用 restart 而不是 reload：全局选项里设了 `admin off` 时，`caddy reload` 依赖的 admin API
不存在，[官方文档](https://caddyserver.com/docs/caddyfile/options#admin)明说此时改配置只能
停了再起。重启会让这台 Caddy 上的其它站点短暂中断。

证书由 Caddy 自动签发与续期，前提是域名的 A 记录指向这台机器、80/443 对外可达。
签发在后台进行，刚重启的一小段时间里 https 可能还握不上手。

## 二、本地生成部署密钥

**专门为这个用途生成一对，并且不要生成在仓库目录里** —— `.gitignore` 没有排除它，
一次 `git add -A` 就提交了：

```bash
mkdir -p ~/serial-deploy && cd ~/serial-deploy
ssh-keygen -t ed25519 -N "" -C "github-actions deploy: serial.uplume.com" -f deploy_key
```

`-N ""` 是必须的：runner 上没人输口令，工作流也没用 ssh-agent。

`known_hosts` 直接用服务器上的主机公钥生成，不走 `ssh-keyscan`（那是网络上的首次信任）。
在一条你已经信任的 SSH 连接里执行：

```bash
ssh <你的主机别名> 'for t in ed25519 ecdsa rsa; do awk "{print \"[<主机>]:<端口>\", \$1, \$2}" /etc/ssh/ssh_host_${t}_key.pub; done' > known_hosts
ssh-keygen -lf known_hosts   # 与本机 ~/.ssh/known_hosts 里这台机器的指纹对一遍
```

- 端口是 22 时不要方括号和端口：`<主机> ssh-ed25519 AAAA…`；
- `<主机>` 必须和 `SSH_HOST` 一字不差 —— ssh 拿来匹配的是用户给出的主机名
  （[sshd(8)](https://man.openbsd.org/sshd.8) 的 SSH_KNOWN_HOSTS FILE FORMAT 一节）。

## 三、上线前在本地把整条链路验一遍

用和 CI 完全相同的 rsync 参数推一个占位页。Windows 上可以在 WSL 里跑，但私钥要先复制到
Linux 文件系统里再 `chmod 600` —— `/mnt/c` 下的文件权限是 777，ssh 会拒绝使用：

```bash
mkdir -p /tmp/probe && echo ok > /tmp/probe/index.html
rsync -az --delete --chmod=D755,F644 \
  -e "ssh -i deploy_key -p <端口> -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$PWD/known_hosts" \
  /tmp/probe/ deploy@<主机>:./
```

退出码为 0 再往下走。顺带确认限制生效：`ssh -i deploy_key -p <端口> deploy@<主机> id`
应当被拒绝（`rrsync error: SSH_ORIGINAL_COMMAND does not run rsync`）。

## 四、GitHub secrets

仓库 Settings → Secrets and variables → Actions → New repository secret：

| 名称 | 值 |
| --- | --- |
| `SSH_KEY` | `deploy_key` 私钥全文（含首尾 `-----BEGIN/END-----` 行） |
| `SSH_KNOWN_HOSTS` | 上面生成的 `known_hosts` 文件内容 |
| `SSH_HOST` | 服务器 IP 或主机名，与 known_hosts 里的一致 |
| `SSH_PORT` | SSH 端口（是 22 也要配） |
| `SSH_USER` | `deploy` |
| `DEPLOY_PATH` | `.`（rrsync 下相对站点目录） |

也可以用 gh（在 Git Bash 里执行 —— PowerShell 不支持 `<` 重定向）：

```bash
R=samuelyhsu/serial_tool
gh secret set SSH_KEY -R $R < deploy_key
gh secret set SSH_KNOWN_HOSTS -R $R < known_hosts
gh secret set SSH_HOST -R $R --body '<主机>'
gh secret set SSH_PORT -R $R --body '<端口>'
gh secret set SSH_USER -R $R --body deploy
gh secret set DEPLOY_PATH -R $R --body .
```

- 必须是**仓库级** secret，不能放进环境：`release.yml` 靠 `secrets: inherit` 往下传，
  而环境级 secret 传不过去。
- 主机与端口放 secrets 而不是写进文件，是因为这个仓库是公开的 —— 非标准 SSH 端口
  没必要主动登出去。
- 第一次部署成功之后删掉本地的 `deploy_key`。要换钥匙就重新生成一对，同时换掉服务器上的
  公钥和这个 secret。

**没配 `SSH_KEY` 时这个 job 会整个跳过**，不会让流水线变红 —— 代价是「忘了配」和
「不需要配」在日志上长得一样。部署后到 job 日志里确认执行的是 `Deploy` 那一步，
而不是 `Skipped`。

## 五、验证

```bash
curl -I https://serial.uplume.com                          # 200，且带 Strict-Transport-Security
curl -I http://serial.uplume.com                           # 308 跳 https（Caddy 的自动重定向）
curl -s https://serial.uplume.com | grep -o 'src="[^"]*"'  # 资源路径应为 /assets/...
```

浏览器打开 <https://serial.uplume.com>，确认「选择端口」按钮**不是**禁用状态 ——
禁用说明 `navigator.serial` 不存在，多半是 TLS 没生效。
