const MAX_LOG_ENTRIES = 1000;

class LogStorage {
  private logs: string[] = [];

  addLog(log: string) {
    this.logs.push(log);
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.shift(); // Remove oldest log to maintain max size
    }
  }

  getLogs() {
    return this.logs;
  }
}

export const logStorage = new LogStorage();
