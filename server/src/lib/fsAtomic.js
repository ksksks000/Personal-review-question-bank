import fs from 'fs';
import path from 'path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 原子写文件：先写 .tmp 再 rename，Windows 下 rename 可能 EPERM/EBUSY，做短重试。
 */
export async function writeFileAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, data, 'utf8');
  const maxAttempts = 5;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await fs.promises.rename(tmp, filePath);
      return;
    } catch (err) {
      if (i === maxAttempts - 1) {
        try {
          await fs.promises.unlink(tmp);
        } catch { /* ignore */ }
        throw err;
      }
      await sleep(50 * (i + 1));
    }
  }
}
