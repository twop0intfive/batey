---
{"dg-publish":true,"permalink":"/en/topics/tech/hold-onto-your-butts-a-smarter-raspberry-pi-backup-and-recovery-system/","title":"🧠 \"Hold Onto Your Butts\": A Smarter Raspberry Pi Backup & Recovery System","created":"2025-05-31T19:31:32.000-04:00","updated":"2025-05-31T19:37:45.000-04:00"}
---


> After a power outage knocked out my Raspberry Pi and left it stuck in the void between “seems like it’s booting” and “black screen of mystery,” I decided it was time to stop flirting with disaster.

This Pi isn’t just some toy server — it’s a central piece of my home network. I needed it to be recoverable, alert me when it’s online, and back itself up like a grown-up system.

So here's what I set up:

- ⚡ A friendly emergency recovery system
- 🔁 Nightly automated backups to a USB drive (with Docker and database support)
- 🧠 A `README` for future me (or whoever pulls the card in panic)
- 🦖 Discord alerts on boot, shutdown, and backup status
- ☁️ Optional cloud backup with `rclone` — because local isn't always enough

If you run a Pi, especially one in a headless or always-on setup, I think you’ll appreciate this.

---

## 📦 1. The README Future-Me Needed

After the last boot fail, I found myself trying to remember what I had to type into `cmdline.txt` to force recovery mode. So now I leave myself a note **right on the boot partition**:

```txt
# /boot/README-rescue.txt

If the Pi won’t boot, and you've tried turning it off and on again...

1. Put the SD card in a computer.
2. Open `cmdline.txt` (should be one line).
3. Add this to the end: `init=/bin/bash`
4. Save, eject, and boot the Pi.

Once you're in:

    mount -o remount,rw /
    fsck -y /dev/mmcblk0p2
    reboot -f

Don’t forget to remove `init=/bin/bash` afterward or it’ll keep skipping the OS.
```

---

## 💾 2. Nightly USB Backups (The Real Kind)

I wrote a backup script that does what I actually need:

- Saves `/home`, `/etc`, and custom scripts
- Archives all Docker volumes
- Copies `.sqlite` databases
- Dumps the list of installed packages
- Saves the root crontab
- Deletes backups older than 7 days
- (Optional) Uploads to Google Drive or similar using `rclone`
- Notifies me via Discord when it completes

### 📄 `/usr/local/bin/backup-to-usb.sh`

```bash
#!/bin/bash
set -e
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M")
BACKUP_DIR="/mnt/mydrive/backup-$TIMESTAMP"
LOGFILE="/var/log/usbbackup.log"
WEBHOOK_URL="https://discord.com/api/webhooks/YOUR_WEBHOOK_HERE"
echo "[$(date)] Starting backup..." | tee -a "$LOGFILE"
mkdir -p "$BACKUP_DIR"
rsync -aAXv /home/ "$BACKUP_DIR/home/" | tee -a "$LOGFILE"
rsync -aAXv /etc/ "$BACKUP_DIR/etc/" | tee -a "$LOGFILE"
rsync -aAXv /usr/local/bin/ "$BACKUP_DIR/usr-local-bin/" | tee -a "$LOGFILE"
dpkg --get-selections > "$BACKUP_DIR/package-list.txt"
crontab -l > "$BACKUP_DIR/cron-root.txt" 2>/dev/null || echo "No root crontab."
DOCKER_BACKUP_DIR="$BACKUP_DIR/docker-volumes"
mkdir -p "$DOCKER_BACKUP_DIR"
docker volume ls -q | while read -r volume; do
  docker run --rm -v "$volume":/volume -v "$DOCKER_BACKUP_DIR":/backup alpine     tar czf "/backup/${volume}.tar.gz" -C /volume .
done
find /home -type f -name "*.sqlite" -exec cp {} "$BACKUP_DIR/" \;
# mysqldump -u root -p'password' --all-databases > "$BACKUP_DIR/mysql-dump.sql"
# rclone copy "$BACKUP_DIR" gdrive:raspberrypi-backups
find /mnt/mydrive -maxdepth 1 -type d -name "backup-*" -mtime +7 -exec rm -rf {} \;
sync
curl -H "Content-Type: application/json"      -X POST      -d "{"content": "✅ Backup completed: $TIMESTAMP"}"      "$WEBHOOK_URL"
echo "[$(date)] Backup complete." | tee -a "$LOGFILE"
```

Add to crontab:

```bash
sudo crontab -e
```

Add:
```
0 2 * * * /usr/local/bin/backup-to-usb.sh >> /var/log/usbbackup.log 2>&1
```

---

## 🦖 3. “Jurassic Park is back online.” (Boot Alert)

### `/usr/local/bin/discord-pi-online.sh`

```bash
#!/bin/bash
WEBHOOK_URL="https://discord.com/api/webhooks/YOUR_WEBHOOK_HERE"
MESSAGE="🦖 *Jurassic Park is back online.* Systems are stable and the park is operational."
curl -H "Content-Type: application/json" -X POST      -d "{"content": "$MESSAGE"}" "$WEBHOOK_URL"
```

### `/etc/systemd/system/discord-online.service`

```ini
[Unit]
Description=Notify Discord when Pi boots
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/discord-pi-online.sh

[Install]
WantedBy=multi-user.target
```

Enable:

```bash
sudo systemctl daemon-reexec
sudo systemctl enable discord-online.service
```

---

## 💥 4. “Hold onto your butts.” (Shutdown Alert)

### `/usr/local/bin/discord-pi-shutdown.sh`

```bash
#!/bin/bash
WEBHOOK_URL="https://discord.com/api/webhooks/YOUR_WEBHOOK_HERE"
MESSAGE="💥 *Ray Arnold here:* Hold onto your butts."
curl -H "Content-Type: application/json" -X POST      -d "{"content": "$MESSAGE"}" "$WEBHOOK_URL"
```

### `/etc/systemd/system/discord-shutdown.service`

```ini
[Unit]
Description=Send Discord alert before shutdown
DefaultDependencies=no
Before=shutdown.target reboot.target halt.target
Requires=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/discord-pi-shutdown.sh
TimeoutStartSec=5

[Install]
WantedBy=halt.target reboot.target shutdown.target
```

Enable:

```bash
sudo systemctl enable discord-shutdown.service
```

---

## ☁️ 5. Optional: Cloud Sync with Rclone

Install:
```bash
curl https://rclone.org/install.sh | sudo bash
```

Configure:
```bash
rclone config
```

Then just uncomment this line in the backup script:

```bash
rclone copy "$BACKUP_DIR" gdrive:raspberrypi-backups
```

Replace `gdrive` with whatever remote you configured.

---

## 🧠 Final Thoughts

This might seem like overkill for a $50 computer — but honestly, it’s not. My Pi does real work in my home network, and **power outages don’t negotiate**. This setup gives me peace of mind, plus I can show it off as a neat example of automated resilience, good scripting habits, and self-documenting infrastructure.

You’re welcome to copy/paste and adapt any of this — and if Future Me is reading this again after the next storm: **you’re covered**.