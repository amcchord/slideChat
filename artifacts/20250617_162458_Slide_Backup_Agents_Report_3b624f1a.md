# 🖥️ Slide Backup Agents Report

## Summary
**Total Agents:** 8  
**Status:** Mixed (Active and Inactive)

## Active Agents (Recently Seen) ✅

| Agent Name | Hostname | Platform | IP Address | Last Seen | Status |
|------------|----------|----------|------------|-----------|---------|
| **Irving_B** | slidemini3 | Windows 11 Pro | 192.168.101.91 | 2025-06-17 16:24 | 🟢 Active |
| **Mark_S** | slidemini2 | Windows 11 Pro | 192.168.105.48 | 2025-06-17 16:23 | 🟢 Active |
| **Helly_R** | slidemini1 | Windows 11 Pro | 192.168.101.71 | 2025-06-17 16:24 | 🟢 Active |
| **CaptainPhillips** | CaptainPhillips | Windows 11 Enterprise | 192.168.105.61 | 2025-06-17 16:23 | 🟢 Active |
| **AllisonsZ16G2** | AllisonsZ16G2 | Windows 11 Pro | 192.168.1.72 | 2025-06-17 16:23 | 🟢 Active |

## Inactive Agents (Not Recently Seen) ⚠️

| Agent Name | Hostname | Platform | IP Address | Last Seen | Status |
|------------|----------|----------|------------|-----------|---------|
| **DESKTOP-N9JRJGF** | DESKTOP-N9JRJGF | Windows 11 Pro | 192.168.1.57 | 2025-03-12 01:33 | 🔴 Offline |
| **D-Alto** | DESKTOP-5O3A6EH | Windows 10 Enterprise | 192.168.101.129 | 2025-04-17 02:37 | 🔴 Offline |
| **BasementIntel** | BasementIntel | Windows 11 Pro | 192.168.1.179 | 2025-06-06 20:19 | 🟡 Recently Offline |

## Device Distribution 📍

| Device | Agent Count | Active Agents |
|--------|-------------|---------------|
| d_austinprod01 | 3 | 3 ✅ |
| d_austinprod02 | 3 | 1 ⚠️ |
| d_austinprod03 | 2 | 1 ⚠️ |

## Key Observations 📊

- **5 out of 8 agents** are currently active and reporting
- All active agents are running **Agent Version 1.8.0** (latest)
- **3 agents** appear to be offline and may need attention
- All systems are running **Windows** (mix of Windows 10/11)
- Most agents use **UEFI firmware** and **AES-256-GCM encryption**

## Recommendations 💡

1. **Check offline agents:** DESKTOP-N9JRJGF and D-Alto haven't been seen for months
2. **Investigate BasementIntel:** Recently went offline (June 6th)
3. **Update legacy agents:** One agent still running version 1.2.0
4. **Monitor device distribution:** Ensure backup redundancy across devices