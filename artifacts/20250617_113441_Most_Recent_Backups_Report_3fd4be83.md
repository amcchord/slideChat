# 📊 Most Recent Backups Report

## ✅ Recent Successful Backups (Last 24 Hours)

| 🕐 Backup Time | 💻 Agent | ⏱️ Duration | 📸 Snapshot Created |
|---|---|---|---|
| **Jun 17, 01:00** | **Mark_S** | 29 seconds | ✅ s_dtf4zsfi2dky |
| **Jun 17, 01:00** | **Irving_B** | 42 seconds | ✅ s_ok0rd21ohb7j |
| **Jun 17, 00:00** | **Mark_S** | 29 seconds | ✅ s_02zzt0zqlp6y |
| **Jun 17, 00:00** | **Irving_B** | 42 seconds | ✅ s_0anp40i9cm9d |
| **Jun 16, 23:00** | **Mark_S** | 29 seconds | ✅ s_97dio8t5svnk |
| **Jun 16, 23:00** | **Irving_B** | 42 seconds | ✅ s_o7abf6ufcrfy |
| **Jun 16, 22:00** | **Helly_R** | 31 seconds | ✅ s_b48u08b4rks4 |
| **Jun 16, 22:00** | **Mark_S** | 30 seconds | ✅ s_8z53x1e5czc2 |
| **Jun 16, 22:00** | **Irving_B** | 1 min 15 sec | ✅ s_nqh1b3m4gjdu |

## ❌ Recent Failed Backups

| 🕐 Backup Time | 💻 Agent | ❌ Error | 📝 Details |
|---|---|---|---|
| **Jun 16, 22:00** | **CaptainPhillips** | Code 51000 | Failed to get storage info |
| **Jun 16, 22:00** | **D-Alto** | Code 51000 | Failed to get storage info |
| **Jun 16, 21:00** | **D-Alto** | Code 51000 | Failed to get storage info |
| **Jun 16, 21:00** | **CaptainPhillips** | Code 51000 | Failed to get storage info |
| **Jun 16, 20:00** | **CaptainPhillips** | Code 51000 | Failed to get storage info |

## 📈 Backup Status Summary

- **✅ Total Successful Backups**: 14 of 19 recent attempts (74%)
- **❌ Failed Backups**: 5 of 19 recent attempts (26%)
- **📊 Total Backup Jobs in System**: 1,294

## 🚨 Key Observations

### 🎯 **Healthy Agents** (Backing up successfully)
- **Mark_S** - Consistent hourly backups, very fast (29-30 seconds)
- **Irving_B** - Regular backups, slightly longer duration (42 seconds - 1min 15sec)
- **Helly_R** - Periodic successful backups

### ⚠️ **Problem Agents** (Failing consistently)
- **CaptainPhillips** - Multiple "Failed to get storage info" errors
- **D-Alto** - Same storage error pattern

### 💡 **Recommendations**
1. **Investigate storage connectivity** for CaptainPhillips and D-Alto agents
2. **Check network connectivity** between these agents and their Slide devices
3. **Verify disk space** and storage health on the backup devices
4. Consider **restarting the Slide agent service** on the problematic machines