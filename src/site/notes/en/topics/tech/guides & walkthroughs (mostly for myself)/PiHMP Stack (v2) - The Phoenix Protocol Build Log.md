---
{"dg-publish":true,"permalink":"/en/topics/tech/guides-and-walkthroughs-mostly-for-myself/pi-hmp-stack-v2-the-phoenix-protocol-build-log/","title":"PiHMP Stack (v2) - The Phoenix Protocol Build Log","created":"2025-11-09T18:57:47.948-05:00","updated":"2025-11-11T21:01:35.427-05:00"}
---

### Introduction: The Inciting Incident

A few days ago, my trusty Raspberry Pi 4—the backbone of my home network—died. A power outage corrupted its SD card, and my entire stack of services went dark. What began as a simple restore became an opportunity. Instead of just rebuilding, I decided to re-architect everything to be more resilient, more powerful, and frankly, more fun.

This document is the master build log for that project. It contains **every file, every configuration, every command, and every critical fix** required to build this stack from a fresh OS install. This is the blueprint for a resilient, self-aware, and fully automated home server.

**The Pillars of the Stack:**

1. **Rock-Solid Foundation:** Static IPs and resilient storage that survives a boot failure.
    
2. **Containerized Services:** A full Docker stack for Plex, Pi-hole, Netdata, and a custom dashboard.
    
3. **Pro-Level Networking:** Pi-hole as a network-wide DHCP server (with the IPv6 "ad leak" plugged) and a Time Machine backup server for my Mac.
    
4. **The "Ray Arnold" Bot:** A set of scripts that gives the Pi a voice, notifying me on Discord of reboots, shutdowns, internet outages, and backup status.
    
5. **The "3-2-1" Backup Strategy:** A fully automated, two-part backup plan with local snapshots and off-site, version-controlled config files in a private GitHub repo.
    

## Part 1: The Foundation (Storage & Networking)

Before a single container is run, the host OS must be bulletproof. This means it must _never_ hang on boot and _never_ lose its IP address.

### 1.1: Resilient Storage (`fstab`)

The first failure point was `fstab`. If a USB drive was missing, the Pi would hang on boot. We fixed this by identifying all drives with `lsblk -f` and using their `UUID`s with the `nofail` option.

**File 1 of 17: `/etc/fstab` (Addition)** _This block is added to the end of the file to auto-mount all USB storage._

```
# --- My USB Drives ---

# 2TB HDD (TimeMachine drive)
UUID=XXXX-XXXX-XXXX-XXXX  /mnt/storage-2tb   ext4   defaults,nofail   0   2

# USB Stick 1
UUID=XXXX-XXXX         /mnt/usb-stick1    exfat     defaults,auto,users,rw,nofail,umask=000   0   0

# USB Stick 2
UUID=XXXX-XXXX         /mnt/usb-stick2    exfat     defaults,auto,users,rw,nofail,umask=000   0   0
```

### 1.2: Apple Time Machine & Samba Share

