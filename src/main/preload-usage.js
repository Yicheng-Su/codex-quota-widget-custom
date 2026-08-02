const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexUsage", {
  getUsageData: () => ipcRenderer.invoke("usage:get-data"),
  getRefreshIntervalMinutes: () => ipcRenderer.invoke("settings:refreshInterval:get"),
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("usage:progress", listener);
    return () => ipcRenderer.removeListener("usage:progress", listener);
  },
  onRefresh: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("usage:refresh", listener);
    return () => ipcRenderer.removeListener("usage:refresh", listener);
  },
  onRefreshIntervalChanged: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("settings:refreshIntervalChanged", listener);
    return () => ipcRenderer.removeListener("settings:refreshIntervalChanged", listener);
  }
});
