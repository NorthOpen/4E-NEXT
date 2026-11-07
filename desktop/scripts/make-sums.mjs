// 为桌面端发布附件生成 SHA256SUMS.txt。
//
// 为什么单独成文件：本地出包（pack-portable.mjs 末尾）与云端流水线都要写这份校验和，
// 两边各抄一遍哈希逻辑迟早会漏掉新附件类型。这里只认「安装版 + 便携版」两类：
//   · *-setup.exe        安装程序
//   · *portable.zip      免安装便携版
//
// 用法：node desktop/scripts/make-sums.mjs [release 目录]

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 在 dir 里找安装版 / 便携版，写 SHA256SUMS.txt（按文件名排序，稳定输出）。返回文件路径，没找到附件时返回 null。 */
export function writeSums(dir) {
  const names = readdirSync(dir)
    .filter((n) => /-setup\.exe$/i.test(n) || /portable\.zip$/i.test(n))
    .sort();
  if (!names.length) return null;

  const lines = names.map((n) => createHash("sha256").update(readFileSync(join(dir, n))).digest("hex") + "  " + n);
  const out = join(dir, "SHA256SUMS.txt");
  writeFileSync(out, lines.join("\n") + "\n", "utf8");
  return out;
}

// 直接执行时才跑 CLI；被 pack-portable.mjs import 时不应该产生副作用
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("make-sums.mjs")) {
  const dir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "release");
  const out = writeSums(dir);
  if (!out) {
    console.error("[make-sums] 在 " + dir + " 里没找到 *-setup.exe / *portable.zip");
    process.exit(1);
  }
  console.log("[make-sums] 已写入 " + out);
  console.log(readFileSync(out, "utf8").trim());
}
