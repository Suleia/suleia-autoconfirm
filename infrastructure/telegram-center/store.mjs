import fs from 'node:fs';
import path from 'node:path';

// One process owns this directory. Corrupt/missing established state fails closed.
export class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.lock = path.join(dir, 'process.lock');
    this.fd = fs.openSync(this.lock, 'wx', 0o600);
    fs.writeFileSync(this.fd, String(process.pid));
    try {
      const file = path.join(dir, 'state.json');
      const marker = path.join(dir, 'initialized');
      if (fs.existsSync(marker) && !fs.existsSync(file)) throw new Error('STATE_MISSING');
      this.state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, offset: 0, proposals: {}, audit: [], identity: null };
      if (this.state.version !== 1 || !Number.isSafeInteger(this.state.offset) || !this.state.proposals || !Array.isArray(this.state.audit)) throw new Error('STATE_INVALID');
      this.save();
      fs.writeFileSync(marker, '1', { mode: 0o600 });
    } catch (error) { this.close(); throw error; }
  }
  atomic(name, value) {
    const file = path.join(this.dir, name);
    const temp = `${file}.tmp`;
    const fd = fs.openSync(temp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
    const dirFd = fs.openSync(this.dir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  }
  save() { this.atomic('state.json', this.state); }
  record(event) {
    this.state.audit.push({ at: new Date().toISOString(), ...event });
    this.save();
  }
  health(value) { this.atomic('health.json', { ...value, at: new Date().toISOString() }); }
  close() {
    if (this.fd !== undefined) { fs.closeSync(this.fd); this.fd = undefined; fs.unlinkSync(this.lock); }
  }
}
