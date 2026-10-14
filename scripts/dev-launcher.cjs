/**
 * 开发模式启动器：
 * 1. 启动前清理上次残留的本项目服务进程（占端口会导致启动失败）
 * 2. 启动 npm run dev（前后端）
 * 3. 等 5173 端口就绪后自动打开浏览器
 * 4. 轮询 5173 的连接数：浏览器全部关闭后（连续 ~15 秒无连接）自动停掉整个后台
 *
 * 环境变量 TIKU_NO_BROWSER=1 可跳过自动打开浏览器。
 */
const { spawn, exec } = require('child_process');
const path = require('path');

const PORT = 5173;
const URL = `http://localhost:${PORT}`;
const POLL_MS = 5000;
const EMPTY_POLLS_TO_QUIT = 3; // 连续 3 次（约 15 秒）无连接才退出，避免刷新瞬间误杀
const READY_TIMEOUT_MS = 60000;

const root = path.resolve(__dirname, '..');

let child = null;
let exited = false;
let sawClient = false;
let emptyCount = 0;

function killAll(reason) {
  if (exited || !child) return;
  exited = true;
  console.log(`\n[启动器] ${reason}，正在关闭后台服务...`);
  try {
    exec(`taskkill /PID ${child.pid} /T /F`, { windowsHide: true }, () => process.exit(0));
  } catch {
    process.exit(0);
  }
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGINT', () => killAll('收到退出信号'));
process.on('SIGTERM', () => killAll('收到退出信号'));

// ---------- 启动前清理残留进程 ----------

function getListeningPids(port) {
  return new Promise((resolve) => {
    exec('netstat -ano', { windowsHide: true }, (err, stdout) => {
      if (err) return resolve([]);
      const pids = new Set();
      for (const line of stdout.split(/\r?\n/)) {
        if (new RegExp(`:${port}\\s.*LISTENING`, 'i').test(line)) {
          const pid = line.trim().split(/\s+/).pop();
          if (/^\d+$/.test(pid)) pids.add(pid);
        }
      }
      resolve([...pids]);
    });
  });
}

function getCommandLine(pid) {
  return new Promise((resolve) => {
    const ps = `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine`;
    exec(`powershell -NoProfile -Command "${ps}"`, { windowsHide: true }, (err, stdout) =>
      resolve(err ? '' : String(stdout || '')),
    );
  });
}

function killPid(pid) {
  return new Promise((resolve) => {
    exec(`taskkill /PID ${pid} /T /F`, { windowsHide: true }, () => resolve());
  });
}

async function isOursOn3001() {
  try {
    const res = await fetch('http://127.0.0.1:3001/api/health', { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    return data && data.ok === true;
  } catch {
    return false;
  }
}

async function cleanupPorts() {
  // 3001：/api/health 确认是本项目的题库服务才清理
  const pids3001 = await getListeningPids(3001);
  if (pids3001.length) {
    if (await isOursOn3001()) {
      console.log(`[启动器] 清理上次残留的服务进程 (PID ${pids3001.join(', ')})...`);
      for (const pid of pids3001) await killPid(pid);
    } else {
      console.error('[启动器] 端口 3001 被其他程序占用，请先关闭它再重试。');
      process.exit(1);
    }
  }

  // 5173：命令行含 vite 才认为是本项目的残留
  const pids5173 = await getListeningPids(5173);
  if (pids5173.length) {
    let allOurs = true;
    for (const pid of pids5173) {
      const cmd = await getCommandLine(pid);
      if (!/vite/i.test(cmd)) allOurs = false;
    }
    if (allOurs) {
      console.log(`[启动器] 清理上次残留的前端进程 (PID ${pids5173.join(', ')})...`);
      for (const pid of pids5173) await killPid(pid);
    } else {
      console.error('[启动器] 端口 5173 被其他程序占用，请先关闭它再重试。');
      process.exit(1);
    }
  }
}

// ---------- 端口就绪检测 / 打开浏览器 ----------

function isPortListening() {
  return new Promise((resolve) => {
    exec('netstat -ano', { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(new RegExp(`:${PORT}\\s.*LISTENING`, 'i').test(stdout));
    });
  });
}

function countConnections() {
  return new Promise((resolve) => {
    exec('netstat -ano', { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(-1);
      let n = 0;
      for (const line of stdout.split(/\r?\n/)) {
        if (/ESTABLISHED/i.test(line) && new RegExp(`:${PORT}\\s`).test(line)) n++;
      }
      resolve(n);
    });
  });
}

// ---------- 轮询：浏览器关闭后自动停止 ----------

function poll() {
  if (exited) return;
  countConnections().then((n) => {
    if (n < 0) return; // netstat 失败，跳过本轮
    if (n > 0) {
      if (!sawClient || emptyCount > 0) {
        console.log(`[启动器] 检测到浏览器连接 (${n} 个)，保持运行`);
      }
      sawClient = true;
      emptyCount = 0;
      return;
    }
    if (!sawClient) return; // 浏览器还没连上过，不计数
    emptyCount++;
    console.log(`[启动器] 未检测到浏览器连接 (${emptyCount}/${EMPTY_POLLS_TO_QUIT})...`);
    if (emptyCount >= EMPTY_POLLS_TO_QUIT) killAll('浏览器已关闭');
  });
}

function waitReadyAndOpen() {
  const waitStart = Date.now();
  const attempt = () => {
    if (exited) return;
    isPortListening().then((ready) => {
      if (ready) {
        if (process.env.TIKU_NO_BROWSER) {
          console.log('[启动器] 跳过自动打开浏览器 (TIKU_NO_BROWSER)');
        } else {
          console.log(`[启动器] 服务就绪，正在打开 ${URL}`);
          spawn('cmd', ['/c', 'start', '', URL], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
        }
        setInterval(poll, POLL_MS);
        // 提示：30 秒还没连上，可能浏览器没打开成功
        setTimeout(() => {
          if (!exited && !sawClient) {
            console.log(`[启动器] 还没检测到浏览器连接，若浏览器没弹出，请手动访问 ${URL}`);
          }
        }, 30000);
        return;
      }
      if (Date.now() - waitStart > READY_TIMEOUT_MS) {
        console.log('[启动器] 等待服务就绪超时，请检查上方日志。');
        return;
      }
      setTimeout(attempt, 1000);
    });
  };
  attempt();
}

// ---------- 主流程 ----------

(async () => {
  console.log('[启动器] 正在启动开发服务...');
  await cleanupPorts();

  child = spawn('npm', ['run', 'dev'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    windowsHide: false,
  });

  child.on('exit', (code) => {
    if (exited) return; // 是 killAll 主动杀的，交由它退出
    exited = true;
    console.log(`[启动器] 服务已退出 (code=${code})`);
    process.exit(code ?? 0);
  });

  waitReadyAndOpen();
})();
