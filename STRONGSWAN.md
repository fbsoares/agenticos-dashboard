# StrongSwan Security Audit Report

**Date:** 2026-05-21  
**Host:** snake-UX425JA  
**Trigger:** Warning on `sudo service strongswan-starter restart`  
**Verdict:** No compromise detected. Warning caused by routine package upgrade.

---

## 1. Trigger Event

When attempting to restart the VPN service, systemd emitted the following warning:

```
Warning: The unit file, source configuration file or drop-ins of
strongswan-starter.service changed on disk. Run 'systemctl daemon-reload'
to reload units.
```

This warning raised the question of whether the VPN configuration had been tampered with.

---

## 2. Installed Package

| Package | Version | Architecture |
|---------|---------|--------------|
| strongswan | 5.9.13-2ubuntu4.24.04.3 | all (meta) |
| strongswan-starter | 5.9.13-2ubuntu4.24.04.3 | amd64 |
| strongswan-charon | 5.9.13-2ubuntu4.24.04.3 | amd64 |
| strongswan-libcharon | 5.9.13-2ubuntu4.24.04.3 | amd64 |
| libstrongswan | 5.9.13-2ubuntu4.24.04.3 | amd64 |
| libstrongswan-standard-plugins | 5.9.13-2ubuntu4.24.04.3 | amd64 |

---

## 3. Unit File Audit

**Path:** `/lib/systemd/system/strongswan-starter.service`  
(symlinked at `/usr/lib/systemd/system/strongswan-starter.service` — same inode)

**File timestamps:**

| Field | Value |
|-------|-------|
| Modified | 2026-04-17 21:00 (upstream package timestamp) |
| Installed to disk | 2026-04-23 06:52 (matches dpkg upgrade log) |
| Permissions | 0644, owned by root:root |

**Content:**

```ini
[Unit]
Description=strongSwan IPsec IKEv1/IKEv2 daemon using ipsec.conf
After=network-online.target

[Service]
ExecStart=/usr/sbin/ipsec start --nofork
ExecReload=/usr/sbin/ipsec reload
Restart=on-abnormal

[Install]
WantedBy=multi-user.target
```

**Assessment:** Unit file is clean. No injected commands, no pre/post hooks, no unusual directives.

---

## 4. Package Integrity Check

`dpkg --verify strongswan-starter` output:

```
??5?????? c /etc/ipsec.conf
????????? c /etc/ipsec.secrets
```

**Interpretation:**

- The `c` flag marks both files as **conffiles** — configuration files intentionally managed outside the package. Modified checksums on conffiles are expected and normal.
- `5` on `ipsec.conf` means the MD5 checksum differs from the package default (file was configured manually).
- `?????????` on `ipsec.secrets` means dpkg cannot verify the file — expected, since it has `0600` permissions and contains credentials.
- All **binary and service files** verified cleanly. No tampered executables.

---

## 5. Configuration Files

| File | Last Modified | Permissions | Notes |
|------|--------------|-------------|-------|
| `/etc/ipsec.conf` | 2026-02-23 | 0644 root:root | VPN config, user-modified |
| `/etc/ipsec.secrets` | 2025-01-10 | 0600 root:root | Credentials, restricted correctly |
| `/etc/strongswan.conf` | 2023-11-07 | 0644 root:root | Unchanged since install |
| `/etc/ipsec.d/cacerts/ca-cert.pem` | 2024-05-13 | 0644 root:root | CA certificate |
| `/etc/ipsec.d/updown.sh` | 2024-05-13 | 0755 root:root | Route management script |

**updown.sh content review:** Script adds/removes routes for the tunnel network (`10.10.10.0/24`) on connect/disconnect using `$PLUTO_*` environment variables supplied by the IKE daemon. No network callbacks, no exfiltration logic, no anomalies.

---

## 6. Change Timeline

| Date | Event |
|------|-------|
| 2023-11-07 | strongswan initially installed; base config files written |
| 2024-05-13 | VPN provisioned: CA certificate and updown.sh added |
| 2025-01-10 | `/etc/ipsec.secrets` updated (credentials rotated or added) |
| 2026-02-23 | `/etc/ipsec.conf` updated (connection configuration changed) |
| **2026-04-23 06:52** | **Package upgraded** `.24.04.2 → .24.04.3`; unit file replaced on disk |
| 2026-05-21 | Restart attempted → systemd warning observed → this audit |

---

## 7. Root Cause of Warning

The package upgrade on **2026-04-23** wrote a new unit file to disk. `systemctl daemon-reload` was not run afterward. systemd's in-memory unit cache still held the pre-upgrade version. When the restart was attempted today, systemd detected the mismatch between its cache and the on-disk file and emitted the warning.

This is a routine operational gap, not a security event.

---

## 8. Active VPN Session

At the time of audit, the service was actively exchanging IKE keepalive packets:

- **Local:** `10.79.100.79:4500`
- **Remote:** `130.185.82.233:4500`
- **Traffic type:** `INFORMATIONAL` request/response (standard IKE Dead Peer Detection)

Session appears healthy and legitimate.

---

## 9. Remediation

Run the following to clear the warning and restart cleanly:

```bash
sudo systemctl daemon-reload
sudo service strongswan-starter restart
```

---

## 10. Red Flags to Watch For

The following would indicate actual compromise and should trigger deeper investigation:

- Unit file gains `ExecStartPre`, `ExecStartPost`, or `ExecStop` directives with unexpected commands
- `/etc/ipsec.secrets` modified without a planned credentials rotation
- Unknown remote IPs appearing in IKE session logs
- `updown.sh` modified to include outbound callbacks or data exfiltration
- Binary files (`/usr/sbin/ipsec`, `charon`) failing `dpkg --verify`
- New drop-in files under `/etc/systemd/system/strongswan-starter.service.d/`

---

*Report generated by automated audit — session: audit-strongswan*
