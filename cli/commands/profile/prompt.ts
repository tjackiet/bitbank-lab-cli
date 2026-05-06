/** Interactive prompts for profile add. Hidden secret input avoids leaking
 * the secret to the terminal scrollback / shell history (flag-based input is
 * forbidden because shells log argv). */

export type Prompts = {
  readVisible: (prompt: string) => Promise<string>;
  readHidden: (prompt: string) => Promise<string>;
};

function readChunkedLine(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf-8");
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        resolve(buf.slice(0, nl).replace(/\r$/, ""));
      }
    };
    process.stdin.on("data", onData);
    process.stdin.resume();
  });
}

async function readVisible(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  return readChunkedLine();
}

async function readHidden(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  if (!process.stdin.isTTY) {
    return readChunkedLine();
  }
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (val: string) => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
      process.stderr.write("\n");
      resolve(val);
    };
    const onData = (chunk: Buffer) => {
      const s = chunk.toString("utf-8");
      for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (code === 3) {
          finish("");
          process.exit(130);
          return;
        }
        if (code === 13 || code === 10 || code === 4) {
          finish(buf);
          return;
        }
        if (code === 127 || code === 8) buf = buf.slice(0, -1);
        else if (code >= 32) buf += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

export const defaultPrompts: Prompts = { readVisible, readHidden };
