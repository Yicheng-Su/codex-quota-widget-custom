const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexQuota", {
  getQuota: () => ipcRenderer.invoke("quota:get"),
  getRefreshIntervalMinutes: () => ipcRenderer.invoke("settings:refreshInterval:get"),
  setRefreshIntervalMinutes: (value) => ipcRenderer.invoke("settings:refreshInterval:set", value),
  getWindowOpacity: () => ipcRenderer.invoke("window:opacity:get"),
  setWindowOpacity: (value) => ipcRenderer.invoke("window:opacity:set", value),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  getCompactMode: () => ipcRenderer.invoke("window:compact:get"),
  setCompactMode: (value) => ipcRenderer.invoke("window:compact:set", value),
  moveCompactBy: (deltaX, deltaY) => ipcRenderer.send("window:compact:move", deltaX, deltaY),
  setInteractionMode: (value) => ipcRenderer.invoke("window:interaction-mode", value),
  close: () => ipcRenderer.invoke("window:close"),
  getAlwaysOnTop: () => ipcRenderer.invoke("window:alwaysOnTop:get"),
  setAlwaysOnTop: (value) => ipcRenderer.invoke("window:alwaysOnTop:set", value),
  openCodex: () => ipcRenderer.invoke("external:openCodex"),
  openUsageWindow: () => ipcRenderer.invoke("usage:open"),
  isApprovalSupported: () => ipcRenderer.invoke("approval:is-supported"),
  prepareApprovalTarget: () => ipcRenderer.invoke("approval:prepare"),
  insertApproval: (target) => ipcRenderer.invoke("approval:insert", target),
  sendApproval: (target) => ipcRenderer.invoke("approval:submit", target),
  cancelApproval: () => ipcRenderer.invoke("approval:cancel"),
  getApprovalWaitSeconds: () => ipcRenderer.invoke("approval:wait:get"),
  setApprovalWaitSeconds: (value) => ipcRenderer.invoke("approval:wait:set", value),
  getApprovalShortcutEnabled: () => ipcRenderer.invoke("approval:shortcut:get"),
  setApprovalShortcutEnabled: (value) => ipcRenderer.invoke("approval:shortcut:set", value),
  onRefresh: (callback) => {
    ipcRenderer.on("quota:refresh", callback);
  },
  onAlwaysOnTopChanged: (callback) => {
    ipcRenderer.on("window:alwaysOnTopChanged", (_event, value) => callback(value));
  },
  onRefreshIntervalChanged: (callback) => {
    ipcRenderer.on("settings:refreshIntervalChanged", (_event, value) => callback(value));
  },
  onWindowBlur: (callback) => {
    ipcRenderer.on("window:blurred", callback);
  },
  onCompactModeChanged: (callback) => {
    ipcRenderer.on("window:compactChanged", (_event, value) => callback(value));
  },
  onApprovalStateChanged: (callback) => {
    ipcRenderer.on("approval:stateChanged", (_event, value) => callback(value));
  }
});