To allow my Mac to back up, the Pi needs to act as a Time Machine. This requires **Samba** (for the share) and **Avahi**(for Apple's discovery).

First, we install the required packages:

```
sudo apt-get update
sudo apt-get install -y samba avahi-daemon
```

We must add our user (`[your_username]`) to Samba's internal password database:

```
sudo smbpasswd -a [your_username]
# (Enter your SSH password when prompted)
```

**File 2 of 17: `/etc/samba/smb.conf` (Complete File)** _This is the complete, working config, using the modern "fruit-only" method for Mac compatibility._

```
#
# Complete smb.conf with Time Machine support
#
[global]
   workgroup = WORKGROUP
   server string = Server
   security = user
   map to guest = bad user
   guest account = [your_username]

   # --- SIMPLIFIED APPLE SUPPORT ---
   # This is the modern, reliable way to support Mac features
   vfs objects = fruit
   fruit:aapl = yes
   fruit:metadata = stream
   fruit:model = MacSamba
   # --- END APPLE SUPPORT ---

[PiShare]
   comment = Raspberry Pi Share 2TB
   path = /mnt/storage-2tb
   browseable = yes
   writable = yes
   guest ok = yes
   public = yes
   create mask = 0664
   directory mask = 0775
   force user = [your_username]
   force group = [your_username]

[TimeMachine]
   comment = Pi Time Machine
   # This folder must be created first:
   # sudo mkdir -p /mnt/storage-2tb/TimeMachineBackups
   # sudo chown -R [your_username]:[your_username] /mnt/storage-2tb/TimeMachineBackups
   path = /mnt/storage-2tb/TimeMachineBackups
   browseable = yes
   writable = yes
   guest ok = yes
   public = yes
   create mask = 0664
   directory mask = 0775
   force user = [your_username]
   force group = [your_username]
   
   # This is the magic line that enables Time Machine
   fruit:time machine = yes
```

**File 3 of 17: `/etc/avahi/services/timemachine.service` (New File)** _This file advertises the Time Machine service to Macs on the network via Bonjour._

XML

```
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">%h</name>
  <service>
    <type>_smb._tcp</type>
    <port>445</port>
  </service>
  <service>
    <type>_device-info._tcp</type>
    <port>0</port>
    <txt-record>model=TimeCapsule8,119</txt-record>
  </service>
  <service>
    <type>_adisk._tcp</type>
    <port>9</port>
    <txt-record>dk0=adVN=TimeMachine,adVF=0x82</txt-record>
    <txt-record>sys=waMa=0,adVF=0x100</txt-record>
  </service>
</service-group>
```

Finally, we restart the services to apply all changes:

```
sudo systemctl restart smbd
sudo systemctl restart avahi-daemon
```

### 1.3: Static IP & Network Stability (The Critical Fixes)

This was the most critical part of the build. The network was failing daily due to two issues.

**Critical Fix #1: The "2 PM Meltdown" (DHCP Lease Expiry)** My network was dying every 24 hours. The cause: my Pi (the DHCP _server_) was also a DHCP _client_, and its IP lease would expire.

The fix was to set a permanent static IP. Since my OS uses `NetworkManager`, `dhcpcd.conf` didn't work. We used `nmcli`.

First, find the connection name:

```
nmcli con show
# NAME                UUID                                  TYPE      DEVICE
# Wired connection 1  1234abcd-1234-1234-123456abcdef  ethernet  eth0
```

Then, apply the static IP settings using that name:

```
# Set the Static IP
sudo nmcli con mod "Wired connection 1" ipv4.addresses 192.168.1.250/24
# Set the Gateway
sudo nmcli con mod "Wired connection 1" ipv4.gateway 192.168.1.1
# Set the DNS (to use itself)
sudo nmcli con mod "Wired connection 1" ipv4.dns 127.0.0.1
# Set the Method to static
sudo nmcli con mod "Wired connection 1" ipv4.method manual
# Apply the changes
sudo nmcli con up "Wired connection 1"
```

**Critical Fix #2: The "Ad Leak" (IPv6)** Ads were still slipping through Pi-hole. This was an IPv6 DNS leak. My router was advertising its _own_ IPv6 DNS alongside my Pi-hole's IPv4 DNS. Devices were bypassing the Pi-hole.

**The Fix:** The simplest, most reliable solution was to **log in to my router and disable all IPv6 services for the LAN.**This forces 100% of DNS traffic through the Pi-hole.

## Part 2: The Core Services (Docker Stack)

With a stable host, we deploy the services. Using Docker Compose means this entire stack is defined in one file.

**File 4 of 17: `~/docker/docker-compose.yml` (Complete File)** _This is the complete, 100% hard-coded file. We bypassed `.env`files entirely after the Pi-hole image failed to read them._

YAML

```
#
# This is the FINAL, 100% hard-coded docker-compose.yml
#
services:
  # --- Pi-hole DNS Ad-blocker ---
  pihole:
    image: pihole/pihole:latest
    container_name: pihole
    # 'network_mode: host' is ESSENTIAL for the DHCP server to work
    # This connects it directly to the LAN (eth0)
    network_mode: host
    environment:
      - TZ=America/New_York
      - WEBPASSWORD=MySecurePasswordHere # <-- SET THIS
    volumes:
      - ./pihole/etc-pihole:/etc/pihole
      - ./pihole/etc-dnsmasq:/etc/dnsmasq.d
    # Required for Pi-hole's DNS and DHCP functions
    cap_add:
      - NET_ADMIN
    restart: unless-stopped

  # --- Plex Media Server ---
  plex:
    image: linuxserver/plex:latest
    container_name: plex
    # Host mode is simplest for network discovery (DLNA, etc.)
    network_mode: host
    environment:
      - PUID=1000 # Matches the '[your_username]' user
      - PGID=1000 # Matches the '[your_username]' group
      - TZ=America/New_York
      - VERSION=docker
    volumes:
      - ./plex/config:/config
      # Mounts from Part 1, read-only for safety
      - /mnt/storage-2tb:/media/storage-2tb:ro
      - /mnt/usb-stick1:/media/usb-stick1:ro
      - /mnt/usb-stick2:/media/usb-stick2:ro
    restart: unless-stopped

  # --- Netdata System Monitor ---
  netdata:
    image: netdata/netdata:latest
    container_name: netdata
    hostname: [your_pi_hostname]
    ports:
      - "19999:19999"
    volumes:
      - ./netdata/config:/etc/netdata
      - ./netdata/lib:/var/lib/netdata
      - ./netdata/cache:/var/cache/netdata
      # Mount host paths for monitoring
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    cap_add:
      - SYS_PTRACE
      - SYS_ADMIN
    security_opt:
      - apparmor:unconfined
    restart: unless-stopped

  # --- Cyberpunk Dashboard ---
  dashboard:
    container_name: dashboard
    # This tells Docker to build the image from the Dockerfile
    # in the ../dashboard directory (relative to this compose file)
    build: ../dashboard
    ports:
      - "8000:8000"
    restart: unless-stopped
```

To launch the stack:

```
cd ~/docker
sudo docker compose up -d --build
```

## Part 3: The "Cockpit" (Cyberpunk Dashboard)

To create a single, easy-to-remember homepage for all my services, I built this dashboard. It's served by its own lightweight Docker container.

**File 5 of 17: `~/dashboard/Dockerfile` (New File)**

Dockerfile

```
# Use a lightweight official Python image
FROM python:3.11-slim

# Set the working directory inside the container
WORKDIR /app

# Copy your dashboard files into the container
COPY index.html .
COPY favicon.svg .

# Expose port 8000
EXPOSE 8000

# The command to run when the container starts
CMD ["python3", "-m", "http.server", "8000"]
```

**File 6 of 17: `~/dashboard/favicon.svg` (New File)**

XML

```
<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" fill="#0d0208"/>
  <rect x="12" y="8" width="8" height="16" fill="#00ff00">
    <animate attributeName="opacity" values="0;1;1;0" dur="1s" repeatCount="indefinite" />
  </rect>
</svg>
```

**File 7 of 17: `~/dashboard/index.html` (New File)**

HTML

```
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>[your_pi_hostname] :: dashboard</title>
    <link rel="icon" href="favicon.svg" type="image/svg+xml">
    <style>
        body { 
            background-color: #0d0208; color: #00ff00; 
            font-family: 'Consolas', 'Menlo', 'Courier New', monospace; 
            font-size: 1.2rem; padding: 2rem;
        }
        h1 { color: #00ff00; border-bottom: 1px solid #00ff00; }
        pre {
            color: #f0f; font-size: 1rem;
            border: 1px dashed #f0f; padding: 1rem; display: inline-block;
        }
        a { color: #f0f; text-decoration: none; font-size: 1.5rem; }
        a:hover { color: #00ff00; text-decoration: underline; }
        .container { max-width: 800px; margin: 0 auto; }
        .links { list-style: none; padding-left: 0; }
        .links li { margin-bottom: 2rem; }
        .links span { color: #888; display: block; font-size: 0.9rem; margin-top: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <pre>
[SYSTEM_ROOT]: [your_pi_hostname]
[NODE_IP]:     192.168.1.250
[STATUS]:      ALL_SERVICES_ONLINE
        </pre>
        <h1>// SERVICE_MATRIX</h1>
        <ul class="links">
            <li>
                <a href="http://192.168.1.250/admin" target="_blank">[Pi-hole]</a>
                <span>// Network-Wide DNS & Ad-Blocking (Port 80)</span>
            </li>
            <li>
                <a href="http://192.168.1.250:32400/web" target="_blank">[Plex]</a>
                <span>// Media Server Interface (Port 32400)</span>
            </li>
            <li>
                <a href="http://192.168.1.250:19999" target="_blank">[Netdata]</a>
                <span>// Real-Time System Health Monitor (Port 19999)</span>
            </li>
        </ul>
    </div>
</body>
</html>
```

## Part 4: The "Ray Arnold" Bot (Automation & Awareness)

This is the Pi's "voice." It's a series of `bash` scripts that use Discord Webhooks to report on system status. This is **not** a Docker container, but a set of scripts running on the host OS so they can monitor boot and shutdown.

**File 8 of 17: `/usr/local/bin/pi-online-notify.sh` (New File)** _Notifies Discord when the Pi has successfully booted and regained network access._

Bash

```
#!/bin/bash
WEBHOOK_URL="[https://discord.com/api/webhooks/XXXXXXXXX/YYYYYYYY](https://discord.com/api/webhooks/XXXXXXXXX/YYYYYYYY)" # <-- SET THIS
MESSAGE="🦖 Jurassic Park is back online."

# Wait until network is up
for i in {1..10}; do
    if ping -c1 discord.com &>/dev/null; then
        curl -H "Content-Type: application/json" \
             -X POST \
             -d '{"content": "'"$MESSAGE"'"}' \
             $WEBHOOK_URL
        exit 0
    fi
    sleep 10
done
```

**File 9 of 17: `/etc/systemd/system/pi-online-notify.service` (New File)** _This service triggers the above script on boot._

Ini, TOML

```
[Unit]
Description=Pi Discord Boot Notification
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/pi-online-notify.sh

[Install]
WantedBy=multi-user.target
```

Enable it with: `sudo chmod +x /usr/local/bin/pi-online-notify.sh` and `sudo systemctl enable pi-online-notify.service`.

**File 10 of 17: `/usr/local/bin/pi-shutdown-notify.sh` (New File)** _Notifies Discord when the system is shutting down._

Bash

```
#!/bin/bash
WEBHOOK_URL="[https://discord.com/api/webhooks/XXXXXXXXX/YYYYYYYY](https://discord.com/api/webhooks/XXXXXXXXX/YYYYYYYY)" # <-- SET THIS
MESSAGE="💥 Hold onto your butts."

curl -H "Content-Type: application/json" \
     -X POST \
     -d '{"content": "'"$MESSAGE"'"}' \
     $WEBHOOK_URL
```

**File 11 of 17: `/lib/systemd/system-shutdown/pi-shutdown-notify.sh` (New File)** _This is the system _hook_ that triggers the shutdown script. Note the different path._

Bash

```
#!/bin/bash
/usr/local/bin/pi-shutdown-notify.sh
```

Enable it with: `sudo chmod +x /usr/local/bin/pi-shutdown-notify.sh` and `sudo chmod +x /lib/systemd/system-shutdown/pi-shutdown-notify.sh`.

**File 12 of 17: `/usr/local/bin/pi-monitor-inet.sh` (New File)** _This script runs continuously to check for internet outages._

Bash

```
#!/bin/bash

# --- CONFIGURATION ---
WEBHOOK_URL="[https://discord.com/api/webhooks/XXXXXXXXX/YYYYYYYY](https://discord.com/api/webhooks/XXXXXXXXX/YYYYYYYY)" # <-- SET THIS
HOST_TO_PING="1.1.1.1" # A reliable external server
SLEEP_INTERVAL="60"  # Check every 60 seconds

# --- MESSAGES ---
MSG_DOWN="🚨 HOLD ONTO YOUR BUTTS... Internet connection lost! Re-routing network..."
MSG_UP="✅ Jurassic Park systems are back online. Internet connection restored."

echo "Internet monitor started. Pinging $HOST_TO_PING every $SLEEP_INTERVAL seconds."
LAST_STATE="up"

while true; do
    if ping -c 1 "$HOST_TO_PING" > /dev/null 2>&1; then
        CURRENT_STATE="up"
    else
        CURRENT_STATE="down"
    fi
    
    # Check if the state has changed
    if [ "$CURRENT_STATE" != "$LAST_STATE" ]; then
        echo "State changed from $LAST_STATE to $CURRENT_STATE. Sending notification."
        
        if [ "$CURRENT_STATE" = "up" ]; then
            MESSAGE=$MSG_UP
        else
            MESSAGE=$MSG_DOWN
        fi
        
        curl -H "Content-Type: application/json" \
             -X POST \
             -d '{"content": "'"$MESSAGE"'"}' \
             "$WEBHOOK_URL"
             
        LAST_STATE="$CURRENT_STATE"
    fi
    
    sleep "$SLEEP_INTERVAL"
done
```

**File 13 of 17: `/etc/systemd/system/pi-monitor-inet.service` (New File)** _This service runs the monitor script in the background._

Ini, TOML

```
[Unit]
Description=Internet Connection Monitor and Discord Notifier
After=network-online.target
Wants=network-online.target

[Service]
User=[your_username]
Group=[your_username]
ExecStart=/usr/local/bin/pi-monitor-inet.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable it with: `sudo chmod +x /usr/local/bin/pi-monitor-inet.sh` and `sudo systemctl enable --now pi-monitor-inet.service`.

## Part 5: The "3-2-1" Backup Strategy (True Resilience)

This is the final, and most important, piece. A "3-2-1" strategy means 3 copies of your data, on 2 different media, with 1 copy off-site.

### 5.1: Local Snapshot Backup (3:00 AM)

This script creates a full `.tar.gz` snapshot of all configs and user data and saves it to the external 2TB drive. This is our primary local backup.

**File 14 of 17: `/usr/local/bin/pi-backup.sh` (New File)** _This is the final, working script with the correct `tar` syntax._

Bash

```
#!/bin/bash
BACKUP_DIR="/mnt/storage-2tb/pi_backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
DEST="$BACKUP_DIR/backup_$TIMESTAMP.tar.gz"
WEBHOOK_URL="[https://discord.com/api/webhooks/XXXXXXXXX/YYYYYYYY](https://discord.com/api/webhooks/XXXXXXXXX/YYYYYYYY)" # <-- SET THIS

mkdir -p "$BACKUP_DIR"
echo "Starting local full snapshot at $(date)"

# --- TAR COMMAND SYNTAX (OPTIONS FIRST) ---
# This syntax is critical. All --exclude flags must come BEFORE the paths.
sudo tar -czf "$DEST" \
    --exclude=/mnt/storage-2tb \
    --exclude=/mnt/usb-stick1 \
    --exclude=/mnt/usb-stick2 \
    --exclude=/proc \
    --exclude=/sys \
    --exclude=/dev \
    --warning=no-file-changed \
    /home/[your_username] \
    /etc \
    /opt \
    /usr/local/bin

# --- NOTIFICATION ---
if [ $? -eq 0 ]; then
    SIZE=$(du -h "$DEST" | cut -f1)
    MSG="✅ **LOCAL BACKUP (SNAPSHOT):** Completed successfully. File: \`basename $DEST\` ($SIZE)"
else
    MSG="❌ **LOCAL BACKUP (SNAPSHOT):** FAILED at $(date)."
fi

curl -H "Content-Type: application/json" \
     -X POST \
     -d '{"content": "'"$MSG"'"}' \
     $WEBHOOK_URL

# --- CLEANUP ---
# Delete backups older than 7 days
find "$BACKUP_DIR" -type f -mtime +7 -name "backup_*.tar.gz" -delete
```

Enable it with: `sudo chmod +x /usr/local/bin/pi-backup.sh`.

### 5.2: Off-site Config Backup (3:15 AM)

This script provides our off-site copy. It pushes _only_ the critical config files (all 16 other files in this document) to a private GitHub repository.

**Setup:** This requires a one-time setup of a [private GitHub repo](https://github.com/) and an [SSH Deploy Key](https://www.google.com/search?q=https://docs.github.com/en/developers/overview/managing-deploy-keys%23setup-2) with write access.

**File 15 of 17: `/usr/local/bin/pi-config-git-backup.sh` (Complete, Hardened File)** _This is the final, "cron-proofed" script that correctly handles `sudo`, `git` SSH keys, and remote/local conflicts._

Bash

```
#!/bin/bash

# --- START CRON-PROOFING ---
# 1. Set a robust PATH so cron can find all commands
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# 2. Set the SSH command for Git to use your user's key (even when run by root)
export GIT_SSH_COMMAND="ssh -i /home/[your_username]/.ssh/id_ed25519 -o StrictHostKeyChecking=no"
# 3. Define a log file for debugging
LOG_FILE="/var/log/pi-config-git-backup.log"
# --- END CRON-PROOFING ---

# --- CONFIGURATION ---
WEBHOOK_URL="[https://discord.com/api/webhooks/XXXXXXXXX/YYYYYYYY](https://discord.com/api/webhooks/XXXXXXXXX/YYYYYYYY)" # <-- SET THIS
CONFIG_REPO_DIR="/home/[your_username]/[your-private-repo-name]" # <-- SET YOUR REPO PATH
COMMIT_MSG="Automated config backup: $(date +"%Y-%m-%d %H:%M:%S")"

# Redirect all output to the log file (clears the log for each run)
exec > "$LOG_FILE" 2>&1

echo "============================================="
echo "Starting off-site config backup at $(date)"

# --- Function to send Discord notification ---
notify_discord() {
    echo "$1" # Also write notification to log
    curl -H "Content-Type: application/json" \
         -X POST \
         -d '{"content": "'"$1"'"}' \
         "$WEBHOOK_URL"
}

# --- 1. Go to the repo and RESET it ---
cd "$CONFIG_REPO_DIR" || { notify_discord "❌ **OFF-SITE BACKUP (CONFIG):** FAILED: Could not cd into $CONFIG_REPO_DIR"; exit 1; }

git config user.name "Pi Backup Bot"
git config user.email "pi@[your_pi_hostname]"
echo "Fetching remote state..."
git fetch origin
echo "Resetting local repo to match remote (wiping local changes)..."
git reset --hard origin/main

# --- 2. Copy all critical config files into the repo ---
echo "Copying config files..."
# (Added "|| true" to all cp commands to prevent errors if a file doesn't exist)
mkdir -p "$CONFIG_REPO_DIR/docker" || true
mkdir -p "$CONFIG_REPO_DIR/dashboard" || true
mkdir -p "$CONFIG_REPO_DIR/system_configs" || true
mkdir -p "$CONFIG_REPO_DIR/systemd_services" || true
mkdir -p "$CONFIG_REPO_DIR/scripts" || true

cp /home/[your_username]/docker/docker-compose.yml "$CONFIG_REPO_DIR/docker/" || true
cp /home/twop0intfive/dashboard/index.html "$CONFIG_REPO_DIR/dashboard/" || true
cp /home/twop0intfive/dashboard/Dockerfile "$CONFIG_REPO_DIR/dashboard/" || true
cp /home/twop0intfive/dashboard/favicon.svg "$CONFIG_REPO_DIR/dashboard/" || true
cp /etc/fstab "$CONFIG_REPO_DIR/system_configs/" || true
cp /etc/samba/smb.conf "$CONFIG_REPO_DIR/system_configs/" || true
cp /etc/avahi/services/timemachine.service "$CONFIG_REPO_DIR/system_configs/" || true
cp /etc/systemd/system/pi-online-notify.service "$CONFIG_REPO_DIR/systemd_services/" || true
cp /etc/systemd/system/pi-monitor-inet.service "$CONFIG_REPO_DIR/systemd_services/" || true
cp /lib/systemd/system-shutdown/pi-shutdown-notify.sh "$CONFIG_REPO_DIR/scripts/" || true
cp /usr/local/bin/pi-online-notify.sh "$CONFIG_REPO_DIR/scripts/" || true
cp /usr/local/bin/pi-shutdown-notify.sh "$CONFIG_REPO_DIR/scripts/" || true
cp /usr/local/bin/pi-backup.sh "$CONFIG_REPO_DIR/scripts/" || true
cp /usr/local/bin/pi-monitor-inet.sh "$CONFIG_REPO_DIR/scripts/" || true
cp /usr/local/bin/pi-config-git-backup.sh "$CONFIG_REPO_DIR/scripts/" || true

# --- 3. Add, Commit, and Push changes ---
git add .

if ! git diff-index --cached --quiet HEAD --; then
    echo "Changes detected, committing and pushing..."
    git commit -m "$COMMIT_MSG"
    
    if git push origin main; then
        MSG="✅ **OFF-SITE BACKUP (CONFIG):** Pushed new config version to GitHub successfully."
        notify_discord "$MSG"
    else
        MSG="❌ **OFF-SITE BACKUP (CONFIG):** FAILED to push to GitHub. Check log on Pi: $LOG_FILE"
        notify_discord "$MSG"
    fi
else
    echo "No config changes detected. Nothing to push."
    MSG="ℹ️ **OFF-SITE BACKUP (CONFIG):** No config changes detected. Backup skipped."
    notify_discord "$MSG"
fi

echo "Off-site backup complete."
echo "============================================="
```

Enable it with: `sudo chmod +x /usr/local/bin/pi-config-git-backup.sh`.

### 5.3: The Scheduler (Cron)

Finally, we schedule both backups to run automatically.

**File 16 of 17: `sudo crontab -e` (Addition)** _This file schedules both jobs, separated by 15 minutes._

```
# Run the full local snapshot at 3:00 AM
0 3 * * * /usr/local/bin/pi-backup.sh

# Run the off-site config backup at 3:15 AM
15 3 * * * /usr/local/bin/pi-config-git-backup.sh
```

_(File 17 is the log itself, `/var/log/pi-config-git-backup.log`, which is created by the script)._

---

### Post-Build Addendum: Hardening & Debugging

The initial version of `pi-config-git-backup.sh` (File 15) failed silently when run by `cron`. The debugging process revealed two critical flaws:

1. **Git Ownership:** The `cron` job runs as `root`, but the git repository lives in `/home/[your_username]/`. This caused a `fatal: detected dubious ownership` error. This was fixed by running `sudo git config --global --add safe.directory /home/[your_username]/[your-private-repo-name]` one time.
    
2. **State Conflicts:** The original script used a `git pull` command, which failed if the local repository had changes (which it _always_ did after the `cp` commands). This created a race condition that caused `[rejected] main -> main (fetch first)` errors.
    

The final, hardened version of the script fixes this by **using `git reset --hard origin/main`**. This robustly wipes all local changes, force-syncs with the remote, and _then_ copies the new files. This method is resilient to conflicts and ideal for an automated, non-interactive script.

## Conclusion

What started as a disaster (a dead SD card) became the ultimate upgrade. My new Pi stack is faster, 100% containerized, and provides Time Machine backups for my Mac. It's fully resilient, with a static IP, no IPv6 leaks, and a full 3-2-1 backup strategy.

Best of all, it's now a self-aware, movie-quoting node that tells me exactly what it's doing.